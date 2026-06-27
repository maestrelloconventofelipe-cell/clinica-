// Edge Function — whatsapp-webhook
// verify_jwt = false (config.json): a Meta não envia JWT.
// Segurança: validação HMAC-SHA256 via X-Hub-Signature-256.
//
// Fluxo de cada mensagem recebida:
//   1. Carregar histórico e gravar mensagem do paciente.
//   2. Interceptar SIM/NÃO de confirmação de consulta  → tratarConfirmacaoAgendamento
//   3. Interceptar SIM/NÃO de oferta de lista de espera → tratarRespostaListaEspera
//   4. Caso geral: agente Claude com tool use            → chamarAgente

import { createClient } from "npm:@supabase/supabase-js@2";
import type { DbClient } from "../_shared/db.ts";
import { chamarAgente } from "../_shared/agente.ts";
import { enviarTexto } from "../_shared/whatsapp.ts";
import {
  aceitarOferta,
  ofertarVaga,
} from "../_shared/listaEspera.ts";

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

const VERIFY_TOKEN    = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const WHATSAPP_TOKEN  = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const APP_SECRET      = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const ANTHROPIC_KEY   = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODELO          = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001";
// Template pré-aprovado para oferta de vaga (usado ao chamar ofertarVaga)
const TEMPLATE_VAGA = Deno.env.get("TEMPLATE_VAGA") ?? "vaga_disponivel";

// MVP: o agente de IA (linguagem natural) fica DESLIGADO por padrão. O núcleo de
// confirmação é determinístico (respostas "1"/"2"). Para reativar o agente na
// Fase 2, defina AGENTE_ATIVO=true. Quando desligado, mensagens fora do fluxo
// SIM/NÃO recebem uma resposta-guia estática (nenhuma chamada de IA = custo zero).
const AGENTE_ATIVO = (Deno.env.get("AGENTE_ATIVO") ?? "false").toLowerCase() === "true";
const MENSAGEM_FALLBACK = Deno.env.get("MENSAGEM_FALLBACK") ??
  "Olá! 😊 Para *confirmar* sua consulta responda *1*; para *cancelar*, responda *2*. " +
  "Para qualquer outro assunto, fale com a recepção da clínica.";

// ---------------------------------------------------------------------------
// Tipos — subconjunto do payload da Cloud API da Meta
// ---------------------------------------------------------------------------

interface WaMessage {
  id:        string;
  from:      string;        // número E.164 do remetente
  type:      string;        // "text" | "image" | "audio" | …
  timestamp: string;
  text?:     { body: string };
}

interface WaValue {
  metadata: {
    display_phone_number: string;
    phone_number_id:      string;
  };
  messages?: WaMessage[];
  statuses?: unknown[];
}

interface WaPayload {
  object: string;
  entry:  Array<{
    id:      string;
    changes: Array<{ field: string; value: WaValue }>;
  }>;
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // ---- GET: verificação do webhook pela Meta --------------------------------
  if (req.method === "GET") {
    const url       = new URL(req.url);
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // ---- POST: eventos recebidos da Meta --------------------------------------
  if (req.method === "POST") {
    const bodyText = await req.text();

    // Validar assinatura HMAC-SHA256
    if (APP_SECRET) {
      const sig = req.headers.get("x-hub-signature-256") ?? "";
      if (!(await verificarHmac(bodyText, APP_SECRET, sig))) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    let payload: WaPayload;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return new Response("OK", { status: 200 });
    }

    if (payload.object !== "whatsapp_business_account") {
      return new Response("OK", { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    ) as DbClient;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;

        const { value }     = change;
        const phoneNumberId = value.metadata.phone_number_id;

        const { data: clinica } = await supabase
          .from("clinicas")
          .select("id, nome, timezone")
          .eq("whatsapp_phone_number_id", phoneNumberId)
          .eq("ativo", true)
          .single<{ id: string; nome: string; timezone: string }>();

        if (!clinica) continue;

        for (const msg of value.messages ?? []) {
          if (msg.type !== "text" || !msg.text?.body) continue;

          try {
            await processarMensagem(
              supabase,
              clinica,
              phoneNumberId,
              msg.from,
              msg.text.body.trim(),
            );
          } catch (err) {
            console.error(`[webhook] erro ao processar ${msg.from}:`, err);
          }
        }
      }
    }

    return new Response("OK", { status: 200 });
  }

  return new Response("Method Not Allowed", { status: 405 });
});

