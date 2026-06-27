// deno test supabase/functions/_shared/agenda.test.ts
import { assertEquals } from "jsr:@std/assert@^1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { estaLivre, horariosLivres } from "./agenda.ts";

// ===========================================================================
// Mock do cliente Supabase
// ===========================================================================

/**
 * Cria um "nó" de cadeia thenable que resolve para { data, error }.
 * Todos os métodos builder (select, eq, in, …) retornam o mesmo nó,
 * permitindo encadeamento arbitrário e await direto OU chamada de .single().
 */
function mockResult<T>(data: T, error: { message: string } | null = null) {
  const r = { data, error };

  // deno-lint-ignore no-explicit-any
  const chain: any = {
    select: () => chain,
    eq:     () => chain,
    in:     () => chain,
    lt:     () => chain,
    gt:     () => chain,
    lte:    () => chain,
    gte:    () => chain,
    limit:  () => chain,
    returns: () => chain,
    // .single() — caminho usado para profissionais
    single: () => Promise.resolve(r),
    // thenable — caminho usado para horarios_atendimento e agendamentos
    then: (
      resolve: (v: typeof r) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(r).then(resolve, reject),
    catch: (fn: (e: unknown) => unknown) => Promise.resolve(r).catch(fn),
  };

  return chain;
}

interface MockConfig {
  profissional: { duracao_padrao_min: number; clinicas: { timezone: string } };
  grade: Array<{ dia_semana: number; inicio: string; fim: string }>;
  agendamentos: Array<{ inicio: string; fim: string }>;
}

function mockSupabase(cfg: MockConfig): SupabaseClient {
  return {
    from: (tabela: string) => {
      if (tabela === "profissionais")        return mockResult(cfg.profissional);
      if (tabela === "horarios_atendimento") return mockResult(cfg.grade);
      if (tabela === "agendamentos")         return mockResult(cfg.agendamentos);
      return mockResult(null);
    },
  } as unknown as SupabaseClient;
}

// ===========================================================================
// Constantes compartilhadas
//
// Calendário de referência:
//   2030-01-06 = domingo   (getDay() === 0)
//   2030-01-07 = segunda   (getDay() === 1)
//   2030-01-08 = terça     (getDay() === 2)
//
// SEGUNDA_CEDO: 2030-01-07 às 06:00 UTC
//   • Em America/Sao_Paulo (UTC-3) = 03:00 segunda → antes do expediente
//   • Garante que todos os slots do dia ainda estão no futuro
// ===========================================================================

const PROF_ID            = "prof-teste-001";
const SEGUNDA_CEDO       = new Date("2030-01-07T06:00:00.000Z");
const TZ_SAO_PAULO       = "America/Sao_Paulo"; // UTC-3
const TZ_TOKYO           = "Asia/Tokyo";         // UTC+9

// ===========================================================================
// horariosLivres — Teste 1: dia cheio
// ===========================================================================

Deno.test("horariosLivres › dia cheio — nenhum slot livre quando tudo está ocupado", async () => {
  // Grade: segunda 08:00-10:00 SP → 4 slots de 30 min possíveis
  //   08:00 SP = 11:00 UTC   |   10:00 SP = 13:00 UTC
  // Agendamento: cobre exatamente o bloco inteiro (11:00-13:00 UTC)
  const supabase = mockSupabase({
    profissional: { duracao_padrao_min: 30, clinicas: { timezone: TZ_SAO_PAULO } },
    grade: [{ dia_semana: 1, inicio: "08:00", fim: "10:00" }],
    agendamentos: [
      { inicio: "2030-01-07T11:00:00.000Z", fim: "2030-01-07T13:00:00.000Z" },
    ],
  });

  const slots = await horariosLivres(supabase, PROF_ID, 1, SEGUNDA_CEDO);

  assertEquals(slots.length, 0, "Dia cheio deve retornar lista vazia");
});

// ===========================================================================
// horariosLivres — Teste 2: dia vazio (sem grade para o dia)
// ===========================================================================

Deno.test("horariosLivres › dia vazio — sem horário no dia consultado", async () => {
  // Grade cadastrada apenas para terça (dia_semana=2), mas agora é segunda
  const supabase = mockSupabase({
    profissional: { duracao_padrao_min: 30, clinicas: { timezone: TZ_SAO_PAULO } },
    grade: [{ dia_semana: 2, inicio: "08:00", fim: "10:00" }],
    agendamentos: [],
  });

  const slots = await horariosLivres(supabase, PROF_ID, 1, SEGUNDA_CEDO);

  assertEquals(slots.length, 0, "Sem grade para o dia, nenhum slot deve ser retornado");
});

// ===========================================================================
// horariosLivres — Teste 3: conflito parcial
// ===========================================================================

Deno.test("horariosLivres › conflito parcial — retorna só os slots livres", async () => {
  // Grade: segunda 08:00-12:00 SP → 8 slots de 30 min (11:00-15:00 UTC)
  // Agendamento: 08:00-09:00 SP = 11:00-12:00 UTC → ocupa os 2 primeiros slots
  // Esperado: 6 slots livres, começando em 09:00 SP (12:00 UTC)

  const supabase = mockSupabase({
    profissional: { duracao_padrao_min: 30, clinicas: { timezone: TZ_SAO_PAULO } },
    grade: [{ dia_semana: 1, inicio: "08:00", fim: "12:00" }],
    agendamentos: [
      { inicio: "2030-01-07T11:00:00.000Z", fim: "2030-01-07T12:00:00.000Z" },
    ],
  });

  const slots = await horariosLivres(supabase, PROF_ID, 1, SEGUNDA_CEDO);

  assertEquals(slots.length, 6, "Devem restar 6 slots após conflito parcial (09:00-12:00 SP)");

  // Primeiro slot livre: 09:00-09:30 SP = 12:00-12:30 UTC
  assertEquals(slots[0].inicio, "2030-01-07T12:00:00.000Z");
  assertEquals(slots[0].fim,    "2030-01-07T12:30:00.000Z");

  // Último slot: 11:30-12:00 SP = 14:30-15:00 UTC
  assertEquals(slots[5].inicio, "2030-01-07T14:30:00.000Z");
  assertEquals(slots[5].fim,    "2030-01-07T15:00:00.000Z");
});

// ===========================================================================
// horariosLivres — Teste 4: virada de fuso (UTC ≠ dia local)
// ===========================================================================

Deno.test("horariosLivres › virada de fuso — clínica Tokyo, slots cruzam meia-noite UTC", async () => {
  // Cenário: quando UTC marca domingo, Tokyo já está na segunda-feira.
  //
  //   agora (UTC):   2030-01-06T16:00:00Z  (domingo 16:00 UTC)
  //   agora (Tokyo): 2030-01-07T01:00:00+09:00  (segunda 01:00 Tokyo)
  //
  // Grade: segunda-feira (dia_semana=1) 08:00-10:00 Tokyo
  //
  // Conversão para UTC:
  //   08:00 Tokyo (+9) = 23:00 UTC Jan 6   →  2030-01-06T23:00:00Z
  //   08:30 Tokyo      = 23:30 UTC Jan 6   →  2030-01-06T23:30:00Z
  //   09:00 Tokyo      = 00:00 UTC Jan 7   →  2030-01-07T00:00:00Z
  //   09:30 Tokyo      = 00:30 UTC Jan 7   →  2030-01-07T00:30:00Z
  //
  // Um código que determinasse o dia pelo UTC (domingo, dia_semana=0) não
  // encontraria grade e retornaria 0 slots — comportamento ERRADO.
  // O código correto usa o timezone da clínica e retorna 4 slots.

  const agoraTokyo = new Date("2030-01-06T16:00:00.000Z");

  const supabase = mockSupabase({
    profissional: { duracao_padrao_min: 30, clinicas: { timezone: TZ_TOKYO } },
    grade: [{ dia_semana: 1, inicio: "08:00", fim: "10:00" }],
    agendamentos: [],
  });

  const slots = await horariosLivres(supabase, PROF_ID, 1, agoraTokyo);

  assertEquals(
    slots.length,
    4,
    "Devem ser retornados 4 slots de segunda em Tokyo, mesmo cruzando meia-noite UTC",
  );

  // 08:00 Tokyo = 23:00 UTC do dia anterior
  assertEquals(slots[0].inicio, "2030-01-06T23:00:00.000Z");
  assertEquals(slots[0].fim,    "2030-01-06T23:30:00.000Z");

  // 09:30 Tokyo = 00:30 UTC do dia seguinte
  assertEquals(slots[3].inicio, "2030-01-07T00:30:00.000Z");
  assertEquals(slots[3].fim,    "2030-01-07T01:00:00.000Z");
});

// ===========================================================================
// estaLivre
// ===========================================================================

Deno.test("estaLivre › retorna true quando não há conflito", async () => {
  // Banco retorna lista vazia → intervalo livre
  const supabase = {
    from: () => mockResult<{ id: string }[]>([]),
  } as unknown as SupabaseClient;

  const livre = await estaLivre(
    supabase,
    PROF_ID,
    "2030-01-07T11:00:00.000Z",
    "2030-01-07T11:30:00.000Z",
  );

  assertEquals(livre, true);
});

Deno.test("estaLivre › retorna false quando há conflito", async () => {
  // Banco retorna 1 agendamento sobreposto → intervalo ocupado
  const supabase = {
    from: () => mockResult<{ id: string }[]>([{ id: "ag-conflito" }]),
  } as unknown as SupabaseClient;

  const livre = await estaLivre(
    supabase,
    PROF_ID,
    "2030-01-07T11:00:00.000Z",
    "2030-01-07T11:30:00.000Z",
  );

  assertEquals(livre, false);
});

Deno.test("estaLivre › aceita Date além de string", async () => {
  const supabase = {
    from: () => mockResult<{ id: string }[]>([]),
  } as unknown as SupabaseClient;

  const livre = await estaLivre(
    supabase,
    PROF_ID,
    new Date("2030-01-07T11:00:00.000Z"),
    new Date("2030-01-07T11:30:00.000Z"),
  );

  assertEquals(livre, true);
});
