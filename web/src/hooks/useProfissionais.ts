import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Profissional } from '@/types'

export function useProfissionais(clinicaId: string) {
  return useQuery({
    queryKey: ['profissionais', clinicaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profissionais')
        .select('*')
        .eq('clinica_id', clinicaId)
        .eq('ativo', true)
        .order('nome')

      if (error) throw error
      return (data as Profissional[]) ?? []
    },
    enabled: !!clinicaId,
    staleTime: 5 * 60_000,
  })
}