// ---------------------------------------------------------------------------
// processarMensagem — fluxo completo para uma mensagem recebida
// ---------------------------------------------------------------------------

async function processarMensagem(
  supabase: DbClient,
  clinica: { id: string; nome: string; timezone: string },
  phoneNumberId: string,
  telefone: string,
  texto: string,
): Promise<void> {
  // 1. Histórico recente (últimas 10 mensagens, ordem cronológica)
  const { data: historicoDB } = await supabase
    .from("mensagens")
    .select("papel, conteudo")
    .eq("clinica_id", clinica.id)
    .eq("telefone", telefone)
    .order("created_at", { ascending: false })
    .limit(10);

  const historico = (
    (historicoDB as Array<{ papel: string; conteudo: string }> | null) ?? []
  )
    .reverse()
    .map((h) => ({ papel: h.papel as "user" | "assistant", conteudo: h.conteudo }));

  // 2. Gravar mensagem do paciente
  await supabase.from("mensagens").insert({
    clinica_id: clinica.id,
    telefone,
    papel:    "user",
    conteudo: texto,
  });

  // 3. SIM/NÃO para confirmação de agendamento (tratado antes do agente)
  const respostaConfirmacao = await tratarConfirmacaoAgendamento(
    supabase,
    clinica.id,
    clinica.timezone,
    phoneNumberId,
    telefone,
    texto,
  );
  if (respostaConfirmacao !== null) {
    await gravarEEnviar(supabase, clinica.id, phoneNumberId, telefone, respostaConfirmacao);
    return;
  }

  // 4. SIM/NÃO para oferta de vaga da lista de espera
  const respostaEspera = await tratarRespostaListaEspera(
    supabase,
    clinica.id,
    clinica.timezone,
    phoneNumberId,
    telefone,
    texto,
  );
  if (respostaEspera !== null) {
    await gravarEEnviar(supabase, clinica.id, phoneNumberId, telefone, respostaEspera);
    return;
  }

  // 5. Caso geral.
  // MVP: agente desligado → resposta-guia estática, sem chamar IA.
  if (!AGENTE_ATIVO) {
    await gravarEEnviar(supabase, clinica.id, phoneNumberId, telefone, MENSAGEM_FALLBACK);
    return;
  }

  // Fase 2: agente Claude com tool use (reativável via AGENTE_ATIVO=true).
  const respostaAgente = await chamarAgente({
    supabase,
    clinicaId:   clinica.id,
    clinicaNome: clinica.nome,
    telefone,
    mensagem: texto,
    historico,
    apiKey: ANTHROPIC_KEY,
    modelo: MODELO,
  });

  await gravarEEnviar(supabase, clinica.id, phoneNumberId, telefone, respostaAgente);
}

// ---------------------------------------------------------------------------
// tratarConfirmacaoAgendamento
//
// Intercepta "SIM"/"NÃO" quando há um agendamento aguardando confirmação
// (confirmacao_enviada_em IS NOT NULL AND status = 'agendado').
//
// SIM → status 'confirmado'
// NÃO → status 'cancelado' (a recuperação da vaga é disparada pelo trigger
//        trg_recuperar_vaga → Edge Function recuperar-vaga, não inline aqui)
//
// Retorna o texto de resposta ou null para passar ao próximo handler.
// ---------------------------------------------------------------------------

