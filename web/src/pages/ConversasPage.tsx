import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useConversas, useMensagens } from '@/hooks/useConversas'
import { Spinner } from '@/components/ui/Spinner'
import { formatarTelefone } from '@/lib/formatters'
import type { Mensagem } from '@/types'
import type { ConversaResumo } from '@/hooks/useConversas'

function RelativeTime({ iso }: { iso: string }) {
  const diff  = Date.now() - new Date(iso).getTime()
  const min   = Math.floor(diff / 60_000)
  const horas = Math.floor(min / 60)
  const dias  = Math.floor(horas / 24)

  let label: string
  if (min < 1)       label = 'agora'
  else if (min < 60) label = `${min}min`
  else if (horas < 24) label = `${horas}h`
  else               label = `${dias}d`

  return <span className="text-[11px] text-cinza-400">{label}</span>
}

function Bolha({ msg }: { msg: Mensagem }) {
  const isAssistant = msg.papel === 'assistant'
  return (
    <div className={`flex ${isAssistant ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isAssistant
            ? 'rounded-br-sm bg-verde-600 text-white'
            : 'rounded-bl-sm bg-white text-cinza-800 shadow-sm border border-cinza-200'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{msg.conteudo}</p>
        <p className={`mt-1 text-right text-[10px] ${isAssistant ? 'text-verde-200' : 'text-cinza-400'}`}>
          {new Date(msg.created_at).toLocaleTimeString('pt-BR', {
            hour: '2-digit', minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  )
}

function PainelConversa({ clinicaId, conversa }: { clinicaId: string; conversa: ConversaResumo }) {
  const { data: mensagens = [], isLoading } = useMensagens(clinicaId, conversa.telefone)
  const fimRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensagens.length])

  return (
    <div className="flex h-full flex-col">
      {/* Header do painel */}
      <div className="border-b border-cinza-200 bg-white px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-verde-100">
            <svg className="h-5 w-5 text-verde-700" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
            </svg>
          </div>
          <div>
            <p className="font-semibold text-cinza-900">
              {formatarTelefone(conversa.telefone)}
            </p>
            <p className="text-xs text-cinza-500">
              {mensagens.length} {mensagens.length === 1 ? 'mensagem' : 'mensagens'}
            </p>
          </div>
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto bg-cinza-50 p-4 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center pt-12">
            <Spinner />
          </div>
        ) : mensagens.length === 0 ? (
          <p className="text-center text-sm text-cinza-400 pt-12">
            Nenhuma mensagem registrada.
          </p>
        ) : (
          mensagens.map(m => <Bolha key={m.id} msg={m} />)
        )}
        <div ref={fimRef} />
      </div>
    </div>
  )
}

function ItemConversa({
  conversa,
  ativo,
  onClick,
}: {
  conversa: ConversaResumo
  ativo: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-4 py-3.5 text-left transition-colors hover:bg-cinza-50 border-b border-cinza-100 last:border-b-0 ${
        ativo ? 'bg-verde-50 border-l-4 border-l-verde-600' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-cinza-900 truncate">
            {formatarTelefone(conversa.telefone)}
          </p>
          <p className="mt-0.5 text-xs text-cinza-500 truncate">
            {conversa.papel === 'assistant' ? '↩ ' : ''}{conversa.ultimaMensagem}
          </p>
        </div>
        <RelativeTime iso={conversa.ultimoContato} />
      </div>
    </button>
  )
}

export function ConversasPage() {
  const { clinica } = useAuth()
  const [selecionado, setSelecionado] = useState<string | null>(null)

  const { data: conversas = [], isLoading } = useConversas(clinica?.id ?? '')

  const conversaSelecionada = conversas.find(c => c.telefone === selecionado) ?? null

  useEffect(() => {
    if (!selecionado && conversas.length > 0) {
      setSelecionado(conversas[0].telefone)
    }
  }, [conversas, selecionado])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner tamanho="lg" />
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Coluna lista */}
      <div className="flex w-72 flex-shrink-0 flex-col border-r border-cinza-200 bg-white">
        <div className="border-b border-cinza-200 px-4 py-4">
          <h1 className="font-display text-lg font-semibold text-cinza-900">Conversas</h1>
          <p className="text-xs text-cinza-500 mt-0.5">{conversas.length} pacientes</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversas.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-cinza-400">
              Nenhuma conversa registrada.
            </p>
          ) : (
            conversas.map(c => (
              <ItemConversa
                key={c.telefone}
                conversa={c}
                ativo={c.telefone === selecionado}
                onClick={() => setSelecionado(c.telefone)}
              />
            ))
          )}
        </div>
      </div>

      {/* Painel de mensagens */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {conversaSelecionada && clinica ? (
          <PainelConversa clinicaId={clinica.id} conversa={conversaSelecionada} />
        ) : (
          <div className="flex flex-1 items-center justify-center bg-cinza-50">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cinza-100">
                <svg className="h-7 w-7 text-cinza-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <p className="text-sm text-cinza-500">Selecione uma conversa</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
