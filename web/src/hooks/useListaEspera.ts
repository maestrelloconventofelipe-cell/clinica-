import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ListaEspera } from '@/types'

export function useListaEspera(clinicaId: string) {
  return useQuery({
    queryKey: ['lista-espera', clinicaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lista_espera')
        .select('*, pacientes(id, nome, telefone), profissionais(id, nome)')
        .eq('clinica_id', clinicaId)
        .in('status', ['aguardando', 'ofertado'])
        .order('created_at', { ascending: true })

      if (error) throw error
      return (data as ListaEspera[]) ?? []
    },
    enabled: !!clinicaId,
    refetchInterval: 30_000,
  })
}