async function tratarConfirmacaoAgendamento(
  supabase: DbClient,
  clinicaId: string,
  timezone: string,
  _phoneNumberId: string, // não usado aqui desde que a oferta saiu para o trigger
  telefone: string,
  texto: string,
): Promise<string | null> {
  if (!ehRespostaBinaria(texto)) return null;

  // Encontrar paciente pelo telefone
  const { data: paciente } = await supabase
    .from("pacientes")
    .select("id")
    .eq("clinica_id", clinicaId)
    .eq("telefone", telefone)
    .single<{ id: string }>();

  if (!paciente) return null;

  // Encontrar o agendamento pendente de confirmação mais recente
  const { data: ag } = await supabase
    .from("agendamentos")
    .select("id, inicio, fim, profissional_id, profissionais!inner(nome)")
    .eq("clinica_id", clinicaId)
    .eq("paciente_id", paciente.id)
    .eq("status", "agendado")
    .not("confirmacao_enviada_em", "is", null)
    .order("confirmacao_enviada_em", { ascending: false })
    .limit(1)
    .single<{
      id: string;
      inicio: string;
      fim: string;
      profissional_id: string;
      profissionais: { nome: string };
    }>();

  if (!ag) return null;

  const isSim = normalizarResposta(texto) === "sim";

  if (isSim) {
    // Confirmar consulta
    await supabase
      .from("agendamentos")
      .update({ status: "confirmado" })
      .eq("id", ag.id);

    const dataHora = formatarDataHora(ag.inicio, timezone);
    return (
      `✅ Consulta confirmada! Te esperamos na ${dataHora} com *${ag.profissionais.nome}*. ` +
      `Até lá! 😊`
    );
  }

  // Cancelar consulta. A recuperação da vaga (oferta ao próximo da lista de
  // espera) é disparada automaticamente pelo trigger trg_recuperar_vaga →
  // Edge Function recuperar-vaga. Não ofertamos inline aqui para evitar
  // disparo duplicado e centralizar a lógica (cobre também cancelamento manual).
  await supabase
    .from("agendamentos")
    .update({ status: "cancelado" })
    .eq("id", ag.id);

  return (
    "Entendido, consulta cancelada. Caso queira remarcar, é só nos chamar aqui. " +
    "Tenha um ótimo dia! 😊"
  );
}

// ---------------------------------------------------------------------------
// tratarRespostaListaEspera
//
// Intercepta "SIM"/"NÃO" quando há uma oferta de vaga pendente
// (lista_espera.status = 'ofertado').
//
// SIM → aceitarOferta() (atômico: 'ofertado'→'aceito' + INSERT agendamento)
// NÃO → 'expirado' + re-oferta o mesmo slot ao próximo da fila
// ---------------------------------------------------------------------------

async function tratarRespostaListaEspera(
  supabase: DbClient,
  clinicaId: string,
  timezone: string,
  phoneNumberId: string,
  telefone: string,
  texto: string,
): Promise<string | null> {
  if (!ehRespostaBinaria(texto)) return null;

  const { data: paciente } = await supabase
    .from("pacientes")
    .select("id")
    .eq("clinica_id", clinicaId)
    .eq("telefone", telefone)
    .single<{ id: string }>();

  if (!paciente) return null;

  const { data: oferta } = await supabase
    .from("lista_espera")
    .select("id, profissional_id, slot_inicio, slot_fim")
    .eq("clinica_id", clinicaId)
    .eq("paciente_id", paciente.id)
    .eq("status", "ofertado")
    .order("ofertado_em", { ascending: false })
    .limit(1)
    .single<{
      id: string;
      profissional_id: string;
      slot_inicio: string | null;
      slot_fim: string | null;
    }>();

  if (!oferta) return null;

  const isSim = normalizarResposta(texto) === "sim";

  // ---- Recusou ---------------------------------------------------------------
  if (!isSim) {
    // Marcar atomicamente como 'expirado' (WHERE status = 'ofertado' evita
    // sobreposição com expirar-ofertas rodando em paralelo)
    await supabase
      .from("lista_espera")
      .update({ status: "expirado" })
      .eq("id", oferta.id)
      .eq("status", "ofertado");

    // Ofertar o mesmo slot ao próximo paciente da fila (se slot ainda estiver livre)
    if (oferta.slot_inicio && oferta.slot_fim) {
      try {
        await ofertarVaga(
          supabase,
          {
            clinica_id:      clinicaId,
            profissional_id: oferta.profissional_id,
            inicio:          oferta.slot_inicio,
            fim:             oferta.slot_fim,
          },
          {
            phoneNumberId,
            whatsappToken: WHATSAPP_TOKEN,
            templateVaga:  TEMPLATE_VAGA,
            timezone,
          },
        );
      } catch (err) {
        console.error("[webhook] Erro ao re-ofertar após recusa:", err);
      }
    }

    return (
      "Tudo bem! Você permanece na nossa lista de espera e será avisado " +
      "assim que surgir outro horário disponível. 😊"
    );
  }

  // ---- Aceitou ---------------------------------------------------------------
  if (!oferta.slot_inicio || !oferta.slot_fim) {
    // Oferta antiga (antes da migração 003) sem slot armazenado
    return (
      "Ocorreu um problema com esta oferta. Por favor, entre em contato com a clínica " +
      "para confirmar seu agendamento."
    );
  }

  // Aceite atômico com proteção contra corrida (duas camadas — ver listaEspera.ts)
  const resultado = await aceitarOferta(
    supabase,
    oferta.id,
    paciente.id,
    clinicaId,
    oferta.profissional_id,
    oferta.slot_inicio,
    oferta.slot_fim,
  );

  if (!resultado.sucesso) {
    // Slot tomado por corrida — tentar próximo paciente (este paciente já está
    // marcado como 'expirado' dentro de aceitarOferta)
    try {
      await ofertarVaga(
        supabase,
        {
          clinica_id:      clinicaId,
          profissional_id: oferta.profissional_id,
          inicio:          oferta.slot_inicio,
          fim:             oferta.slot_fim,
        },
        {
          phoneNumberId,
          whatsappToken: WHATSAPP_TOKEN,
          templateVaga:  TEMPLATE_VAGA,
          timezone,
        },
      );
    } catch (err) {
      console.error("[webhook] Erro ao ofertar após corrida:", err);
    }
    return resultado.mensagem;
  }

  const dataHora = formatarDataHora(oferta.slot_inicio, timezone);
  return `✅ Consulta confirmada para *${dataHora}*! Anote na agenda e até breve! 😊`;
}

