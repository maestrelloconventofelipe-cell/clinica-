-- ============================================================
-- Migração 004 — MVP de confirmação determinística (1/2) + recuperação por trigger
-- ============================================================
-- Mudanças (todas incrementais, sem dropar dados):
--   1. agendamentos.status passa a aceitar 'recuperado' (vaga preenchida via fila).
--   2. clinicas.valor_consulta numeric — base do cálculo "Dinheiro salvo".
--   3. lista_espera.status passa a aceitar 'em_confirmacao' (claim anti-corrida);
--      garante ofertado_em; adiciona agendamento_ofertado_id (liga oferta ao agendamento).
--   4. Trigger AFTER UPDATE em agendamentos: ao virar 'cancelado', chama a Edge
--      Function recuperar-vaga via pg_net (substitui a chamada inline do webhook
--      e cobre também cancelamentos feitos manualmente pelo painel).
-- ============================================================


-- ------------------------------------------------------------
-- 1. agendamentos.status: + 'recuperado'
-- O CHECK inline criado em schema.sql tem nome padrão agendamentos_status_check.
-- ------------------------------------------------------------
ALTER TABLE agendamentos DROP CONSTRAINT IF EXISTS agendamentos_status_check;
ALTER TABLE agendamentos
  ADD CONSTRAINT agendamentos_status_check
  CHECK (status IN ('agendado','confirmado','cancelado','realizado','falta','recuperado'));


-- ------------------------------------------------------------
-- 2. clinicas.valor_consulta — valor médio da consulta (R$)
-- DEFAULT 0 garante linhas existentes válidas sem intervenção.
-- ------------------------------------------------------------
ALTER TABLE clinicas
  ADD COLUMN IF NOT EXISTS valor_consulta numeric NOT NULL DEFAULT 0
    CHECK (valor_consulta >= 0);

-- Valor de exemplo para a clínica de demonstração (no-op em produção).
UPDATE clinicas
   SET valor_consulta = 200
 WHERE id = 'a0000000-0000-0000-0000-000000000001'
   AND valor_consulta = 0;


-- ------------------------------------------------------------
-- 3. lista_espera: + 'em_confirmacao', ofertado_em, agendamento_ofertado_id
-- ------------------------------------------------------------
ALTER TABLE lista_espera DROP CONSTRAINT IF EXISTS lista_espera_status_check;
ALTER TABLE lista_espera
  ADD CONSTRAINT lista_espera_status_check
  CHECK (status IN ('aguardando','ofertado','em_confirmacao','aceito','expirado'));

-- ofertado_em já existe no schema base; mantido aqui por idempotência.
ALTER TABLE lista_espera
  ADD COLUMN IF NOT EXISTS ofertado_em timestamptz;

-- Liga a entrada da fila ao agendamento criado quando a oferta é aceita.
ALTER TABLE lista_espera
  ADD COLUMN IF NOT EXISTS agendamento_ofertado_id uuid REFERENCES agendamentos(id);

-- O índice de expiração (migração 003) cobre status='ofertado'. Estendemos a
-- varredura para incluir 'em_confirmacao' (claims órfãos). Índice dedicado:
CREATE INDEX IF NOT EXISTS lista_espera_em_confirmacao_idx
  ON lista_espera (ofertado_em)
  WHERE status = 'em_confirmacao';


-- ============================================================
-- 4. Trigger de recuperação de vaga via pg_net
-- ============================================================
-- Ao cancelar um agendamento, dispara (assíncrono, pós-commit) a Edge Function
-- recuperar-vaga, que oferece o slot ao primeiro paciente compatível da fila.
--
-- Credenciais NÃO ficam no código: são lidas de GUCs definidas fora deste arquivo
-- (padrão Supabase para webhooks de banco):
--   ALTER DATABASE postgres SET app.settings.project_ref       = '<PROJECT_REF>';
--   ALTER DATABASE postgres SET app.settings.service_role_key  = '<SERVICE_ROLE_KEY>';
-- Se qualquer uma estiver ausente, o trigger é no-op — nunca derruba o UPDATE.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION disparar_recuperar_vaga()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_project_ref text := current_setting('app.settings.project_ref', true);
  v_service_key text := current_setting('app.settings.service_role_key', true);
BEGIN
  -- Só reage à transição para 'cancelado'
  IF NEW.status <> 'cancelado' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Config ausente → não faz nada (mantém o cancelamento funcionando)
  IF v_project_ref IS NULL OR v_service_key IS NULL
     OR v_project_ref = '' OR v_service_key = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://' || v_project_ref || '.supabase.co/functions/v1/recuperar-vaga',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    := jsonb_build_object('agendamento_id', NEW.id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recuperar_vaga ON agendamentos;
CREATE TRIGGER trg_recuperar_vaga
  AFTER UPDATE OF status ON agendamentos
  FOR EACH ROW
  WHEN (NEW.status = 'cancelado' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION disparar_recuperar_vaga();
