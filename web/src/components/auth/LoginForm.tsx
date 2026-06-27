import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/Input'
import { Botao } from '@/components/ui/Botao'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setCarregando(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })

    setCarregando(false)
    if (error) {
      setErro(
        error.message.includes('Invalid login')
          ? 'E-mail ou senha incorretos.'
          : error.message,
      )
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Input
        label="E-mail"
        type="email"
        autoComplete="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        required
        placeholder="seuemail@clinica.com"
      />
      <Input
        label="Senha"
        type="password"
        autoComplete="current-password"
        value={senha}
        onChange={e => setSenha(e.target.value)}
        required
        placeholder="••••••••"
      />

      {erro && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</p>
      )}

      <Botao
        type="submit"
        variante="primario"
        carregando={carregando}
        className="w-full py-2.5"
      >
        Entrar
      </Botao>
    </form>
  )
}