// ---------------------------------------------------------------------------
// gravarEEnviar — persiste resposta do assistente e envia via Graph API
// ---------------------------------------------------------------------------

async function gravarEEnviar(
  supabase: DbClient,
  clinicaId: string,
  phoneNumberId: string,
  telefone: string,
  texto: string,
): Promise<void> {
  await supabase.from("mensagens").insert({
    clinica_id: clinicaId,
    telefone,
    papel:    "assistant",
    conteudo: texto,
  });

  await enviarTexto(phoneNumberId, telefone, texto, WHATSAPP_TOKEN);
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

/**
 * Normaliza a resposta do paciente para "sim" ou "nao".
 * MVP determinístico: "1" → sim, "2" → não (formato pedido nos templates).
 * Mantém também SIM/NÃO textuais por conveniência/compatibilidade.
 */
function normalizarResposta(texto: string): "sim" | "nao" | null {
  // Respostas numéricas têm prioridade (formato oficial dos templates "1"/"2").
  const bruto = texto.trim();
  if (bruto === "1") return "sim";
  if (bruto === "2") return "nao";

  const norm = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");

  if (["sim", "s", "confirmo", "ok", "aceito", "quero"].includes(norm)) return "sim";
  if (["nao", "n", "cancelar", "cancela", "recuso", "nope"].includes(norm)) return "nao";
  return null;
}

/** Retorna true se a mensagem pode ser uma resposta binária SIM/NÃO. */
function ehRespostaBinaria(texto: string): boolean {
  return normalizarResposta(texto) !== null;
}

/** Formata ISO UTC para data/hora legível no timezone da clínica. */
function formatarDataHora(isoUtc: string, timezone: string): string {
  return new Date(isoUtc).toLocaleString("pt-BR", {
    timeZone: timezone,
    weekday:  "long",
    day:      "numeric",
    month:    "long",
    year:     "numeric",
    hour:     "2-digit",
    minute:   "2-digit",
  });
}

/** Valida X-Hub-Signature-256 em tempo constante (evita timing attack). */
async function verificarHmac(
  corpo: string,
  segredo: string,
  assinaturaHeader: string,
): Promise<boolean> {
  const enc   = new TextEncoder();
  const chave = await crypto.subtle.importKey(
    "raw",
    enc.encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", chave, enc.encode(corpo));
  const hexCalculado = `sha256=${Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;

  if (hexCalculado.length !== assinaturaHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < hexCalculado.length; i++) {
    diff |= hexCalculado.charCodeAt(i) ^ assinaturaHeader.charCodeAt(i);
  }
  return diff === 0;
}
