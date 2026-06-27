import { useState, useMemo, useCallback } from 'react'
import { addDays, subDays, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useAuth } from '@/hooks/useAuth'
import { useProfissionais } from '@/hooks/useProfissionais'
import { useAgendaSemana, useCriarAgendamento, useAtualizarStatus } from '@/hooks/useAgenda'
import { Modal } from '@/components/ui/Modal'
import { Botao } from '@/components/ui/Botao'
import { Badge, blocoClasses } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import {
  inicioSemana,
  diasDaSemana,
  formatarDiaHeader,
  formatarHora,
  formatarDataHoraLonga,
  topPxNoGrid,
  heightPxNoGrid,
  isMesmoDia,
  localDateToUtcIso,
  GRID_START_HOUR,
  GRID_END_HOUR,
  SLOT_HEIGHT_PX,
  SLOT_MIN,
} from '@/lib/formatters'
import type { Agendamento, Profissional, StatusAgendamento } from '@/types'

const TOTAL_SLOTS = ((GRID_END_HOUR - GRID_START_HOUR) * 60) / SLOT_MIN

// ---------------------------------------------------------------------------
// AgendaPage
// ---------------------------------------------------------------------------

export function AgendaPage() {
  const { clinica } = useAuth()
  const timezone = clinica?.timezone ?? 'America/Sao_Paulo'

  const [semanaInicio, setSemanaInicio] = useState(() => inicioSemana(new Date()))
  const [profId, setProfId]             = useState<string | null>(null)
  const [agSelecionado, setAgSelecionado] = useState<Agendamento | null>(null)
  const [modalNovo, setModalNovo] = useState<{ dia: Date; hora: string } | null>(null)

  const { data: profissionais = [], isLoading: loadingProfs } = useProfissionais(clinica?.id ?? '')
  const profissional = profissionais.find(p => p.id === (profId ?? profissionais[0]?.id))
  const profIdReal   = profissional?.id ?? null

  const { data: agendamentos = [], isLoading: loadingAgs } = useAgendaSemana(
    clinica?.id ?? '',
    profIdReal,
    semanaInicio,
  )

  const dias = useMemo(() => diasDaSemana(semanaInicio), [semanaInicio])

  const semanaLabel = useMemo(() => {
    const fim = addDays(semanaInicio, 6)
    return `${format(semanaInicio, 'd MMM', { locale: ptBR })} – ${format(fim, 'd MMM yyyy', { locale: ptBR })}`
  }, [semanaInicio])

  const agsNoDia = useCallback(
    (dia: Date) => agendamentos.filter(ag => isMesmoDia(ag.inicio, dia, timezone)),
    [agendamentos, timezone],
  )

  function handleClickSlot(dia: Date, slotIdx: number) {
    const totalMin = GRID_START_HOUR * 60 + slotIdx * SLOT_MIN
    const h = Math.floor(totalMin / 60).toString().padStart(2, '0')
    const m = (totalMin % 60).toString().padStart(2, '0')
    setModalNovo({ dia, hora: `${h}:${m}` })
  }

  if (loadingProfs) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner tamanho="lg" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* ---- Header ---- */}
      <div className="flex items-center justify-between border-b border-cinza-200 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <h1 className="font-display text-xl font-semibold text-cinza-900">Agenda</h1>

          <div className="flex items-center gap-1 rounded-lg border border-cinza-200 bg-cinza-50 px-1 py-1">
            <button
              onClick={() => setSemanaInicio(d => subDays(d, 7))}
              className="rounded p-1 text-cinza-500 hover:bg-white hover:text-cinza-800 transition-colors"
              aria-label="Semana anterior"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="min-w-[160px] text-center text-sm font-medium text-cinza-700">
              {semanaLabel}
            </span>
            <button
              onClick={() => setSemanaInicio(d => addDays(d, 7))}
              className="rounded p-1 text-cinza-500 hover:bg-white hover:text-cinza-800 transition-colors"
              aria-label="Próxima semana"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          <button
            onClick={() => setSemanaInicio(inicioSemana(new Date()))}
            className="rounded-lg border border-cinza-200 bg-white px-3 py-1.5 text-xs font-medium text-cinza-600 hover:bg-cinza-50 transition-colors"
          >
            Hoje
          </button>
        </div>

        <select
          value={profIdReal ?? ''}
          onChange={e => setProfId(e.target.value)}
          className="rounded-lg border border-cinza-300 bg-white px-3 py-2 text-sm text-cinza-800 focus:outline-none focus:ring-2 focus:ring-verde-600"
        >
          {profissionais.map(p => (
            <option key={p.id} value={p.id}>{p.nome}</option>
          ))}
        </select>
      </div>

      {/* ---- Grid ---- */}
      <div className="flex-1 overflow-auto bg-white">
        {/* Day headers (sticky) */}
        <div
          className="sticky top-0 z-10 grid border-b border-cinza-200 bg-white"
          style={{ gridTemplateColumns: '52px repeat(7, minmax(100px, 1fr))' }}
        >
          <div className="border-r border-cinza-100" />
          {dias.map((dia, i) => {
            const { abrev, numero } = formatarDiaHeader(dia)
            const isHoje = format(dia, 'd/MM') === format(new Date(), 'd/MM')
            return (
              <div
                key={i}
                className={`border-r border-cinza-100 py-2.5 text-center last:border-r-0 ${isHoje ? 'bg-verde-50' : ''}`}
              >
                <p className={`text-xs font-semibold uppercase tracking-wide ${isHoje ? 'text-verde-700' : 'text-cinza-400'}`}>
                  {abrev}
                </p>
                <p className={`mt-0.5 text-sm font-medium ${isHoje ? 'text-verde-700' : 'text-cinza-700'}`}>
                  {numero}
                </p>
              </div>
            )
          })}
        </div>

        {loadingAgs ? (
          <div className="flex items-center justify-center py-24">
            <Spinner />
          </div>
        ) : (
          <div
            className="grid"
            style={{ gridTemplateColumns: '52px repeat(7, minmax(100px, 1fr))' }}
          >
            {/* Time labels column */}
            <div
              className="relative border-r border-cinza-100"
              style={{ height: `${TOTAL_SLOTS * SLOT_HEIGHT_PX}px` }}
            >
              {Array.from({ length: TOTAL_SLOTS + 1 }, (_, i) =>
                i % 2 === 0 ? (
                  <div
                    key={i}
                    className="absolute right-2 text-[11px] text-cinza-400 -translate-y-2.5"
                    style={{ top: `${i * SLOT_HEIGHT_PX}px` }}
                  >
                    {String(GRID_START_HOUR + i / 2).padStart(2, '0')}:00
                  </div>
                ) : null,
              )}
            </div>

            {/* Day columns */}
            {dias.map((dia, colIdx) => {
              const isHoje = format(dia, 'd/MM') === format(new Date(), 'd/MM')
              return (
                <div
                  key={colIdx}
                  className={`relative border-r border-cinza-100 last:border-r-0 ${isHoje ? 'bg-verde-50/30' : ''}`}
                  style={{ height: `${TOTAL_SLOTS * SLOT_HEIGHT_PX}px` }}
                >
                  {/* Slot click targets + grid lines */}
                  {Array.from({ length: TOTAL_SLOTS }, (_, i) => (
                    <div
                      key={i}
                      className={`absolute inset-x-0 cursor-pointer hover:bg-verde-50 transition-colors ${
                        i % 2 === 0 ? 'border-t border-cinza-200' : 'border-t border-cinza-100'
                      }`}
                      style={{ top: `${i * SLOT_HEIGHT_PX}px`, height: `${SLOT_HEIGHT_PX}px` }}
                      onClick={() => handleClickSlot(dia, i)}
                    />
                  ))}

                  {/* Appointment blocks */}
                  {agsNoDia(dia).map(ag => (
                    <div
                      key={ag.id}
                      className={`absolute left-1 right-1 z-10 cursor-pointer rounded-md overflow-hidden shadow-sm hover:shadow-md transition-shadow ${blocoClasses[ag.status]}`}
                      style={{
                        top:    `${topPxNoGrid(ag.inicio, timezone)}px`,
                        height: `${heightPxNoGrid(ag.inicio, ag.fim)}px`,
                      }}
                      onClick={e => { e.stopPropagation(); setAgSelecionado(ag) }}
                    >
                      <div className="px-2 py-1">
                        <p className="text-xs font-semibold leading-tight truncate">
                          {ag.pacientes?.nome ?? '—'}
                        </p>
                        <p className="text-[11px] opacity-75">
                          {formatarHora(ag.inicio, timezone)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      {agSelecionado && (
        <DetalheModal
          ag={agSelecionado}
          timezone={timezone}
          aoFechar={() => setAgSelecionado(null)}
        />
      )}

      {modalNovo && profissional && (
        <NovoAgendamentoModal
          dia={modalNovo.dia}
          hora={modalNovo.hora}
          profissional={profissional}
          clinicaId={clinica!.id}
          timezone={timezone}
          aoFechar={() => setModalNovo(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal: detalhes + mudança de status
// ---------------------------------------------------------------------------

function DetalheModal({
  ag,
  timezone,
  aoFechar,
}: {
  ag: Agendamento
  timezone: string
  aoFechar: () => void
}) {
  const { mutate: atualizar, isPending } = useAtualizarStatus()

  const todasAcoes: { status: StatusAgendamento; rotulo: string; variante: 'primario' | 'secundario' | 'perigo' | 'fantasma' }[] = [
    { status: 'confirmado', rotulo: 'Confirmar presença',     variante: 'primario'   },
    { status: 'realizado',  rotulo: 'Marcar como realizado',  variante: 'secundario' },
    { status: 'falta',      rotulo: 'Marcar como falta',      variante: 'fantasma'   },
    { status: 'cancelado',  rotulo: 'Cancelar consulta',      variante: 'perigo'     },
  ]
  const acoes = todasAcoes.filter(a => a.status !== ag.status)

  return (
    <Modal aberto aoFechar={aoFechar} titulo="Detalhes da Consulta">
      <div className="space-y-4">
        <div className="rounded-lg bg-cinza-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-cinza-500">Status</span>
            <Badge status={ag.status} />
          </div>
          <InfoRow label="Paciente"  valor={ag.pacientes?.nome ?? '—'} />
          <InfoRow label="Telefone"  valor={ag.pacientes?.telefone ?? '—'} />
          <InfoRow label="Horário"   valor={formatarDataHoraLonga(ag.inicio, timezone)} />
          <InfoRow label="Origem"    valor={ag.origem === 'whatsapp' ? 'WhatsApp' : 'Manual'} />
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {acoes.map(a => (
            <Botao
              key={a.status}
              variante={a.variante}
              tamanho="sm"
              carregando={isPending}
              onClick={() => { atualizar({ id: ag.id, status: a.status }); aoFechar() }}
            >
              {a.rotulo}
            </Botao>
          ))}
        </div>
      </div>
    </Modal>
  )
}

function InfoRow({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-cinza-500 shrink-0">{label}</span>
      <span className="text-sm font-medium text-cinza-800 text-right">{valor}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal: criar novo agendamento
// ---------------------------------------------------------------------------

function NovoAgendamentoModal({
  dia,
  hora,
  profissional,
  clinicaId,
  timezone,
  aoFechar,
}: {
  dia: Date
  hora: string
  profissional: Profissional
  clinicaId: string
  timezone: string
  aoFechar: () => void
}) {
  const [pacienteNome, setPacienteNome] = useState('')
  const [pacienteTel,  setPacienteTel]  = useState('')
  const [horaLocal,    setHoraLocal]    = useState(hora)
  const [erroMsg,      setErroMsg]      = useState<string | null>(null)

  const dataLabel = format(dia, "EEEE, d 'de' MMMM", { locale: ptBR })

  const { mutate: criar, isPending } = useCriarAgendamento()

  function handleSubmit() {
    setErroMsg(null)
    if (!pacienteNome.trim() || !pacienteTel.trim()) {
      setErroMsg('Preencha nome e telefone do paciente.')
      return
    }
    const inicio = localDateToUtcIso(format(dia, 'yyyy-MM-dd'), horaLocal, timezone)
    criar(
      {
        clinicaId,
        profissionalId:   profissional.id,
        pacienteNome:     pacienteNome.trim(),
        pacienteTelefone: pacienteTel.trim(),
        inicio,
        duracaoMin: profissional.duracao_padrao_min,
      },
      {
        onSuccess: aoFechar,
        onError:   e => setErroMsg((e as Error).message),
      },
    )
  }

  return (
    <Modal aberto aoFechar={aoFechar} titulo="Nova Consulta">
      <div className="space-y-4">
        <div className="rounded-lg bg-verde-50 border border-verde-100 px-4 py-3">
          <p className="text-sm font-semibold text-verde-800">{profissional.nome}</p>
          <p className="text-xs text-verde-600 mt-0.5 capitalize">{dataLabel}</p>
        </div>

        <Input
          label="Hora"
          type="time"
          value={horaLocal}
          onChange={e => setHoraLocal(e.target.value)}
        />
        <Input
          label="Nome do paciente"
          value={pacienteNome}
          onChange={e => setPacienteNome(e.target.value)}
          placeholder="Maria da Silva"
          autoFocus
        />
        <Input
          label="Telefone (WhatsApp)"
          value={pacienteTel}
          onChange={e => setPacienteTel(e.target.value)}
          placeholder="+5511999999999"
        />

        {erroMsg && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{erroMsg}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Botao variante="secundario" onClick={aoFechar}>Cancelar</Botao>
          <Botao variante="primario" carregando={isPending} onClick={handleSubmit}>
            Agendar
          </Botao>
        </div>
      </div>
    </Modal>
  )
}
