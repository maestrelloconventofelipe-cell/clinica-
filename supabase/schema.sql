-- ============================================================
-- Recepção IA — Schema principal
-- ============================================================
-- Convenção: domínio em português, multi-tenant via clinica_id.
-- RLS ativado em todas as tabelas; isolamento garantido pelas
-- funções clinica_do_usuario() e eh_admin() (security definer).
-- ============================================================


-- ============================================================
-- EXTENSÕES
-- ============================================================

-- Necessária para o EXCLUDE em agendamentos (evitar sobreposição de horários)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Chamadas HTTP de dentro do banco (usado pelo pg_cron abaixo)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Agendamento periódico sem servidor externo
CREATE EXTENSION IF NOT EXISTS pg_cron;


-- ============================================================
-- TABELAS
-- ============================================================

-- ------------------------------------------------------------
-- clinicas — tabela-raiz do multi-tenant; cada linha é um tenant
-- ------------------------------------------------------------
CREATE TABLE clinicas (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                     text        NOT NULL,
  slug                     text        NOT NULL UNIQUE,         -- identificador legível, usado em URLs
  whatsapp_phone_number_id text,                                -- ID do número registrado na Meta Graph API
  timezone                 text        NOT NULL DEFAULT 'America/Sao_Paulo',
  ativo                    boolean     NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- perfis — uma linha por usuário; vincula auth.users à clínica
-- ------------------------------------------------------------
CREATE TABLE perfis (
  id         uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  clinica_id uuid        NOT NULL REFERENCES clinicas(id),
  nome       text        NOT NULL,
  papel      text        NOT NULL CHECK (papel IN ('admin', 'recepcao')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- profissionais — médicos, dentistas, etc. vinculados à clínica
-- ------------------------------------------------------------
CREATE TABLE profissionais (
  id                 uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id         uuid    NOT NULL REFERENCES clinicas(id),
  nome               text    NOT NULL,
  especialidade      text,
  duracao_padrao_min int     NOT NULL DEFAULT 30 CHECK (duracao_padrao_min > 0),
  ativo              boolean NOT NULL DEFAULT true
);

-- ------------------------------------------------------------
-- horarios_atendimento — grade semanal de disponibilidade
-- dia_semana: 0 = domingo … 6 = sábado
-- Um profissional pode ter mais de um bloco por dia (ex: manhã e tarde)
-- ------------------------------------------------------------
CREATE TABLE horarios_atendimento (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional_id uuid NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
  dia_semana      int  NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  inicio          time NOT NULL,
  fim             time NOT NULL,
  CONSTRAINT horario_inicio_antes_fim CHECK (inicio < fim),
  UNIQUE (profissional_id, dia_semana, inicio)   -- permite dois blocos no mesmo dia
);

-- ------------------------------------------------------------
-- pacientes — cadastro de pacientes da clínica
-- telefone é a chave natural para identificação via WhatsApp (formato E.164)
-- ------------------------------------------------------------
CREATE TABLE pacientes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid        NOT NULL REFERENCES clinicas(id),
  nome       text        NOT NULL,
  telefone   text        NOT NULL,                             -- ex: +5511999999999
  obs        text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinica_id, telefone)
);

-- ------------------------------------------------------------
-- agendamentos — consultas marcadas
-- EXCLUDE impede sobreposição de horários do mesmo profissional;
-- agendamentos com status 'cancelado' são excluídos da restrição.
-- ------------------------------------------------------------
CREATE TABLE agendamentos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      uuid        NOT NULL REFERENCES clinicas(id),
  profissional_id uuid        NOT NULL REFERENCES profissionais(id),
  paciente_id     uuid        NOT NULL REFERENCES pacientes(id),
  inicio          timestamptz NOT NULL,
  fim             timestamptz NOT NULL,
  status          text        NOT NULL DEFAULT 'agendado'
                              CHECK (status IN ('agendado','confirmado','cancelado','realizado','falta')),
  origem          text        NOT NULL DEFAULT 'manual'
                              CHECK (origem IN ('whatsapp','manual')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agendamento_inicio_antes_fim CHECK (inicio < fim),
  -- garante que dois agendamentos ativos não se sobreponham para o mesmo profissional
  EXCLUDE USING gist (
    profissional_id WITH =,
    tstzrange(inicio, fim, '[)') WITH &&
  ) WHERE (status <> 'cancelado')
);

-- ------------------------------------------------------------
-- lista_espera — pacientes aguardando um horário disponível
-- ofertado_em: instante em que o sistema enviou a oferta de horário
-- ------------------------------------------------------------
CREATE TABLE lista_espera (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      uuid        NOT NULL REFERENCES clinicas(id),
  profissional_id uuid        NOT NULL REFERENCES profissionais(id),
  paciente_id     uuid        NOT NULL REFERENCES pacientes(id),
  preferencia     text,                                        -- ex: "manhã", "qualquer"
  status          text        NOT NULL DEFAULT 'aguardando'
                              CHECK (status IN ('aguardando','ofertado','aceito','expirado')),
  ofertado_em     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- mensagens — histórico de conversas WhatsApp por telefone
-- Inserção feita exclusivamente via Edge Functions (service_role).
-- ------------------------------------------------------------
CREATE TABLE mensagens (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid        NOT NULL REFERENCES clinicas(id),
  telefone   text        NOT NULL,                             -- número do paciente (E.164)
  papel      text        NOT NULL CHECK (papel IN ('user','assistant')),
  conteudo   text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);


-- ============================================================
-- ÍNDICES DE DESEMPENHO
-- ============================================================

-- disponibilidade: consulta principal do motor de agendamento
CREATE INDEX ON agendamentos (clinica_id, profissional_id, inicio);

-- lookup de paciente a partir do número WhatsApp
CREATE INDEX ON pacientes (clinica_id, telefone);

-- histórico de conversa em ordem cronológica
CREATE INDEX ON mensagens (clinica_id, telefone, created_at DESC);

-- lista de espera ativa (partial index — só as entradas relevantes)
CREATE INDEX ON lista_espera (clinica_id, created_at)
  WHERE status = 'aguardando';

-- perfil do usuário por clínica
CREATE INDEX ON perfis (clinica_id);


-- ============================================================
-- FUNÇÕES AUXILIARES (SECURITY DEFINER)
-- ============================================================
-- Executam com os privilégios do dono da função para ler a tabela
-- perfis antes que a RLS da própria tabela seja avaliada.
-- SET search_path = public evita ataques de substituição de schema.

-- Retorna o clinica_id do usuário autenticado na sessão atual.
CREATE OR REPLACE FUNCTION clinica_do_usuario()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT clinica_id
  FROM   perfis
  WHERE  id = auth.uid()
  LIMIT  1;
$$;

-- Retorna true se o usuário autenticado tem papel 'admin'.
CREATE OR REPLACE FUNCTION eh_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   perfis
    WHERE  id    = auth.uid()
      AND  papel = 'admin'
  );
$$;


-- ============================================================
-- ROW-LEVEL SECURITY — habilitar em todas as tabelas
-- ============================================================

ALTER TABLE clinicas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE perfis                ENABLE ROW LEVEL SECURITY;
ALTER TABLE profissionais         ENABLE ROW LEVEL SECURITY;
ALTER TABLE horarios_atendimento  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pacientes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE agendamentos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE lista_espera          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensagens             ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- POLICIES
-- ============================================================
-- Regra geral:
--   • Todos os usuários autenticados da clínica podem ler os dados dela.
--   • recepcao pode inserir e atualizar registros operacionais.
--   • admin pode inserir, atualizar e deletar tudo da própria clínica.
--   • service_role (Edge Functions) bypassa RLS — sem policy necessária.


-- ------------------------------------------------------------
-- clinicas
-- Usuário só enxerga a própria clínica; apenas admin atualiza.
-- Criação de clínicas é operação administrativa (service_role).
-- ------------------------------------------------------------
CREATE POLICY "clinicas: ver a propria"
  ON clinicas FOR SELECT
  USING (id = clinica_do_usuario());

CREATE POLICY "clinicas: admin atualiza"
  ON clinicas FOR UPDATE
  USING     (id = clinica_do_usuario() AND eh_admin())
  WITH CHECK (id = clinica_do_usuario() AND eh_admin());


-- ------------------------------------------------------------
-- perfis
-- Todos veem os perfis da mesma clínica.
-- Admin gerencia qualquer perfil; recepcao só edita o próprio.
-- ------------------------------------------------------------
CREATE POLICY "perfis: ver da clinica"
  ON perfis FOR SELECT
  USING (clinica_id = clinica_do_usuario());

CREATE POLICY "perfis: admin insere"
  ON perfis FOR INSERT
  WITH CHECK (clinica_id = clinica_do_usuario() AND eh_admin());

CREATE POLICY "perfis: admin atualiza qualquer ou usuario atualiza o proprio"
  ON perfis FOR UPDATE
  USING (
    clinica_id = clinica_do_usuario()
    AND (eh_admin() OR id = auth.uid())
  );

CREATE POLICY "perfis: admin deleta"
  ON perfis FOR DELETE
  USING (clinica_id = clinica_do_usuario() AND eh_admin());


-- ------------------------------------------------------------
-- profissionais
-- Leitura para todos; escrita somente admin.
-- ------------------------------------------------------------
CREATE POLICY "profissionais: ver da clinica"
  ON profissionais FOR SELECT
  USING (clinica_id = clinica_do_usuario());

CREATE POLICY "profissionais: admin insere"
  ON profissionais FOR INSERT
  WITH CHECK (clinica_id = clinica_do_usuario() AND eh_admin());

CREATE POLICY "profissionais: admin atualiza"
  ON profissionais FOR UPDATE
  USING (clinica_id = clinica_do_usuario() AND eh_admin());

CREATE POLICY "profissionais: admin deleta"
  ON profissionais FOR DELETE
  USING (clinica_id = clinica_do_usuario() AND eh_admin());


-- ------------------------------------------------------------
-- horarios_atendimento
-- Não tem clinica_id diretamente; o join com profissionais garante o tenant.
-- ------------------------------------------------------------
CREATE POLICY "horarios: ver da clinica"
  ON horarios_atendimento FOR SELECT
  USING (
    profissional_id IN (
      SELECT id FROM profissionais WHERE clinica_id = clinica_do_usuario()
    )
  );

CREATE POLICY "horarios: admin insere"
  ON horarios_atendimento FOR INSERT
  WITH CHECK (
    eh_admin()
    AND profissional_id IN (
      SELECT id FROM profissionais WHERE clinica_id = clinica_do_usuario()
    )
  );

CREATE POLICY "horarios: admin atualiza"
  ON horarios_atendimento FOR UPDATE
  USING (
    eh_admin()
    AND profissional_id IN (
      SELECT id FROM profissionais WHERE clinica_id = clinica_do_usuario()
    )
  );

CREATE POLICY "horarios: admin deleta"
  ON horarios_atendimento FOR DELETE
  USING (
    eh_admin()
    AND profissional_id IN (
      SELECT id FROM profissionais WHERE clinica_id = clinica_do_usuario()
    )
  );


-- ------------------------------------------------------------
-- pacientes
-- recepcao e admin inserem/atualizam; somente admin deleta.
-- ------------------------------------------------------------
CREATE POLICY "pacientes: ver da clinica"
  ON pacientes FOR SELECT
  USING (clinica_id = clinica_do_usuario());

CREATE POLICY "pacientes: recepcao e admin inserem"
  ON pacientes FOR INSERT
  WITH CHECK (clinica_id = clinica_do_usuario());

CREATE POLICY "pacientes: recepcao e admin atualizam"
  ON pacientes FOR UPDATE
  USING (clinica_id = clinica_do_usuario());

CREATE POLICY "pacientes: admin deleta"
  ON pacientes FOR DELETE
  USING (clinica_id = clinica_do_usuario() AND eh_admin());


-- ------------------------------------------------------------
-- agendamentos
-- recepcao e admin inserem/atualizam; somente admin deleta.
-- ------------------------------------------------------------
CREATE POLICY "agendamentos: ver da clinica"
  ON agendamentos FOR SELECT
  USING (clinica_id = clinica_do_usuario());

CREATE POLICY "agendamentos: recepcao e admin inserem"
  ON agendamentos FOR INSERT
  WITH CHECK (clinica_id = clinica_do_usuario());

CREATE POLICY "agendamentos: recepcao e admin atualizam"
  ON agendamentos FOR UPDATE
  USING (clinica_id = clinica_do_usuario());

CREATE POLICY "agendamentos: admin deleta"
  ON agendamentos FOR DELETE
  USING (clinica_id = clinica_do_usuario() AND eh_admin());


-- ------------------------------------------------------------
-- lista_espera — mesmas regras dos agendamentos
-- ------------------------------------------------------------
CREATE POLICY "lista_espera: ver da clinica"
  ON lista_espera FOR SELECT
  USING (clinica_id = clinica_do_usuario());

CREATE POLICY "lista_espera: recepcao e admin inserem"
  ON lista_espera FOR INSERT
  WITH CHECK (clinica_id = clinica_do_usuario());

CREATE POLICY "lista_espera: recepcao e admin atualizam"
  ON lista_espera FOR UPDATE
  USING (clinica_id = clinica_do_usuario());

CREATE POLICY "lista_espera: admin deleta"
  ON lista_espera FOR DELETE
  USING (clinica_id = clinica_do_usuario() AND eh_admin());


-- ------------------------------------------------------------
-- mensagens
-- Leitura para todos da clínica. Sem policy de INSERT para usuários
-- autenticados — inserção feita exclusivamente pelas Edge Functions
-- via service_role (que bypassa RLS por ser superusuário no Supabase).
-- ------------------------------------------------------------
CREATE POLICY "mensagens: ver da clinica"
  ON mensagens FOR SELECT
  USING (clinica_id = clinica_do_usuario());


-- ============================================================
-- SEED MÍNIMO — dados de desenvolvimento
-- ============================================================
-- Execute apenas em ambiente de desenvolvimento.
-- Para criar um usuário admin:
--   1. Registre-o via Supabase Auth (dashboard ou API)
--   2. Descomente o INSERT em perfis abaixo com o UUID gerado

INSERT INTO clinicas (id, nome, slug, timezone)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Clínica Demonstração',
  'clinica-demo',
  'America/Sao_Paulo'
) ON CONFLICT DO NOTHING;

