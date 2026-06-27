import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { addDays } from 'date-fns'
import { supabase } from '@/lib/supabase'
import type { Agendamento, StatusAgendamento } from '@/types'

export function useAgendaSemana(
  clinicaId: string,
  profissionalId: string | null,
  semanaInicio: Date,
) {
  const dataFim = addDays(semanaInicio, 7)

  return useQuery({
    queryKey: ['agenda', clinicaId, profissionalId, semanaInicio.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agendamentos')
        .select('*, pacientes(id, nome, telefone)')
        .eq('clinica_id', clinicaId)
        .eq('profissional_id', profissionalId!)
        .gte('inicio', semanaInicio.toISOString())
        .lt('inicio', dataFim.toISOString())
        .order('inicio')

      if (error) throw error
      return (data as Agendamento[]) ?? []
    },
    enabled: !!clinicaId && !!profissionalId,
  })
}

export function useCriarAgendamento() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (dados: {
      clinicaId: string
      profissionalId: string
      pacienteNome: string
      pacienteTelefone: string
      inicio: string
      duracaoMin: number
    }) => {
      // Upsert do paciente pelo telefone
      const { data: pac, error: pacErr } = await supabase
        .from('pacientes')
        .upsert(
          { clinica_id: dados.clinicaId, nome: dados.pacienteNome, telefone: dados.pacienteTelefone },
          { onConflict: 'clinica_id,telefone' },
        )
        .select('id')
        .single<{ id: string }>()

      if (pacErr || !pac) throw new Error(pacErr?.message ?? 'Erro ao salvar paciente')

      const fim = new Date(new Date(dados.inicio).getTime() + dados.duracaoMin * 60_000).toISOString()

      const { data: ag, error: agErr } = await supabase
        .from('agendamentos')
        .insert({
          clinica_id:      dados.clinicaId,
          profissional_id: dados.profissionalId,
          paciente_id:     pac.id,
          inicio:          dados.inicio,
          fim,
          status:  'agendado',
          origem:  'manual',
        })
        .select('id')
        .single<{ id: string }>()

      if (agErr || !ag) throw new Error(agErr?.message ?? 'Erro ao criar agendamento')
      return ag
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agenda'] }),
  })
}

export function useAtualizarStatus() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: StatusAgendamento }) => {
      const { error } = await supabase
        .from('agendamentos')
        .update({ status })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agenda'] }),
  })
}
