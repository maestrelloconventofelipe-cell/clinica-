import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Mensagem } from '@/types'

export interface ConversaResumo {
  telefone: string
  ultimaMensagem: string
  ultimoContato: string
  papel: 'user' | 'assistant'
}

export function useConversas(clinicaId: string) {
  return useQuery({
    queryKey: ['conversas', clinicaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mensagens')
        .select('telefone, conteudo, created_at, papel')
        .eq('clinica_id', clinicaId)
        .order('created_at', { ascending: false })
        .limit(500)

      if (error) throw error

      // Agrupar por telefone, mantendo apenas a mensagem mais recente
      const mapa = new Map<string, ConversaResumo>()
      for (const m of (data as Mensagem[]) ?? []) {
        if (!mapa.has(m.telefone)) {
          mapa.set(m.telefone, {
            telefone:      m.telefone,
            ultimaMensagem: m.conteudo,
            ultimoContato:  m.created_at,
            papel:          m.papel,
          })
        }
      }

      return Array.from(mapa.values())
    },
    enabled: !!clinicaId,
  })
}

export function useMensagens(clinicaId: string, telefone: string | null) {
  return useQuery({
    queryKey: ['mensagens', clinicaId, telefone],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mensagens')
        .select('*')
        .eq('clinica_id', clinicaId)
        .eq('telefone', telefone!)
        .order('created_at', { ascending: true })

      if (error) throw error
      return (data as Mensagem[]) ?? []
    },
    enabled: !!clinicaId && !!telefone,
  })
}
