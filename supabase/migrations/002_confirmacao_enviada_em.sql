-- ============================================================
-- Migração 002 — rastrear envio de confirmação de consulta
-- ============================================================
-- Adiciona confirmacao_enviada_em à tabela agendamentos para que
-- a Edge Function enviar-confirmacoes saiba quais já foram notificados
-- e para evitar duplicatas em caso de re-execução do pg_cron.
-- ============================================================

ALTER TABLE agendamentos
  ADD COLUMN IF NOT EXISTS confirmacao_enviada_em timestamptz;

-- Índice parcial: acelera a query do cron que filtra os candidatos.
-- Cobre apenas os agendamentos ainda não confirmados e ativos.
CREATE INDEX IF NOT EXISTS agendamentos_pendentes_confirmacao_idx
  ON agendamentos (inicio, clinica_id)
  WHERE status = 'agendado'
    AND confirmacao_enviada_em IS NULL;

-- RLS: a nova coluna herda automaticamente as policies existentes.
-- Nenhuma alteração de policy necessária.
