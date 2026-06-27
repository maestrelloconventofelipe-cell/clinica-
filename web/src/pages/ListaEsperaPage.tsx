import { useAuth } from '@/hooks/useAuth'
import { useListaEspera } from '@/hooks/useListaEspera'
import { Spinner } from '@/components/ui/Spinner'
import { formatarTelefone, formatarDataCurta } from '@/lib/formatters'
import type { ListaEspera, StatusListaEspera } from '@/types'

const LABEL_PREFERENCIA: Record<string, string> = {
  manha:    'Manhã',
  manhã:    'Manhã',
  tarde:    'Tarde',
  noite:    'Noite',
  qualquer: 'Qualquer horário',
}

function labelPreferencia(p: string | null): string {
  if (!p) return 'Qualquer horário'
  return LABEL_PREFERENCIA[p.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()] ?? p
}

function BadgeEspera({ status }: { status: StatusListaEspera }) {
  const map: Record<StatusListaEspera, { cls: string; rot: string }> = {
    aguardando:     { cls: 'bg-cinza-100 text-cinza-700',                       rot: 'Aguardando' },
    ofertado:       { cls: 'bg-amber-100 text-amber-800 ring-1 ring-amber-300', rot: 'Oferta enviada' },
    em_confirmacao: { cls: 'bg-amber-100 text-amber-800 ring-1 ring-amber-300', rot: 'Em confirmação' },
    aceito:         { cls: 'bg-emerald-100 text-emerald-800',                   rot: 'Aceito' },
    expirado:       { cls: 'bg-red-50 text-red-600',                            rot: 'Expirado' },
  }
  const { cls, rot } = map[status]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {rot}
    </span>
  )
}

function Cartao({ entrada, timezone }: { entrada: ListaEspera; timezone: string }) {
  return (
    <div className="rounded-xl border border-cinza-200 bg-white p-4 shadow-card hover:shadow-card-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-cinza-900 truncate">
            {entrada.pacientes?.nome ?? '—'}
          </p>
          <p className="mt-0.5 text-xs text-cinza-500">
            {formatarTelefone(entrada.pacientes?.telefone ?? '')}
          </p>
        </div>
        <BadgeEspera status={entrada.status} />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-cinza-600">
        <span className="flex items-center gap-1">
          <svg className="h-3.5 w-3.5 text-cinza-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          {entrada.profissionais?.nome ?? '—'}
        </span>
        <span className="flex items-center gap-1">
          <svg className="h-3.5 w-3.5 text-cinza-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {labelPreferencia(entrada.preferencia)}
        </span>
        <span className="flex items-center gap-1">
          <svg className="h-3.5 w-3.5 text-cinza-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Entrou {formatarDataCurta(entrada.created_at, timezone)}
        </span>
      </div>

      {entrada.status === 'ofertado' && entrada.slot_inicio && (
        <div className="mt-3 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
          Vaga ofertada: {formatarDataCurta(entrada.slot_inicio, timezone)}
          {' · '}aguardando resposta via WhatsApp
        </div>
      )}
    </div>
  )
}

export function ListaEsperaPage() {
  const { clinica } = useAuth()
  const timezone = clinica?.timezone ?? 'America/Sao_Paulo'

  const { data = [], isLoading } = useListaEspera(clinica?.id ?? '')

  const aguardando = data.filter(e => e.status === 'aguardando')
  const ofertado   = data.filter(e => e.status === 'ofertado')

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner tamanho="lg" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-auto bg-cinza-50">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-cinza-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-semibold text-cinza-900">Lista de Espera</h1>
            <p className="mt-0.5 text-sm text-cinza-500">
              {data.length} {data.length === 1 ? 'paciente' : 'pacientes'} na fila
            </p>
          </div>
          <div className="flex gap-4 text-sm">
            <span className="flex items-center gap-1.5 text-cinza-600">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-cinza-300" />
              {aguardando.length} aguardando
            </span>
            <span className="flex items-center gap-1.5 text-amber-700">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
              {ofertado.length} com oferta pendente
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 px-6 py-6 space-y-8">
        {/* Ofertas pendentes — seção prioritária */}
        {ofertado.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-amber-700">
              Oferta enviada — aguardando resposta ({ofertado.length})
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ofertado.map(e => (
                <Cartao key={e.id} entrada={e} timezone={timezone} />
              ))}
            </div>
          </section>
        )}

        {/* Aguardando */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-cinza-500">
            Aguardando vaga ({aguardando.length})
          </h2>
          {aguardando.length === 0 ? (
            <div className="rounded-xl border border-dashed border-cinza-300 bg-white px-6 py-12 text-center">
              <p className="text-sm text-cinza-400">Nenhum paciente aguardando no momento.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {aguardando.map(e => (
                <Cartao key={e.id} entrada={e} timezone={timezone} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
