// Módulo de lista de espera — oferta, aceite e expiração de vagas.
//
// Garantia contra corrida (dois pacientes aceitando a mesma vaga):
//   Camada 1 — UPDATE atômico (WHERE status = 'ofertado') impede que dois
//              workers avancem para o INSERT ao mesmo tempo.
//   Camada 2 — Restrição EXCLUDE em agendamentos bloqueia qualquer inserção
//              sobreposta que escape da camada 1 (ex.: agendamento manual
//              simultâneo).

import { toZonedTime } from "npm:date-fns-tz@3";
import type { DbClient } from "./db.ts";
import { estaLivre } from "./agenda.ts";
import { enviarTemplate } from "./whatsapp.ts";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface AgendamentoCancelado {
  clinica_id:      string;
  profissional_id: string;
  inicio:          string; // ISO 8601 UTC
  fim:             string; // ISO 8601 UTC
}

export interface OpcoesOferta {
  phoneNumberId: string;
  whatsappToken: string;
  templateVaga:  string; // nome do template pré-aprovado no Meta Business Manager
  timezone:      string;
}

export interface ResultadoAceite {
  sucesso:        boolean;
  mensagem:       string;
  agendamentoId?: string;
}

export interface EntradaExpirada {
  id:              string;
  clinica_id:      string;
  profissional_id: string;
  slot_inicio:     string; // garantido não-nulo pelo filtro da query
  slot_fim:        string;
  pacientes:       { nome: string; telefone: string };
}

// ---------------------------------------------------------------------------
// ofertarVaga
//
// Oferece o slot especificado ao primeiro paciente 'aguardando' na fila do
// profissional cuja preferência de horário combina com o início do slot.
// Armazena slot_inicio e slot_fim na entrada para permitir re-oferta posterior.
//
// Retorna true se uma oferta foi enviada, false caso contrário.
// ---------------------------------------------------------------------------

export async function ofertarVaga(
  supabase: DbClient,
  ag: AgendamentoCancelado,
  opcoes: OpcoesOferta,
): Promise<boolean> {
  const { clinica_id, profissional_id, inicio, fim } = ag;
  const { phoneNumberId, whatsappToken, templateVaga, timezone } = opcoes;

  // Confirmar que o slot ainda está livre antes de qualquer operação
  const livre = await estaLivre(supabase, profissional_id, inicio, fim);
  if (!livre) return false;

  const { data: prof } = await supabase
    .from("profissionais")
    .select("nome")
    .eq("id", profissional_id)
    .single<{ nome: string }>();

  if (!prof) return false;

  // Buscar fila 'aguardando' deste profissional em ordem FIFO
  type FilaRow = {
    id:           string;
    paciente_id:  string;
    preferencia:  string | null;
    pacientes: { nome: string; telefone: string };
  };

  const { data: fila } = await supabase
    .from("lista_espera")
    .select("id, paciente_id, preferencia, pacientes!inner(nome, telefone)")
    .eq("clinica_id", clinica_id)
    .eq("profissional_id", profissional_id)
    .eq("status", "aguardando")
    .order("created_at", { ascending: true });

  if (!fila?.length) return false;

  // Primeiro candidato cuja preferência combina com o horário da vaga
  const candidato = (fila as unknown as FilaRow[]).find(
    (e) => preferenciaCombina(e.preferencia, inicio, timezone),
  );

  if (!candidato) return false;

  // Marcar atomicamente como 'ofertado', guardando o slot.
  // WHERE status = 'aguardando' é a barreira de corrida: garante que apenas
  // um worker avança quando há múltiplas execuções simultâneas.
  const { data: marcado } = await supabase
    .from("lista_espera")
    .update({
      status:      "ofertado",
      ofertado_em: new Date().toISOString(),
      slot_inicio: inicio,
      slot_fim:    fim,
    })
    .eq("id", candidato.id)
    .eq("status", "aguardando")
    .select("id");

  if (!marcado?.length) return false; // outro worker chegou antes

  const dataHora  = formatarDataHora(inicio, timezone);
  const telefone  = candidato.pacientes.telefone;

  // Template esperado: "Uma vaga abriu com *{{1}}* para *{{2}}*.
  //   Responda *1* para confirmar ou *2* para recusar."
  await enviarTemplate(
    phoneNumberId,
    telefone,
    templateVaga,
    [prof.nome, dataHora],
    whatsappToken,
  );

  await supabase.from("mensagens").insert({
    clinica_id,
    telefone,
    papel:    "assistant",
    conteudo: `[Vaga ofertada] ${prof.nome} em ${dataHora}. Aguardando SIM ou NÃO.`,
  });

  return true;
}

