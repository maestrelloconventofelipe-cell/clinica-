import { useState } from 'react'
import { startOfMonth, endOfMonth } from 'date-fns'
import { useAuth } from '@/hooks/useAuth'
import { useDashboard } from '@/hooks/useDashboard'
import { Spinner } from '@/components/ui/Spinner'
import { supabase } from '@/lib/supabase'
import { formatarMoeda } from '@/lib/formatters'
import { baixarCsv } from '@/lib/export'
import type { StatusAgendamento } from '@/types'

const ROTULO_STATUS: Record<StatusAgendamento, string> = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  cancelado: 'Cancelado',
  realizado: 'Realizado',
  falta: 'Falta',
  recuperado: 'Recuperado',
}

interface LinhaRelatorio {
  inicio: string
  status: StatusAgendamento
  origem: string
  pacientes: { nome: string; telefone: string } | null
  profissionais: { nome: string } | null
}

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
  const [exportando, setExportando] = useState(false)

  async function exportarRelatorio() {
    if (!clinica?.id) return
    setExportando(true)
    try {
      const agora = new Date()
      const { data: ags, error } = await supabase
        .from('agendamentos')
        .select('inicio, status, origem, pacientes(nome, telefone), profissionais(nome)')
        .eq('clinica_id', clinica.id)
        .gte('inicio', startOfMonth(agora).toISOString())
        .lte('inicio', endOfMonth(agora).toISOString())
        .order('inicio', { ascending: true })

      if (error) throw error

      const tz = clinica.timezone
      const linhas = ((ags ?? []) as unknown as LinhaRelatorio[]).map((a) => [
        new Date(a.inicio).toLocaleString('pt-BR', {
          timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        }),
        a.pacientes?.nome ?? '',
        a.pacientes?.telefone ?? '',
        a.profissionais?.nome ?? '',
        ROTULO_STATUS[a.status] ?? a.status,
        a.origem === 'whatsapp' ? 'WhatsApp' : 'Manual',
        valorConsulta,
      ])

      const mes = agora.toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' }).replace('/', '-')
      baixarCsv(
        `relatorio-${mes}`,
        ['Data/Hora', 'Paciente', 'Telefone', 'Profissional', 'Status', 'Origem', 'Valor consulta (R$)'],
        linhas,
      )
    } catch (e) {
      console.error('[dashboard] falha ao exportar relatório:', e)
      alert('Não foi possível gerar a planilha. Tente novamente.')
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-auto bg-cinza-50">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-cinza-200 bg-white px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-semibold text-cinza-900">Dashboard</h1>
            <p className="mt-0.5 text-sm text-cinza-500">
              Resumo do mês — dados via SQL, nenhuma chamada de IA
            </p>
          </div>
          <button
            onClick={exportarRelatorio}
            disabled={exportando || !clinica?.id}
            className="inline-flex items-center gap-2 rounded-lg bg-verde-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-verde-700 disabled:opacity-60"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m-9 7h12a2 2 0 002-2V7a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {exportando ? 'Gerando…' : 'Exportar planilha'}
          </button>
        </div>
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