INSERT INTO profissionais (id, clinica_id, nome, especialidade, duracao_padrao_min)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'Dr. João Silva',
  'Clínica Geral',
  30
) ON CONFLICT DO NOTHING;

-- Grade semanal: segunda a sexta, 08:00–12:00 e 14:00–18:00
INSERT INTO horarios_atendimento (profissional_id, dia_semana, inicio, fim)
SELECT 'b0000000-0000-0000-0000-000000000001', dia, bloco.inicio, bloco.fim
FROM   generate_series(1, 5) AS dia
CROSS JOIN (
  VALUES ('08:00'::time, '12:00'::time),
         ('14:00'::time, '18:00'::time)
) AS bloco(inicio, fim)
ON CONFLICT DO NOTHING;

INSERT INTO pacientes (clinica_id, nome, telefone)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Maria Exemplo',
  '+5511999000001'
) ON CONFLICT DO NOTHING;

-- Após registrar o usuário admin no Supabase Auth, crie o perfil:
-- INSERT INTO perfis (id, clinica_id, nome, papel)
-- VALUES ('<uuid-do-auth.users>', 'a0000000-0000-0000-0000-000000000001', 'Admin Demo', 'admin');


-- ============================================================
-- pg_cron — AGENDAMENTO AUTOMÁTICO
-- ============================================================
-- Chama a Edge Function "enviar-confirmacoes" via HTTP a cada hora.
-- Preencha <PROJECT_REF> e <SERVICE_ROLE_KEY> antes de descomentar.
-- PROJECT_REF: Settings → General → Reference ID no painel Supabase.
-- SERVICE_ROLE_KEY: Settings → API → service_role (nunca expor no cliente).

/*
SELECT cron.schedule(
  'enviar-confirmacoes-horaria',       -- nome único do job (deve ser único no banco)
  '0 * * * *',                         -- toda hora cheia (cron expression UTC)
  $$
    SELECT net.http_post(
      url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/enviar-confirmacoes',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      body    := '{}'::jsonb
    );
  $$
);
*/

-- Consultar todos os jobs cadastrados:
-- SELECT jobid, jobname, schedule, command FROM cron.job;

-- Remover o job se necessário:
-- SELECT cron.unschedule('enviar-confirmacoes-horaria');