// ---------------------------------------------------------------------------
// aceitarOferta
//
// Aceita atomicamente uma oferta e cria o agendamento correspondente.
//
// Fluxo (estado 'em_confirmacao' como trava de claim):
//   1. UPDATE atômico: 'ofertado' → 'em_confirmacao' (Camada 1 anti-corrida).
//      Se retornar 0 linhas, a oferta expirou ou outro worker já a reivindicou
//      (ex.: duas respostas "1" simultâneas — só uma vence o claim).
//   2. INSERT em agendamentos com status 'recuperado' (Camada 2: EXCLUDE bloqueia
//      sobreposição residual). Se falhar, reverter para 'expirado' e retornar falha.
//   3. UPDATE final: 'em_confirmacao' → 'aceito', gravando agendamento_ofertado_id.
// ---------------------------------------------------------------------------

export async function aceitarOferta(
  supabase: DbClient,
  ofertaId:       string,
  pacienteId:     string,
  clinicaId:      string,
  profissionalId: string,
  slotInicio:     string,
  slotFim:        string,
): Promise<ResultadoAceite> {
  // Camada 1: claim atômico 'ofertado' → 'em_confirmacao'
  const { data: claimed } = await supabase
    .from("lista_espera")
    .update({ status: "em_confirmacao" })
    .eq("id", ofertaId)
    .eq("status", "ofertado") // barreira de corrida
    .select("id");

  if (!claimed?.length) {
    return {
      sucesso:  false,
      mensagem:
        "Essa oferta não está mais disponível (expirou ou já foi aceita por outro paciente). " +
        "Você continua na lista de espera e será avisado assim que surgir outra vaga! 😊",
    };
  }

  // Camada 2: criar agendamento 'recuperado' — EXCLUDE no banco é a barreira final
  const { data: ag, error: agErr } = await supabase
    .from("agendamentos")
    .insert({
      clinica_id:      clinicaId,
      profissional_id: profissionalId,
      paciente_id:     pacienteId,
      inicio:          slotInicio,
      fim:             slotFim,
      status:          "recuperado",
      origem:          "whatsapp",
    })
    .select("id")
    .single<{ id: string }>();

  if (agErr || !ag) {
    // Horário foi tomado por agendamento manual simultâneo (EXCLUDE disparou).
    // Reverter o claim para que o paciente não fique preso sem agendamento.
    await supabase
      .from("lista_espera")
      .update({ status: "expirado" })
      .eq("id", ofertaId);

    return {
      sucesso:  false,
      mensagem:
        "Infelizmente o horário foi ocupado por outro paciente no último segundo. " +
        "Você continua na lista de espera e será avisado da próxima vaga! 😊",
    };
  }

  // Passo 3: confirmar o aceite e ligar a entrada da fila ao agendamento criado
  await supabase
    .from("lista_espera")
    .update({ status: "aceito", agendamento_ofertado_id: ag.id })
    .eq("id", ofertaId);

  return {
    sucesso:        true,
    mensagem:       "",
    agendamentoId:  ag.id,
  };
}

