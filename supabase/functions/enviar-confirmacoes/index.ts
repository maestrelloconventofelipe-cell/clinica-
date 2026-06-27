// Edge Function — enviar-confirmacoes
// Chamada de hora em hora pelo pg_cron via pg_net (ver schema.sql).
// verify_jwt = true (padrão): o pg_net passa SUPABASE_SERVICE_ROLE_KEY como Bearer.
//
// Fluxo:
//   1. Busca agendamentos com status='agendado', confirmacao_enviada_em IS NULL,
//      e inicio dentro da janela configurável (padrão: ±30 min ao redor de 24h).
//   2. Marca imediatamente o campo (atômica contra execuções paralelas).
//   3. Envia template "confirmacao_consulta" via Cloud API.
//   4. Registra em mensagens para histórico.

import { createClient } from "npm:@supabase/supabase-js@2";
import type { DbClient } from "../_shared/db.ts";
import { enviarTemplate } from "../_shared/whatsapp.ts";

// ---------------------------------------------------------------------------
// Configuração via secrets
// ---------------------------------------------------------------------------

const WHATSAPP_TOKEN    = Deno.env.get("WHATSAPP_TOKEN") ?? "";
// Nome do template pré-aprovado no Meta Business Manager.
// Body esperado: "Olá! Sua consulta com *{{1}}* está agendada para *{{2}}*. Responda *1* para confirmar ou *2* para cancelar."
const TEMPLATE_CONFIRMACAO = Deno.env.get("TEMPLATE_CONFIRMACAO") ?? "confirmacao_consulta";
// Antecedência alvo em horas (o cron busca agendamentos em alvo ± JANELA_MIN minutos)
const HORAS_ANTECEDENCIA   = parseInt(Deno.env.get("CONFIRMACAO_HORAS_ANTECEDENCIA") ?? "24");
const JANELA_MIN           = parseInt(Deno.env.get("CONFIRMACAO_JANELA_MIN") ?? "30");

// ---------------------------------------------------------------------------
// Tipos — subconjunto das colunas lidas
// ---------------------------------------------------------------------------

interface AgendamentoRow {
  id: string;
  inicio: string;
  clinica_id: string;
  profissional_id: string;
  clinicas: {
    whatsapp_phone_number_id: string;
    timezone: string;
  };
  profissionais: { nome: string };
  pacientes:     { nome: string; telefone: string };
}

// ---------------------------------------------------------------------------
Deno.serve(async (): Promise<Response> => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  ) as DbClient;

  const agora    = new Date();
  const alvo     = new Date(agora.getTime() + HORAS_ANTECEDENCIA * 3_600_000);
  const janelaDe = new Date(alvo.getTime() - JANELA_MIN * 60_000);
  const janelaAte = new Date(alvo.getTime() + JANELA_MIN * 60_000);

  // 1. Buscar candidatos (confirmacao_enviada_em IS NULL garante sem duplicata)
  const { data: candidatos, error } = await supabase
    .from("agendamentos")
    .select(`
      id,
      inicio,
      clinica_id,
      profissional_id,
      clinicas!inner ( whatsapp_phone_number_id, timezone ),
      profissionais!inner ( nome ),
      pacientes!inner ( nome, telefone )
    `)
    .eq("status", "agendado")
    .is("confirmacao_enviada_em", null)
    .gte("inicio", janelaDe.toISOString())
    .lte("inicio", janelaAte.toISOString());

  if (error) {
    console.error("[enviar-confirmacoes] Erro na query:", error.message);
    return resposta({ erro: error.message }, 500);
  }

  let enviados = 0;
  let falhas   = 0;

  for (const ag of (candidatos as unknown as AgendamentoRow[]) ?? []) {
    // 2. Marcação atômica: UPDATE só aplica se confirmacao_enviada_em ainda for NULL.
    //    Protege contra execuções paralelas do pg_cron.
    const { data: marcado } = await supabase
      .from("agendamentos")
      .update({ confirmacao_enviada_em: agora.toISOString() })
      .eq("id", ag.id)
      .is("confirmacao_enviada_em", null)
      .select("id");

    if (!marcado?.length) continue; // outro worker chegou primeiro

    try {
      await processarConfirmacao(supabase, ag);
      enviados++;
    } catch (err) {
      falhas++;
      console.error(`[enviar-confirmacoes] Falha no agendamento ${ag.id}:`, err);
      // Reverter a marcação para que o próximo ciclo do cron tente novamente
      await supabase
        .from("agendamentos")
        .update({ confirmacao_enviada_em: null })
        .eq("id", ag.id);
    }
  }

  return resposta({ enviados, falhas, total: candidatos?.length ?? 0 });
});

// ---------------------------------------------------------------------------
// processarConfirmacao — envia o template e registra no histórico
// ---------------------------------------------------------------------------

async function processarConfirmacao(
  supabase: DbClient,
  ag: AgendamentoRow,
): Promise<void> {
  const { clinicas, profissionais, pacientes } = ag;
  const { whatsapp_phone_number_id, timezone } = clinicas;

  const dataHora = formatarDataHora(ag.inicio, timezone);

  // 3. Enviar template via Graph API
  await enviarTemplate(
    whatsapp_phone_number_id,
    pacientes.telefone,
    TEMPLATE_CONFIRMACAO,
    [profissionais.nome, dataHora],   // {{1}} = profissional, {{2}} = data e hora
    WHATSAPP_TOKEN,
  );

  // 4. Registrar no histórico de mensagens para contexto do agente
  await supabase.from("mensagens").insert({
    clinica_id: ag.clinica_id,
    telefone:   pacientes.telefone,
    papel:      "assistant",
    conteudo:   `[Confirmação enviada] Consulta com ${profissionais.nome} em ${dataHora}. Aguardando SIM ou NÃO do paciente.`,
  });
}

// ---------------------------------------------------------------------------
// formatarDataHora — converte ISO UTC para data legível no timezone da clínica
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// resposta — helper para Response JSON
// ---------------------------------------------------------------------------

function resposta(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
