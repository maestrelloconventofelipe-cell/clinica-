# Recepção IA — Guia de Arquitetura

## Visão geral

Plataforma SaaS multi-tenant que fornece um agente de WhatsApp para recepção de clínicas: agendamento, confirmação, remarcação e preenchimento de horários vagos via lista de espera. Cada clínica é um tenant isolado no banco de dados por Row-Level Security (RLS) do Supabase.

---

## Arquitetura

```
┌─────────────┐    RLS    ┌──────────────────┐   pg_cron   ┌──────────────┐
│   web/      │ ◄──────► │  Supabase (PG)   │ ──────────► │  Notificações│
│ React/Vite  │           │  + Auth + Storage │             │  automáticas │
│   Vercel    │           └────────┬─────────┘             └──────────────┘
└─────────────┘                    │
                                   │ Invoke
                         ┌─────────▼─────────┐
                         │ supabase/functions │   ◄── TODA lógica de servidor
                         │  Edge Functions    │        (Deno, TypeScript)
                         │      Deno          │
                         └─────────┬──────────┘
                                   │
                    ┌──────────────┴───────────────┐
                    │                              │
          ┌─────────▼──────────┐      ┌───────────▼───────────┐
          │  Meta Graph API    │      │  claude-haiku-4-5-*   │
          │  (WhatsApp Cloud)  │      │  SOMENTE para NL      │
          └────────────────────┘      └───────────────────────┘
```

### Camadas

| Camada | Tecnologia | Deploy |
|--------|-----------|--------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS | Vercel |
| Backend / API | Edge Functions Deno (TypeScript) | Supabase |
| Banco de dados | PostgreSQL (Supabase) com RLS | Supabase |
| Agendamento automático | pg_cron (extensão nativa) | Supabase |
| WhatsApp | Meta Cloud API — Graph API v21+ | Meta |
| IA (linguagem natural) | claude-haiku-4-5-20251001 (secret `AI_MODEL`) | Anthropic |

### Regra de custo — CRÍTICA

> Agenda, disponibilidade, métricas e relatórios são **lógica pura (SQL / TypeScript)** — nunca chamam IA.
> O modelo de linguagem é invocado **somente** na Edge Function `processar-mensagem` para interpretar a mensagem bruta do paciente e extrair intenção + entidades.

---

## Estrutura de pastas

```
clinica/
├── CLAUDE.md                          # Este arquivo
├── .claude/
│   └── settings.json                  # defaultMode: plan
│
├── web/                               # Frontend → Vercel
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/                    # Botões, inputs, modais compartilhados
│   │   │   ├── auth/                  # Login, registro, recuperação de senha
│   │   │   ├── agenda/                # Calendário, grid de horários, slots
│   │   │   ├── pacientes/             # Cadastro, histórico, busca
│   │   │   └── configuracoes/         # Perfil da clínica, profissionais, horários
│   │   ├── pages/                     # Páginas / rotas (React Router ou TanStack)
│   │   ├── hooks/                     # Custom hooks (useAgenda, usePaciente…)
│   │   ├── lib/                       # Cliente Supabase, helpers, formatadores
│   │   └── types/                     # Tipos TypeScript globais (espelham o schema PG)
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── tailwind.config.ts
│
├── supabase/
│   ├── config.toml                    # Configuração do projeto Supabase
│   ├── migrations/                    # Migrations SQL numeradas (001_, 002_…)
│   ├── functions/                     # Edge Functions — TODA lógica de servidor
│   │   ├── _shared/                   # Código compartilhado entre functions
│   │   │   ├── supabase.ts            # Cliente admin do Supabase
│   │   │   ├── whatsapp.ts            # Cliente Meta Graph API
│   │   │   └── types.ts               # Tipos compartilhados
│   │   ├── whatsapp-webhook/          # GET (verify token) + POST (eventos)
│   │   ├── processar-mensagem/        # NL → IA → intenção + entidades → roteamento
│   │   ├── agendar-consulta/          # Lógica pura de agendamento (sem IA)
│   │   ├── confirmar-agendamento/     # Confirmação / remarcação / cancelamento
│   │   ├── lista-espera/              # Ocupa slot vago notificando lista de espera
│   │   └── notificacoes-cron/         # Acionada pelo pg_cron (lembretes D-1, D-0)
│   └── seed.sql                       # Dados iniciais para desenvolvimento
│
└── docs/                              # Documentação extra (diagramas, ADRs)
```

---

## Convenções

### TypeScript
- `strict: true` em todos os `tsconfig.json` — proibido `any` explícito
- Tipos que espelham o schema do banco ficam em `web/src/types/` e em `supabase/functions/_shared/types.ts`
- Imports absolutos com alias `@/` no frontend

### Domínio em português
Todas as entidades, colunas, funções PG e variáveis de domínio usam português:

| Entidade | Tabela PG |
|----------|-----------|
| Clínica (tenant) | `clinicas` |
| Profissional | `profissionais` |
| Paciente | `pacientes` |
| Agendamento | `agendamentos` |
| Procedimento | `procedimentos` |
| Lista de espera | `lista_espera` |
| Horário disponível | `horarios_disponiveis` |

### Multi-tenant
- Toda tabela tem coluna `clinica_id uuid NOT NULL REFERENCES clinicas(id)`
- RLS ativada em todas as tabelas; policies baseadas em `auth.jwt() ->> 'clinica_id'`
- Nunca fazer query sem filtro de `clinica_id` no backend

### Edge Functions
- Cada function é um diretório com `index.ts` como entry point
- Código compartilhado em `_shared/` — importado via caminho relativo
- Sem Express, sem servidor próprio, sem Evolution API
- Autenticação: verificar JWT do Supabase ou HMAC do webhook da Meta

### WhatsApp
- Somente Meta Cloud API (Graph API v21+)
- Credenciais via Supabase Secrets: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`

### IA
- Modelo: configurável via secret `AI_MODEL` (padrão: `claude-haiku-4-5-20251001`)
- Chamada apenas em `processar-mensagem/index.ts`
- Prompt em português; resposta sempre JSON estruturado `{ intencao, entidades }`

### Deploy
```bash
# Frontend
cd web && vercel deploy

# Edge Functions
supabase functions deploy whatsapp-webhook
supabase functions deploy processar-mensagem
# … demais functions

# Migrations
supabase db push
```

### Proibições explícitas
- NÃO usar Evolution API ou qualquer wrapper não-oficial do WhatsApp
- NÃO criar servidor Express/Fastify/Hono fora do Supabase
- NÃO rodar lógica de agendamento ou métricas via IA — use SQL
- NÃO hardcodar credenciais — sempre via Supabase Secrets ou variáveis de ambiente Vercel
