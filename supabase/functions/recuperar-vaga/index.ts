// Edge Function — recuperar-vaga
// Acionada pelo trigger trg_recuperar_vaga (migração 004) via pg_net quando um
// agendamento passa para 'cancelado'. Também cobre cancelamentos feitos
// manualmente pelo painel — centraliza a recuperação que antes era inline no webhook.
// verify_jwt = true (padrão): o pg_net envia SUPABASE_SERVICE_ROLE_KEY como Bearer.
//
// Fluxo:
//   1. Recebe { agendamento_id }.
//   2. Carrega o agendamento (profissional, slot) e a clínica (phone_number_id, timezone).
//   3. Chama ofertarVaga() — oferece o slot ao 1º paciente compatível da fila.
//      (ofertarVaga revalida estaLivre internamente antes de ofertar.)

import { createClient } from "npm:@supabase/supabase-js@2";
import type { DbClient } from "../_shared/db.ts";
import { ofertarVaga } from "../_shared/listaEspera.ts";

const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const TEMPLATE_VAGA  = Deno.env.get("TEMPLATE_VAGA") ?? "vaga_disponivel";

interface AgendamentoRow {
  clinica_id:      string;
  profissional_id: string;
  inicio:          string;
  fim:             string;
  status:          string;
  clinicas: {
    whatsapp_phone_number_id: string | null;
    timezone: string;
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  let agendamentoId: string | undefined;
  try {
    const body = await req.json();
    agendamentoId = body?.agendamento_id;
  } catch {
    return resposta({ erro: "Corpo inválido — esperado { agendamento_id }" }, 400);
  }

  if (!agendamentoId) {
    return resposta({ erro: "agendamento_id ausente" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  ) as DbClient;

  // Carregar o agendamento cancelado + dados da clínica
  const { data: ag, error } = await supabase
    .from("agendamentos")
    .select(`
      clinica_id,
      profissional_id,
      inicio,
      fim,
      status,
      clinicas!inner ( whatsapp_phone_number_id, timezone )
    `)
    .eq("id", agendamentoId)
    .single<AgendamentoRow>();

  if (error || !ag) {
    return resposta({ erro: "Agendamento não encontrado" }, 404);
  }

  // Defesa: só recupera vaga de agendamento de fato cancelado.
  if (ag.status !== "cancelado") {
    return resposta({ ignorado: true, motivo: `status=${ag.status}` });
  }

  const phoneNumberId = ag.clinicas.whatsapp_phone_number_id;
  if (!phoneNumberId) {
    return resposta({ ignorado: true, motivo: "clínica sem whatsapp_phone_number_id" });
  }

  const ofertado = await ofertarVaga(
    supabase,
    {
      clinica_id:      ag.clinica_id,
      profissional_id: ag.profissional_id,
      inicio:          ag.inicio,
      fim:             ag.fim,
    },
    {
      phoneNumberId,
      whatsappToken: WHATSAPP_TOKEN,
      templateVaga:  TEMPLATE_VAGA,
      timezone:      ag.clinicas.timezone,
    },
  );

  return resposta({ ofertado });
});

function resposta(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
