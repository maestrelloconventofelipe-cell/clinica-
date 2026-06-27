import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { LoginForm } from '@/components/auth/LoginForm'

export function LoginPage() {
  const { usuario, carregando } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!carregando && usuario) navigate('/agenda', { replace: true })
  }, [usuario, carregando, navigate])

  return (
    <div className="flex h-screen">
      {/* Lado esquerdo — brand */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-verde-700 p-12">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 border border-white/20">
            <svg className="h-6 w-6 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
            </svg>
          </div>
          <span className="font-display text-xl font-bold text-white">Recepção IA</span>
        </div>

        <div>
          <h1 className="font-display text-4xl font-bold leading-tight text-white">
            Agendamentos
            <br />
            que se organizam
            <br />
            <span className="text-verde-300">sozinhos.</span>
          </h1>
          <p className="mt-6 text-verde-200 leading-relaxed max-w-sm">
            Confirmação automática por WhatsApp, lista de espera inteligente
            e métricas em tempo real — tudo num painel simples para a sua clínica.
          </p>
        </div>

        {/* Decoração */}
        <div className="grid grid-cols-3 gap-3 opacity-30">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-2 rounded-full bg-white" />
          ))}
        </div>
      </div>

      {/* Lado direito — form */}
      <div className="flex flex-1 flex-col items-center justify-center bg-cinza-50 px-8">
        <div className="w-full max-w-sm">
          {/* Logo mobile */}
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-verde-700">
              <svg className="h-5 w-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
              </svg>
            </div>
            <span className="font-display text-lg font-bold text-cinza-900">Recepção IA</span>
          </div>

          <h2 className="font-display text-2xl font-bold text-cinza-900">Entrar</h2>
          <p className="mt-1 text-sm text-cinza-500">
            Acesse o painel da sua clínica.
          </p>

          <div className="mt-8">
            <LoginForm />
          </div>
        </div>
      </div>
    </div>
  )
}
