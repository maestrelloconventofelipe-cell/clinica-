// Edge Function — expirar-ofertas
// Acionada pelo pg_cron a cada 10 minutos (ver migração 003).
// verify_jwt = true (padrão): pg_cron envia SUPABASE_SERVICE_ROLE_KEY como Bearer.
//
// Fluxo por entrada expirada:
//   1. expirarOfertasAntigas() marca atomicamente 'ofertado' → 'expirado'.
//   2. Notifica o paciente que o tempo esgotou.
//   3. Tenta re-ofertar o mesmo slot ao próximo 'aguardando' da fila
//      (ofertarVaga verifica estaLivre internamente antes de enviar).

import { createClient } from "npm:@supabase/supabase-js@2";
import type { DbClient } from "../_shared/db.ts";
import {
  expirarOfertasAntigas,
  ofertarVaga,
} from "../_shared/listaEspera.ts";
import { enviarTexto } from "../_shared/whatsapp.ts";

// ---------------------------------------------------------------------------
// Configuração via secrets
// ---------------------------------------------------------------------------

const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const TEMPLATE_VAGA  = Deno.env.get("TEMPLATE_VAGA") ?? "vaga_disponivel";
const LIMITE_MIN     = parseInt(Deno.env.get("OFERTA_LIMITE_MIN") ?? "30");

// ---------------------------------------------------------------------------

Deno.serve(async (): Promise<Response> => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  ) as DbClient;

  // Expirar atomicamente todas as ofertas sem resposta dentro do limite
  const expiradas = await expirarOfertasAntigas(supabase, LIMITE_MIN);

  let notificadas  = 0;
  let reofertadas  = 0;
  let falhas       = 0;

  for (const entrada of expiradas) {
    // Carregar dados da clínica para obter phone_number_id e timezone
    const { data: clinica } = await supabase
      .from("clinicas")
      .select("whatsapp_phone_number_id, timezone")
      .eq("id", entrada.clinica_id)
      .single<{ whatsapp_phone_number_id: string | null; timezone: string }>();

    if (!clinica?.whatsapp_phone_number_id) continue;

    const { whatsapp_phone_number_id: phoneNumberId, timezone } = clinica;
    const { telefone } = entrada.pacientes;

    try {
      // Notificar paciente sobre expiração
      await enviarTexto(
        phoneNumberId,
        telefone,
        "⏰ O tempo para confirmar a consulta expirou. " +
        "Você permanece na lista de espera e será avisado assim que surgir outra vaga!",
        WHATSAPP_TOKEN,
      );

      await supabase.from("mensagens").insert({
        clinica_id: entrada.clinica_id,
        telefone,
        papel:      "assistant",
        conteudo:   "[Oferta expirada] Paciente não respondeu a tempo. Permanece na fila.",
      });

      notificadas++;

      // Tentar re-ofertar o mesmo slot ao próximo paciente da fila
      const ofertado = await ofertarVaga(
        supabase,
        {
          clinica_id:      entrada.clinica_id,
          profissional_id: entrada.profissional_id,
          inicio:          entrada.slot_inicio,
          fim:             entrada.slot_fim,
        },
        {
          phoneNumberId,
          whatsappToken: WHATSAPP_TOKEN,
          templateVaga:  TEMPLATE_VAGA,
          timezone,
        },
      );

      if (ofertado) reofertadas++;
    } catch (err) {
      falhas++;
      console.error(
        `[expirar-ofertas] Erro ao processar entrada ${entrada.id}:`,
        err,
      );
    }
  }

  return new Response(
    JSON.stringify({
      expiradas:   expiradas.length,
      notificadas,
      reofertadas,
      falhas,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
