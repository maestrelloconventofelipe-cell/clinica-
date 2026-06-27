import { useState, useMemo } from 'react'
import { subDays, startOfDay, endOfDay } from 'date-fns'
import { useAuth } from '@/hooks/useAuth'
import { useMetricas } from '@/hooks/useMetricas'
import { Spinner } from '@/components/ui/Spinner'
import { percentual } from '@/lib/formatters'
import type { MetricasPeriodo } from '@/types'

type Periodo = '7d' | '30d' | '90d'

const OPCOES_PERIODO: { valor: Periodo; rotulo: string }[] = [
  { valor: '7d',  rotulo: '7 dias'   },
  { valor: '30d', rotulo: '30 dias'  },
  { valor: '90d', rotulo: '90 dias'  },
]

function diasAtras(n: number): { inicio: Date; fim: Date } {
  const agora = new Date()
  return {
    inicio: startOfDay(subDays(agora, n - 1)),
    fim:    endOfDay(agora),
  }
}

function cartaoPeriodo(periodo: Periodo): { inicio: Date; fim: Date } {
  if (periodo === '7d')  return diasAtras(7)
  if (periodo === '30d') return diasAtras(30)
  return diasAtras(90)
}

interface CardProps {
  titulo: string
  valor: string | number
  cor?: 'padrao' | 'verde' | 'vermelho' | 'amarelo' | 'cinza'
  descricao?: string
  icone: React.ReactNode
}

const corMap: Record<NonNullable<CardProps['cor']>, { bg: string; icon: string; valor: string }> = {
  padrao:   { bg: 'bg-white',       icon: 'text-cinza-400', valor: 'text-cinza-900'    },
  verde:    { bg: 'bg-verde-50',    icon: 'text-verde-600',  valor: 'text-verde-800'    },
  vermelho: { bg: 'bg-red-50',      icon: 'text-red-500',    valor: 'text-red-700'      },
  amarelo:  { bg: 'bg-amber-50',    icon: 'text-amber-500',  valor: 'text-amber-800'    },
  cinza:    { bg: 'bg-cinza-50',    icon: 'text-cinza-400',  valor: 'text-cinza-700'    },
}

function Card({ titulo, valor, cor = 'padrao', descricao, icone }: CardProps) {
  const { bg, icon, valor: valorCor } = corMap[cor]
  return (
    <div className={`${bg} rounded-xl border border-cinza-200 p-5 shadow-card`}>
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-cinza-500">{titulo}</p>
        <div className={`${icon}`}>{icone}</div>
      </div>
      <p className={`mt-3 font-display text-3xl font-bold ${valorCor}`}>{valor}</p>
      {descricao && (
        <p className="mt-1.5 text-xs text-cinza-500">{descricao}</p>
      )}
    </div>
  )
}