// ---------------------------------------------------------------------------
// expirarOfertasAntigas
//
// Marca como 'expirado' as ofertas sem resposta há mais de `limiteMinutos`
// e retorna as entradas expiradas para que o chamador possa re-ofertar ao
// próximo paciente da fila.
//
// Cada entrada é processada individualmente com UPDATE atômico
// (WHERE status = 'ofertado') para proteger contra execuções paralelas
// do pg_cron ou chamadas manuais simultâneas.
// ---------------------------------------------------------------------------

export async function expirarOfertasAntigas(
  supabase: DbClient,
  limiteMinutos = 30,
): Promise<EntradaExpirada[]> {
  const corte = new Date(Date.now() - limiteMinutos * 60_000).toISOString();

  type CandidatoRow = {
    id:              string;
    clinica_id:      string;
    profissional_id: string;
    slot_inicio:     string;
    slot_fim:        string;
    paciente_id:     string;
    status:          string; // 'ofertado' | 'em_confirmacao'
  };

  // Selecionar candidatos (sem join, para evitar dependência de lock na query).
  // Inclui 'em_confirmacao' para recuperar claims órfãos (processo que travou
  // entre o claim e a confirmação final do aceite).
  const { data: candidatos } = await supabase
    .from("lista_espera")
    .select("id, clinica_id, profissional_id, slot_inicio, slot_fim, paciente_id, status")
    .in("status", ["ofertado", "em_confirmacao"])
    .lt("ofertado_em", corte)
    .not("slot_inicio", "is", null)
    .not("slot_fim", "is", null);

  if (!candidatos?.length) return [];

  const expiradas: EntradaExpirada[] = [];

  for (const c of candidatos as CandidatoRow[]) {
    // Marcar atomicamente — se outro worker/aceite já mudou esta entrada, pula.
    // A barreira usa o status lido (c.status): se aceitarOferta já avançou para
    // 'aceito', o UPDATE não casa e a entrada é ignorada.
    const { data: marcado } = await supabase
      .from("lista_espera")
      .update({ status: "expirado" })
      .eq("id", c.id)
      .eq("status", c.status) // barreira de corrida
      .select("id");

    if (!marcado?.length) continue;

    // Buscar dados do paciente para notificação
    const { data: paciente } = await supabase
      .from("pacientes")
      .select("nome, telefone")
      .eq("id", c.paciente_id)
      .single<{ nome: string; telefone: string }>();

    if (!paciente) continue;

    expiradas.push({
      id:              c.id,
      clinica_id:      c.clinica_id,
      profissional_id: c.profissional_id,
      slot_inicio:     c.slot_inicio,
      slot_fim:        c.slot_fim,
      pacientes:       paciente,
    });
  }

  return expiradas;
}

// ---------------------------------------------------------------------------
// Utilitários internos
// ---------------------------------------------------------------------------

/**
 * Verifica se a preferência do paciente é compatível com o horário do slot.
 * Normaliza acentos e caixa antes de comparar.
 * "qualquer" (ou sem preferência) → sempre combina.
 */
function preferenciaCombina(
  preferencia: string | null,
  inicioUtc: string,
  timezone: string,
): boolean {
  if (!preferencia) return true;

  const norm = preferencia
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

  if (norm === "qualquer" || norm === "") return true;

  const hora = toZonedTime(new Date(inicioUtc), timezone).getHours();

  if (norm.includes("manha")) return hora >= 6  && hora < 12;
  if (norm.includes("tarde")) return hora >= 12 && hora < 18;
  if (norm.includes("noite")) return hora >= 18;

  return true; // preferência desconhecida → não filtrar
}

function formatarDataHora(isoUtc: string, timezone: string): string {
  return new Date(isoUtc).toLocaleString("pt-BR", {
    timeZone: timezone,
    weekday:  "long",
    day:      "numeric",
    month:    "long",
    hour:     "2-digit",
    minute:   "2-digit",
  });
}
