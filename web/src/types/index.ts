export type PapelUsuario = 'admin' | 'recepcao'
export type StatusAgendamento = 'agendado' | 'confirmado' | 'cancelado' | 'realizado' | 'falta' | 'recuperado'
export type OrigemAgendamento = 'whatsapp' | 'manual'
export type StatusListaEspera = 'aguardando' | 'ofertado' | 'em_confirmacao' | 'aceito' | 'expirado'

export interface Clinica {
  id: string
  nome: string
  slug: string
  whatsapp_phone_number_id: string | null
  timezone: string
  valor_consulta: number
  ativo: boolean
  created_at: string
}

export interface Perfil {
  id: string
  clinica_id: string
  nome: string
  papel: PapelUsuario
  created_at: string
}

export interface Profissional {
  id: string
  clinica_id: string
  nome: string
  especialidade: string | null
  duracao_padrao_min: number
  ativo: boolean
}

export interface HorarioAtendimento {
  id: string
  profissional_id: string
  dia_semana: number
  inicio: string
  fim: string
}

export interface Paciente {
  id: string
  clinica_id: string
  nome: string
  telefone: string
  obs: string | null
  created_at: string
}

export interface Agendamento {
  id: string
  clinica_id: string
  profissional_id: string
  paciente_id: string
  inicio: string
  fim: string
  status: StatusAgendamento
  origem: OrigemAgendamento
  confirmacao_enviada_em: string | null
  created_at: string
  pacientes?: Pick<Paciente, 'id' | 'nome' | 'telefone'>
  profissionais?: Pick<Profissional, 'id' | 'nome' | 'especialidade'>
}

export interface ListaEspera {
  id: string
  clinica_id: string
  profissional_id: string
  paciente_id: string
  preferencia: string | null
  status: StatusListaEspera
  ofertado_em: string | null
  slot_inicio: string | null
  slot_fim: string | null
  agendamento_ofertado_id: string | null
  created_at: string
  pacientes?: Pick<Paciente, 'id' | 'nome' | 'telefone'>
  profissionais?: Pick<Profissional, 'id' | 'nome'>
}

export interface Mensagem {
  id: string
  clinica_id: string
  telefone: string
  papel: 'user' | 'assistant'
  conteudo: string
  created_at: string
}

export interface MetricasPeriodo {
  total: number
  agendado: number
  confirmado: number
  cancelado: number
  realizado: number
  falta: number
  recuperado: number
  taxaNoShow: number
  taxaConfirmacao: number
  vagasRecuperadas: number
}