function GaugeBarra({ valor, cor }: { valor: number; cor: string }) {
  const pct = Math.min(100, Math.round(valor * 100))
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between text-xs text-cinza-500 mb-1.5">
        <span>0%</span>
        <span className="font-semibold text-cinza-700">{pct}%</span>
        <span>100%</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-cinza-200">
        <div
          className={`h-full rounded-full transition-all duration-500 ${cor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function CardTaxa({
  titulo,
  valor,
  corBarra,
  descricao,
}: {
  titulo: string
  valor: number
  corBarra: string
  descricao: string
}) {
  return (
    <div className="rounded-xl border border-cinza-200 bg-white p-5 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-wider text-cinza-500">{titulo}</p>
      <p className="mt-2 font-display text-3xl font-bold text-cinza-900">{percentual(valor)}</p>
      <GaugeBarra valor={valor} cor={corBarra} />
      <p className="mt-2 text-xs text-cinza-500">{descricao}</p>
    </div>
  )
}

function Icone({ path }: { path: string }) {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  )
}

function DistribuicaoStatus({ metricas }: { metricas: MetricasPeriodo }) {
  const itens = [
    { rotulo: 'Realizados',  valor: metricas.realizado,  cor: 'bg-cinza-400'     },
    { rotulo: 'Confirmados', valor: metricas.confirmado, cor: 'bg-verde-500'      },
    { rotulo: 'Recuperados', valor: metricas.recuperado, cor: 'bg-verde-600'      },
    { rotulo: 'Agendados',   valor: metricas.agendado,   cor: 'bg-blue-400'      },
    { rotulo: 'Faltas',      valor: metricas.falta,      cor: 'bg-amber-400'     },
    { rotulo: 'Cancelados',  valor: metricas.cancelado,  cor: 'bg-red-400'       },
  ].filter(i => i.valor > 0)

  if (metricas.total === 0) return null

  return (
    <div className="rounded-xl border border-cinza-200 bg-white p-5 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-wider text-cinza-500 mb-4">
        Distribuição por status
      </p>

      {/* Barra empilhada */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-cinza-100">
        {itens.map(i => (
          <div
            key={i.rotulo}
            className={`${i.cor} transition-all`}
            style={{ width: `${(i.valor / metricas.total) * 100}%` }}
            title={`${i.rotulo}: ${i.valor}`}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        {itens.map(i => (
          <div key={i.rotulo} className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${i.cor}`} />
            <span className="text-xs text-cinza-600">
              {i.rotulo} <span className="font-semibold text-cinza-800">{i.valor}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MetricasPage() {
  const { clinica } = useAuth()
  const [periodo, setPeriodo] = useState<Periodo>('30d')

  const intervalo = useMemo(() => cartaoPeriodo(periodo), [periodo])

  const { data: metricas, isLoading } = useMetricas(clinica?.id ?? '', intervalo)

  return (
    <div className="flex flex-col h-full overflow-auto bg-cinza-50">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-cinza-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-semibold text-cinza-900">Métricas</h1>
            <p className="mt-0.5 text-sm text-cinza-500">
              Dados via SQL — nenhuma chamada de IA
            </p>
          </div>

          <div className="flex items-center rounded-lg border border-cinza-200 bg-cinza-50 p-1 gap-0.5">
            {OPCOES_PERIODO.map(op => (
              <button
                key={op.valor}
                onClick={() => setPeriodo(op.valor)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  periodo === op.valor
                    ? 'bg-white text-cinza-900 shadow-sm'
                    : 'text-cinza-500 hover:text-cinza-700'
                }`}
              >
                {op.rotulo}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 px-6 py-6">
        {isLoading || !metricas ? (
          <div className="flex items-center justify-center py-24">
            <Spinner tamanho="lg" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* KPIs principais */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card
                titulo="Total de consultas"
                valor={metricas.total}
                icone={<Icone path="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />}
              />
              <Card
                titulo="Realizadas"
                valor={metricas.realizado}
                cor="cinza"
                descricao="Consultas completadas no período"
                icone={<Icone path="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />}
              />
              <Card
                titulo="Faltas"
                valor={metricas.falta}
                cor={metricas.falta > 0 ? 'amarelo' : 'padrao'}
                descricao="Pacientes que não compareceram"
                icone={<Icone path="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />}
              />
              <Card
                titulo="Vagas recuperadas"
                valor={metricas.vagasRecuperadas}
                cor={metricas.vagasRecuperadas > 0 ? 'verde' : 'padrao'}
                descricao="Horários preenchidos via lista de espera"
                icone={<Icone path="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />}
              />
            </div>

            {/* Taxas */}
            <div className="grid gap-4 sm:grid-cols-2">
              <CardTaxa
                titulo="Taxa de no-show"
                valor={metricas.taxaNoShow}
                corBarra="bg-amber-400"
                descricao="Faltas ÷ (realizadas + faltas)"
              />
              <CardTaxa
                titulo="Taxa de confirmação"
                valor={metricas.taxaConfirmacao}
                corBarra="bg-verde-500"
                descricao="(Confirmadas + realizadas) ÷ total"
              />
            </div>

            {/* Distribuição */}
            <DistribuicaoStatus metricas={metricas} />

            {/* Detalhamento */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card
                titulo="Agendadas"
                valor={metricas.agendado}
                cor="padrao"
                descricao="Aguardando confirmação"
                icone={<Icone path="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />}
              />
              <Card
                titulo="Confirmadas"
                valor={metricas.confirmado}
                cor="verde"
                descricao="Paciente confirmou presença"
                icone={<Icone path="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />}
              />
              <Card
                titulo="Canceladas"
                valor={metricas.cancelado}
                cor={metricas.cancelado > 0 ? 'vermelho' : 'padrao'}
                descricao="Canceladas no período"
                icone={<Icone path="M6 18L18 6M6 6l12 12" />}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
