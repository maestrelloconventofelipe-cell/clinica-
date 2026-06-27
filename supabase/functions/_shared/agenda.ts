// Módulo puro de disponibilidade — zero chamadas a IA.
// Toda lógica é aritmética de intervalos + timezone via date-fns-tz.

import { addDays, addMinutes } from "npm:date-fns@3";
import { format, fromZonedTime, toZonedTime } from "npm:date-fns-tz@3";
import type { DbClient } from "./db.ts";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/** Slot de horário livre, expresso em UTC. */
export interface SlotLivre {
  inicio: string; // ISO 8601 UTC
  fim: string;    // ISO 8601 UTC
}

// ---------------------------------------------------------------------------
// Tipos internos (espelham apenas as colunas lidas)
// ---------------------------------------------------------------------------

interface ProfissionalRow {
  duracao_padrao_min: number;
  clinicas: { timezone: string };
}

interface HorarioRow {
  dia_semana: number; // 0=dom … 6=sáb
  inicio: string;     // "HH:mm" ou "HH:mm:ss"
  fim: string;
}

interface AgendamentoRow {
  inicio: string; // ISO 8601 UTC
  fim: string;
}

// ---------------------------------------------------------------------------
// horariosLivres
// ---------------------------------------------------------------------------

/**
 * Retorna os slots livres de um profissional nos próximos `dias` dias.
 *
 * Algoritmo:
 *   1. Busca a grade semanal (horarios_atendimento).
 *   2. Busca os agendamentos ativos (agendado | confirmado) na janela.
 *   3. Para cada dia da janela, gera slots de `duracao_padrao_min` minutos
 *      dentro de cada bloco da grade e filtra os que colidem com agendamentos.
 *
 * @param _agora  Injetável para testes; padrão: new Date().
 *
 * Nota sobre DST: addDays opera em ms exatos (86 400 000 ms), o que pode
 * desviar ±1 slot em dias de mudança de horário de verão. Aceitável para o
 * contexto brasileiro, onde DST é raro e o impacto é mínimo.
 */
export async function horariosLivres(
  supabase: DbClient,
  profissionalId: string,
  dias: number,
  _agora?: Date,
): Promise<SlotLivre[]> {
  const agora = _agora ?? new Date();

  // 1. Profissional + timezone da clínica
  const { data: prof, error: profErr } = await supabase
    .from("profissionais")
    .select("duracao_padrao_min, clinicas(timezone)")
    .eq("id", profissionalId)
    .single<ProfissionalRow>();

  if (profErr || !prof) {
    throw new Error(
      `Profissional não encontrado: ${profErr?.message ?? "sem dados"}`,
    );
  }

  const tz = prof.clinicas.timezone;
  const duracaoMin = prof.duracao_padrao_min;

  // 2. Grade semanal
  const { data: grade, error: gradeErr } = await supabase
    .from("horarios_atendimento")
    .select("dia_semana, inicio, fim")
    .eq("profissional_id", profissionalId);

  if (gradeErr) throw new Error(`Erro na grade: ${gradeErr.message}`);
  if (!grade?.length) return [];

  // 3. Janela de consulta (início do dia 0 até o fim do dia dias-1, no timezone)
  // IMPORTANTE: date-fns-tz exige toZonedTime ANTES de format — passar a data
  // UTC crua faz o format usar o fuso do *sistema*, não o da clínica. Em produção
  // (Supabase roda em UTC) isso deslocaria o dia para qualquer clínica fora de UTC.
  const dataInicioJanelaUtc = fromZonedTime(
    `${format(toZonedTime(agora, tz), "yyyy-MM-dd", { timeZone: tz })}T00:00:00`,
    tz,
  );
  const dataFimJanelaUtc = fromZonedTime(
    `${format(toZonedTime(addDays(agora, dias - 1), tz), "yyyy-MM-dd", { timeZone: tz })}T23:59:59`,
    tz,
  );

  // 4. Agendamentos ativos (agendado | confirmado) que tocam a janela
  const { data: ocupados, error: agErr } = await supabase
    .from("agendamentos")
    .select("inicio, fim")
    .eq("profissional_id", profissionalId)
    .in("status", ["agendado", "confirmado", "recuperado"])
    .lt("inicio", dataFimJanelaUtc.toISOString())
    .gt("fim", dataInicioJanelaUtc.toISOString());

  if (agErr) throw new Error(`Erro nos agendamentos: ${agErr.message}`);

  const conflitos: AgendamentoRow[] = (ocupados as AgendamentoRow[]) ?? [];

  // 5. Gerar slots dia a dia
  const slots: SlotLivre[] = [];

  for (let d = 0; d < dias; d++) {
    const refUtc = addDays(agora, d);

    // Data no timezone da clínica, ex: "2030-01-07" (toZonedTime antes de format)
    const dateStr = format(toZonedTime(refUtc, tz), "yyyy-MM-dd", { timeZone: tz });

    // Dia da semana no timezone da clínica (0 = domingo … 6 = sábado)
    const diaSemana = toZonedTime(refUtc, tz).getDay();

    const blocos = (grade as HorarioRow[]).filter(
      (h) => h.dia_semana === diaSemana,
    );

    for (const bloco of blocos) {
      const hInicio = bloco.inicio.substring(0, 5); // normaliza "HH:mm:ss" → "HH:mm"
      const hFim = bloco.fim.substring(0, 5);

      // Converte horários locais para UTC usando a data correta no timezone
      let slotInicio = fromZonedTime(`${dateStr}T${hInicio}:00`, tz);
      const blocoFim = fromZonedTime(`${dateStr}T${hFim}:00`, tz);

      while (true) {
        const slotFim = addMinutes(slotInicio, duracaoMin);

        // Slot ultrapassaria o fim do bloco → encerrar
        if (slotFim > blocoFim) break;

        // Ignorar slots que já começaram ou são do passado
        if (slotInicio >= agora) {
          // Sobreposição: [slotInicio, slotFim) ∩ [agI, agF) ≠ ∅
          //   ⟺  slotInicio < agF  ∧  slotFim > agI
          const temConflito = conflitos.some((ag) => {
            const agI = new Date(ag.inicio);
            const agF = new Date(ag.fim);
            return slotInicio < agF && slotFim > agI;
          });

          if (!temConflito) {
            slots.push({
              inicio: slotInicio.toISOString(),
              fim: slotFim.toISOString(),
            });
          }
        }

        slotInicio = addMinutes(slotInicio, duracaoMin);
      }
    }
  }

  return slots;
}

// ---------------------------------------------------------------------------
// estaLivre
// ---------------------------------------------------------------------------

/**
 * Retorna true se o intervalo [inicio, fim) está completamente livre
 * para o profissional (sem agendamento ativo sobreposto).
 */
export async function estaLivre(
  supabase: DbClient,
  profissionalId: string,
  inicio: string | Date,
  fim: string | Date,
): Promise<boolean> {
  const inicioStr = inicio instanceof Date ? inicio.toISOString() : inicio;
  const fimStr = fim instanceof Date ? fim.toISOString() : fim;

  // Busca qualquer agendamento ativo que se sobreponha ao intervalo dado
  const { data, error } = await supabase
    .from("agendamentos")
    .select("id")
    .eq("profissional_id", profissionalId)
    .in("status", ["agendado", "confirmado", "recuperado"])
    .lt("inicio", fimStr)   // agendamento começa antes do fim do slot
    .gt("fim", inicioStr)   // agendamento termina depois do início do slot
    .limit(1);

  if (error) throw new Error(`Erro ao verificar disponibilidade: ${error.message}`);

  return !data || (data as unknown[]).length === 0;
}
