import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './Spinner'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: 'primario' | 'secundario' | 'perigo' | 'fantasma'
  tamanho?: 'sm' | 'md'
  carregando?: boolean
  children: ReactNode
}

const varianteClasses = {
  primario:   'bg-verde-700 text-white hover:bg-verde-600 focus-visible:ring-verde-500 shadow-sm',
  secundario: 'bg-white text-cinza-700 border border-cinza-300 hover:bg-cinza-50 focus-visible:ring-verde-500 shadow-sm',
  perigo:     'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500 shadow-sm',
  fantasma:   'text-cinza-600 hover:bg-cinza-100 focus-visible:ring-verde-500',
}

const tamanhoClasses = {
  sm: 'px-3 py-1.5 text-xs rounded-lg',
  md: 'px-4 py-2 text-sm rounded-lg',
}

export function Botao({
  variante = 'primario',
  tamanho = 'md',
  carregando = false,
  disabled,
  className,
  children,
  ...props
}: Props) {
  return (
    <button
      disabled={disabled || carregando}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        varianteClasses[variante],
        tamanhoClasses[tamanho],
        className,
      )}
      {...props}
    >
      {carregando && <Spinner tamanho="sm" />}
      {children}
    </button>
  )
}
