import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { MetricasPeriodo, StatusAgendamento } from '@/types'

export function useMetricas(
  clinicaId: string,
  periodo: { inicio: Date; fim: Date },
) {
  return useQuery({
    queryKey: ['metricas', clinicaId, periodo.inicio.toISOString(), periodo.fim.toISOString()],
    queryFn: async (): Promise<MetricasPeriodo> => {
      const inicioIso = periodo.inicio.toISOString()
      const fimIso   = periodo.fim.toISOString()

      // Todos os agendamentos do período (só o campo status — query leve)
      const { data: ags, error: agErr } = await supabase
        .from('agendamentos')
        .select('status')
        .eq('clinica_id', clinicaId)
        .gte('inicio', inicioIso)
        .lt('inicio', fimIso)

      if (agErr) throw agErr

      const porStatus: Record<StatusAgendamento, number> = {
        agendado:  0,
        confirmado: 0,
        cancelado:  0,
        realizado:  0,
        falta:      0,
        recuperado: 0,
      }

      for (const a of ags ?? []) {
        const s = a.status as StatusAgendamento
        porStatus[s]++
      }

      const total     = Object.values(porStatus).reduce((s, n) => s + n, 0)
      const atendidos = porStatus.realizado + porStatus.falta

      // Vagas recuperadas = agendamentos preenchidos pela fila (status 'recuperado').
      // Mesma fonte do Dashboard — sem IA, pura contagem SQL.
      return {
        total,
        ...porStatus,
        taxaNoShow:       atendidos > 0 ? porStatus.falta / atendidos : 0,
        taxaConfirmacao:  total > 0
          ? (porStatus.confirmado + porStatus.realizado) / total
          : 0,
        vagasRecuperadas: porStatus.recuperado,
      }
    },
    enabled: !!clinicaId,
    staleTime: 60_000,
  })
}
