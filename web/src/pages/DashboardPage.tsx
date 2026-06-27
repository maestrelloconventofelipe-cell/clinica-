import { useAuth } from '@/hooks/useAuth'
import { useDashboard } from '@/hooks/useDashboard'
import { Spinner } from '@/components/ui/Spinner'
import { formatarMoeda } from '@/lib/formatters'

function Icone({ path }: { path: string }) {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  )
}

interface CardProps {
  titulo: string
  valor: string | number
  descricao: string
  cor: 'verde' | 'vermelho' | 'amarelo' | 'padrao'
  icone: React.ReactNode
}

const corMap: Record<CardProps['cor'], { bg: string; icon: string; valor: string }> = {
  padrao:   { bg: 'bg-white',    icon: 'text-cinza-400', valor: 'text-cinza-900' },
  verde:    { bg: 'bg-verde-50', icon: 'text-verde-600', valor: 'text-verde-800' },
  vermelho: { bg: 'bg-red-50',   icon: 'text-red-500',   valor: 'text-red-700'   },
  amarelo:  { bg: 'bg-amber-50', icon: 'text-amber-500', valor: 'text-amber-800' },
}

function Card({ titulo, valor, descricao, cor, icone }: CardProps) {
  const { bg, icon, valor: valorCor } = corMap[cor]
  return (
    <div className={`${bg} rounded-xl border border-cinza-200 p-5 shadow-card`}>
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-cinza-500">{titulo}</p>
        <div className={icon}>{icone}</div>
      </div>
      <p className={`mt-3 font-display text-3xl font-bold ${valorCor}`}>{valor}</p>
      <p className="mt-1.5 text-xs text-cinza-500">{descricao}</p>
    </div>
  )
}

export function DashboardPage() {
  const { clinica } = useAuth()
  const valorConsulta = clinica?.valor_consulta ?? 0
  const { data, isLoading } = useDashboard(clinica?.id ?? '', valorConsulta)

  return (
    <div className="flex flex-col h-full overflow-auto bg-cinza-50">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-cinza-200 bg-white px-6 py-4">
        <h1 className="font-display text-xl font-semibold text-cinza-900">Dashboard</h1>
        <p className="mt-0.5 text-sm text-cinza-500">
          Resumo do mês — dados via SQL, nenhuma chamada de IA
        </p>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 px-6 py-6">
        {isLoading || !data ? (
          <div className="flex items-center justify-center py-24">
            <Spinner tamanho="lg" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Destaque: Dinheiro salvo */}
            <div className="rounded-2xl border border-verde-200 bg-gradient-to-br from-verde-600 to-verde-700 p-6 text-white shadow-card">
              <p className="text-xs font-semibold uppercase tracking-wider text-verde-100">
                Dinheiro salvo no mês
              </p>
              <p className="mt-2 font-display text-4xl font-bold">
                {formatarMoeda(data.dinheiroSalvo)}
              </p>
              <p className="mt-1.5 text-sm text-verde-100">
                {data.vagasRecuperadas} vaga(s) recuperada(s) × {formatarMoeda(valorConsulta)} por consulta
              </p>
              {valorConsulta === 0 && (
                <p className="mt-2 text-xs text-verde-200">
                  Defina o valor da consulta nas configurações da clínica para ver este valor.
                </p>
              )}
            </div>

            {/* KPIs */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card
                titulo="Cancelados no mês"
                valor={data.cancelados}
                cor={data.cancelados > 0 ? 'vermelho' : 'padrao'}
                descricao="Consultas canceladas no período"
                icone={<Icone path="M6 18L18 6M6 6l12 12" />}
              />
              <Card
                titulo="Vagas recuperadas"
                valor={data.vagasRecuperadas}
                cor={data.vagasRecuperadas > 0 ? 'verde' : 'padrao'}
                descricao="Horários preenchidos pela lista de espera"
                icone={<Icone path="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />}
              />
              <Card
                titulo="Faltas evitadas"
                valor={data.faltasEvitadas}
                cor={data.faltasEvitadas > 0 ? 'verde' : 'padrao'}
                descricao="Vagas que não viraram horário ocioso"
                icone={<Icone path="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
