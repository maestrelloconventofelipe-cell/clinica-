import { cn } from '@/lib/cn'
import type { StatusAgendamento, StatusListaEspera } from '@/types'

type StatusTodos = StatusAgendamento | StatusListaEspera

const config: Record<StatusTodos, { label: string; classes: string; dot: string }> = {
  agendado:   { label: 'Agendado',   classes: 'bg-blue-50 text-blue-700 ring-blue-200',       dot: 'bg-blue-500' },
  confirmado: { label: 'Confirmado', classes: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  cancelado:  { label: 'Cancelado',  classes: 'bg-red-50 text-red-600 ring-red-200',           dot: 'bg-red-400' },
  realizado:  { label: 'Realizado',  classes: 'bg-cinza-100 text-cinza-500 ring-cinza-200',    dot: 'bg-cinza-400' },
  falta:      { label: 'Falta',      classes: 'bg-amber-50 text-amber-700 ring-amber-200',     dot: 'bg-amber-500' },
  recuperado: { label: 'Recuperado', classes: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-600' },
  aguardando: { label: 'Aguardando', classes: 'bg-blue-50 text-blue-700 ring-blue-200',        dot: 'bg-blue-400' },
  ofertado:   { label: 'Ofertado',   classes: 'bg-amber-50 text-amber-700 ring-amber-200',     dot: 'bg-amber-400' },
  em_confirmacao: { label: 'Em confirmação', classes: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  aceito:     { label: 'Aceito',     classes: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  expirado:   { label: 'Expirado',   classes: 'bg-cinza-100 text-cinza-500 ring-cinza-200',    dot: 'bg-cinza-300' },
}

interface Props {
  status: StatusTodos
  className?: string
}

export function Badge({ status, className }: Props) {
  const c = config[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        c.classes,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', c.dot)} />
      {c.label}
    </span>
  )
}

// Classes de bloco usadas na grade de agenda
export const blocoClasses: Record<StatusAgendamento, string> = {
  agendado:   'bg-blue-50 border-l-4 border-blue-500 text-blue-900',
  confirmado: 'bg-emerald-50 border-l-4 border-emerald-500 text-emerald-900',
  cancelado:  'bg-red-50 border-l-4 border-red-400 text-red-700 opacity-60',
  realizado:  'bg-cinza-100 border-l-4 border-cinza-400 text-cinza-600',
  falta:      'bg-amber-50 border-l-4 border-amber-500 text-amber-900',
  recuperado: 'bg-emerald-50 border-l-4 border-emerald-600 text-emerald-900',
}
