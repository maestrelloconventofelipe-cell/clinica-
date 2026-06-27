import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
  createElement,
} from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Clinica, Perfil } from '@/types'

interface AuthState {
  usuario: User | null
  perfil: Perfil | null
  clinica: Clinica | null
  carregando: boolean
}

interface AuthContextValue extends AuthState {
  sair: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<AuthState>({
    usuario: null,
    perfil: null,
    clinica: null,
    carregando: true,
  })

  const carregarPerfil = useCallback(async (userId: string) => {
    const { data: perfil } = await supabase
      .from('perfis')
      .select('*')
      .eq('id', userId)
      .single<Perfil>()

    if (!perfil) {
      setEstado(s => ({ ...s, carregando: false }))
      return
    }

    const { data: clinica } = await supabase
      .from('clinicas')
      .select('*')
      .eq('id', perfil.clinica_id)
      .single<Clinica>()

    setEstado(s => ({
      ...s,
      perfil,
      clinica: clinica ?? null,
      carregando: false,
    }))
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user ?? null
      setEstado(s => ({ ...s, usuario: user }))
      if (user) {
        carregarPerfil(user.id)
      } else {
        setEstado(s => ({ ...s, carregando: false }))
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const user = session?.user ?? null
        setEstado(s => ({ ...s, usuario: user }))
        if (user) {
          carregarPerfil(user.id)
        } else {
          setEstado({ usuario: null, perfil: null, clinica: null, carregando: false })
        }
      },
    )

    return () => subscription.unsubscribe()
  }, [carregarPerfil])

  const sair = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  return createElement(AuthContext.Provider, { value: { ...estado, sair } }, children)
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}
