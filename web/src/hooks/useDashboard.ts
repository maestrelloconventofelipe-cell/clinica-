import { useQuery } from '@tanstack/react-query'
import { startOfMonth, endOfMonth } from 'date-fns'
import { supabase } from '@/lib/supabase'

export interface DashboardMetricas {
  cancelados: number
  vagasRecuperadas: number
  faltasEvitadas: number
  dinheiroSalvo: number
}

/**
 * Métricas do mês corrente para o Dashboard. Tudo via SQL puro — nenhuma IA.
 * "Vagas recuperadas" = agendamentos com status 'recuperado' (preenchidos pela
 * fila de espera). "Faltas evitadas" = mesma contagem (cada vaga recuperada é
 * um horário que não ficou ocioso). "Dinheiro salvo" = recuperadas × valor_consulta.
 */
export function useDashboard(clinicaId: string, valorConsulta: number) {
  return useQuery({
    queryKey: ['dashboard', clinicaId, valorConsulta],
    queryFn: async (): Promise<DashboardMetricas> => {
      const agora = new Date()
      const inicioIso = startOfMonth(agora).toISOString()
      const fimIso = endOfMonth(agora).toISOString()

      const contar = async (status: string): Promise<number> => {
        const { count, error } = await supabase
          .from('agendamentos')
          .select('*', { count: 'exact', head: true })
          .eq('clinica_id', clinicaId)
          .eq('status', status)
          .gte('inicio', inicioIso)
          .lte('inicio', fimIso)
        if (error) throw error
        return count ?? 0
      }

      const [cancelados, vagasRecuperadas] = await Promise.all([
        contar('cancelado'),
        contar('recuperado'),
      ])

      return {
        cancelados,
        vagasRecuperadas,
        faltasEvitadas: vagasRecuperadas,
        dinheiroSalvo: vagasRecuperadas * valorConsulta,
      }
    },
    enabled: !!clinicaId,
    staleTime: 60_000,
  })
}
