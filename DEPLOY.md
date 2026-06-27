# Deploy — Recepção IA

Guia sequencial de implantação em produção. Execute cada seção na ordem indicada.

---

## Pré-requisitos

- [Supabase CLI](https://supabase.com/docs/guides/cli) instalado (`supabase --version`)
- [Vercel CLI](https://vercel.com/docs/cli) instalado (`vercel --version`)  
- Conta ativa no [Meta for Developers](https://developers.facebook.com/) com:
  - App do tipo **Business** criado
  - Produto **WhatsApp** adicionado
  - Número de telefone verificado e conectado
- `SUPABASE_PROJECT_REF` em mãos — Supabase → Settings → General → **Reference ID**  
  Exemplo: `abcdefghijklmnop`
- `SERVICE_ROLE_KEY` em mãos — Supabase → Settings → API → **service_role** (nunca expor no cliente)

```bash
# Autentique o CLI do Supabase
supabase login

# Linke ao projeto remoto
supabase link --project-ref <SUPABASE_PROJECT_REF>
```

---

## 1. Banco de dados — aplicar schema e migrações

O schema principal cria todas as tabelas, índices, funções auxiliares e policies RLS.
As migrações adicionam colunas e índices criados depois do schema inicial.

```bash
# Aplica schema.sql + todas as migrações em supabase/migrations/
supabase db push
```

> **Atenção:** `supabase db push` executa tudo via diff em relação ao estado remoto.
> Se preferir rodar manualmente no SQL Editor do painel Supabase, execute nesta ordem:
> 1. `supabase/schema.sql`
> 2. `supabase/migrations/002_confirmacao_enviada_em.sql`
> 3. `supabase/migrations/003_lista_espera_slot.sql`

**Verificar extensões ativas** (SQL Editor):
```sql
SELECT name, installed_version FROM pg_available_extensions
WHERE name IN ('btree_gist', 'pg_net', 'pg_cron') AND installed_version IS NOT NULL;
```
As três devem aparecer. Se alguma faltar, ative em Supabase → Database → Extensions.

---

## 2. Secrets das Edge Functions

Defina todos os secrets com um único comando `supabase secrets set`.

### Obrigatórios

```bash
supabase secrets set \
  ANTHROPIC_API_KEY="sk-ant-..." \
  ANTHROPIC_MODEL="claude-haiku-4-5-20251001" \
  WHATSAPP_TOKEN="EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  WHATSAPP_VERIFY_TOKEN="token-secreto-que-voce-escolhe" \
  WHATSAPP_APP_SECRET="app-secret-do-seu-app-meta"
```

| Secret | Onde obter |
|--------|-----------|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `ANTHROPIC_MODEL` | Nome do modelo lido por `whatsapp-webhook` (default no código: `claude-haiku-4-5-20251001`) |
| `WHATSAPP_TOKEN` | Meta for Developers → seu App → WhatsApp → API Setup → **Temporary access token** (troque por token permanente em produção via System User) |
| `WHATSAPP_VERIFY_TOKEN` | String secreta de sua escolha — usada para verificar o webhook (passo 4) |
| `WHATSAPP_APP_SECRET` | Meta for Developers → seu App → Settings → Basic → **App Secret**. Usado para validar a assinatura HMAC-SHA256 (`X-Hub-Signature-256`) de cada evento. **Se ausente, a validação de assinatura é pulada** — defina em produção. |

> **Nota sobre o nome do modelo:** o código da Edge Function lê `ANTHROPIC_MODEL`.
> O `CLAUDE.md` menciona `AI_MODEL` como convenção — há uma divergência de nome entre
> doc e código. Use `ANTHROPIC_MODEL` (o que o código realmente lê) ou alinhe os dois.

### Opcionais (têm default embutido)

```bash
supabase secrets set \
  TEMPLATE_CONFIRMACAO="confirmacao_consulta" \
  TEMPLATE_VAGA="vaga_disponivel" \
  OFERTA_LIMITE_MIN="30" \
  CONFIRMACAO_HORAS_ANTECEDENCIA="24" \
  CONFIRMACAO_JANELA_MIN="30"
```

| Secret | Default | Descrição |
|--------|---------|-----------|
| `TEMPLATE_CONFIRMACAO` | `confirmacao_consulta` | Nome do template de confirmação de consulta |
| `TEMPLATE_VAGA` | `vaga_disponivel` | Nome do template de oferta de vaga (lista de espera) |
| `OFERTA_LIMITE_MIN` | `30` | Minutos antes de uma oferta de vaga expirar |
| `CONFIRMACAO_HORAS_ANTECEDENCIA` | `24` | Quantas horas antes de enviar o lembrete de confirmação |
| `CONFIRMACAO_JANELA_MIN` | `30` | Margem em minutos do cron para capturar agendamentos |

**Verificar** (lista os nomes, não os valores):
```bash
supabase secrets list
```

---

## 3. Deploy das Edge Functions

Apenas as três funções abaixo têm implementação (`index.ts`). As demais são stubs futuros.

```bash
supabase functions deploy whatsapp-webhook
supabase functions deploy enviar-confirmacoes
supabase functions deploy expirar-ofertas
```

> **Nota:** `whatsapp-webhook` tem `verify_jwt: false` em `config.json` porque o
> webhook da Meta não envia JWT — a autenticação é feita via HMAC + `WHATSAPP_VERIFY_TOKEN`.

**URL da função whatsapp-webhook** (anote — você vai precisar no passo 4):
```
https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/whatsapp-webhook
```

---

## 4. Configurar o webhook no Meta Business Manager

1. Acesse [developers.facebook.com](https://developers.facebook.com) → seu App → **WhatsApp → Configuration**
2. Em **Webhook**, clique em **Edit**
3. Preencha:
   - **Callback URL:** `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/whatsapp-webhook`
   - **Verify token:** o mesmo valor definido em `WHATSAPP_VERIFY_TOKEN`
4. Clique em **Verify and Save** — a Meta fará um GET à URL com `hub.challenge`; a função deve responder com o desafio (já implementado)
5. Em **Webhook fields**, assine o campo **messages** (marcar o checkbox e clicar em Subscribe)

**Testar a verificação:**
```bash
curl "https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/whatsapp-webhook\
?hub.mode=subscribe\
&hub.challenge=teste123\
&hub.verify_token=<WHATSAPP_VERIFY_TOKEN>"
# Deve retornar: teste123
```

---

## 5. Criar e submeter os templates no Meta Business Manager

O sistema usa **dois templates** de mensagem do WhatsApp (categoria **Utility**).
Templates Utility são aprovados mais rapidamente e não exigem marketing opt-in.

### Template 1 — `confirmacao_consulta`

> Enviado ~24 h antes da consulta pelo cron `enviar-confirmacoes`.

| Campo | Valor |
|-------|-------|
| **Nome** | `confirmacao_consulta` |
| **Idioma** | Português (Brasil) — `pt_BR` |
| **Categoria** | Utility |

**Corpo da mensagem:**
```
Olá! Sua consulta com *{{1}}* está agendada para *{{2}}*.

Responda *SIM* para confirmar presença ou *NÃO* para cancelar.
```

- `{{1}}` = nome do profissional (ex: `Dr. João Silva`)
- `{{2}}` = data e hora formatada (ex: `sexta-feira, 27 de junho de 2025 às 14:00`)

---

### Template 2 — `vaga_disponivel`

> Enviado quando uma consulta cancelada abre vaga para a lista de espera.

| Campo | Valor |
|-------|-------|
| **Nome** | `vaga_disponivel` |
| **Idioma** | Português (Brasil) — `pt_BR` |
| **Categoria** | Utility |

**Corpo da mensagem:**
```
🗓️ Uma vaga abriu com *{{1}}* para *{{2}}*.

Responda *SIM* para confirmar ou *NÃO* para recusar. Você tem 30 minutos!
```

- `{{1}}` = nome do profissional
- `{{2}}` = data e hora do slot disponível

---

**Como submeter (passo a passo):**

1. Meta for Developers → seu App → **WhatsApp → Message Templates**
2. Clique em **Create Template**
3. Selecione categoria **Utility**, idioma **Portuguese (Brazil)**
4. Defina o nome exato (minúsculas, sem espaços)
5. Cole o corpo com os placeholders `{{1}}`, `{{2}}`
6. Clique em **Submit** — aprovação costuma levar minutos para templates Utility
7. Repita para o segundo template

> Enquanto os templates estão em análise, você pode testar o sistema com o número
> de teste gratuito da Meta — ele não exige templates aprovados.

---

## 6. Deploy do frontend na Vercel

```bash
cd web

# Primeiro deploy (cria o projeto na Vercel)
vercel

# Ou, se o projeto já existe:
vercel --prod
```

Durante o `vercel` interativo, quando pedir configurações:
- **Framework Preset:** Vite
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Install Command:** `npm install`

### Variáveis de ambiente na Vercel

Após o deploy, acesse **Vercel → seu projeto → Settings → Environment Variables** e adicione:

| Variável | Valor | Ambientes |
|----------|-------|-----------|
| `VITE_SUPABASE_URL` | `https://<SUPABASE_PROJECT_REF>.supabase.co` | Production, Preview, Development |
| `VITE_SUPABASE_ANON_KEY` | chave `anon`/`public` do Supabase | Production, Preview, Development |

> Supabase → Settings → API → **Project URL** e **anon public key**.

Após adicionar as variáveis, faça um novo deploy para que entrem em vigor:
```bash
vercel --prod
```

**Verificar build sem erros:**
```bash
npm run build   # deve gerar dist/ sem erros TypeScript
```

---

## 7. Ativar os jobs pg_cron

Com o schema aplicado (passo 1), as funções deployadas (passo 3) e os secrets definidos (passo 2), ative os dois jobs no **SQL Editor** do Supabase.

Substitua `<SUPABASE_PROJECT_REF>` e `<SERVICE_ROLE_KEY>` antes de executar.

### Job 1 — Lembretes de confirmação (a cada hora)

```sql
SELECT cron.schedule(
  'enviar-confirmacoes-horaria',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/enviar-confirmacoes',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      body    := '{}'::jsonb
    );
  $$
);
```

### Job 2 — Expirar ofertas sem resposta (a cada 10 minutos)

```sql
SELECT cron.schedule(
  'expirar-ofertas-10min',
  '*/10 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/expirar-ofertas',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      body    := '{}'::jsonb
    );
  $$
);
```

**Verificar jobs cadastrados:**
```sql
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;
```

**Remover job (se precisar recriar):**
```sql
SELECT cron.unschedule('enviar-confirmacoes-horaria');
SELECT cron.unschedule('expirar-ofertas-10min');
```

---

## 8. Primeiro usuário admin

Após o deploy do banco, crie o primeiro usuário pelo **Supabase Auth**:

1. Supabase → Authentication → Users → **Invite user** (ou Add user)
2. Anote o UUID gerado para o usuário
3. No SQL Editor, insira o perfil admin:

```sql
INSERT INTO perfis (id, clinica_id, nome, papel)
VALUES (
  '<UUID-DO-USUARIO>',
  'a0000000-0000-0000-0000-000000000001',  -- clínica demo criada pelo seed
  'Admin',
  'admin'
);
```

> Para uma clínica real (não a demo do seed), insira primeiro em `clinicas` e use o UUID gerado.

---

## Resumo da checklist de go-live

```
[ ] supabase link --project-ref <REF>
[ ] supabase db push                         → schema + 2 migrações
[ ] Extensões btree_gist, pg_net, pg_cron ativas
[ ] supabase secrets set (ANTHROPIC_API_KEY, ANTHROPIC_MODEL, WHATSAPP_TOKEN, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET)
[ ] supabase functions deploy (3 funções)
[ ] Webhook Meta configurado e verificado
[ ] Template confirmacao_consulta aprovado
[ ] Template vaga_disponivel aprovado
[ ] vercel --prod + 2 variáveis de ambiente configuradas
[ ] pg_cron: 2 jobs cadastrados (SQL Editor)
[ ] Primeiro usuário admin criado
[ ] Enviar mensagem de teste pelo WhatsApp → confirmar fluxo completo
```
