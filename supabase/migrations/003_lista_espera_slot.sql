-- ============================================================
-- Migração 003 — rastrear slot ofertado na lista de espera
-- ============================================================
-- Armazena o horário exato que foi ofertado a cada paciente.
-- Necessário para re-ofertar o mesmo slot ao próximo da fila
-- quando o paciente atual recusa ou deixa a oferta expirar.
-- ============================================================

ALTER TABLE lista_espera
  ADD COLUMN IF NOT EXISTS slot_inicio timestamptz,
  ADD COLUMN IF NOT EXISTS slot_fim    timestamptz;

-- Índice para a query de expiração (busca 'ofertado' + ofertado_em antigo)
CREATE INDEX IF NOT EXISTS lista_espera_expirar_idx
  ON lista_espera (ofertado_em)
  WHERE status = 'ofertado';


-- ============================================================
-- pg_cron — expirar ofertas sem resposta a cada 10 minutos
-- ============================================================
-- Preencha <PROJECT_REF> e <SERVICE_ROLE_KEY> antes de descomentar.

/*
SELECT cron.schedule(
  'expirar-ofertas-10min',
  '*/10 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/expirar-ofertas',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      body    := '{}'::jsonb
    );
  $$
);
*/

-- Remover o job se necessário:
-- SELECT cron.unschedule('expirar-ofertas-10min');
