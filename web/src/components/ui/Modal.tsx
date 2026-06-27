import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface Props {
  aberto: boolean
  aoFechar: () => void
  titulo: string
  children: ReactNode
  largura?: 'sm' | 'md' | 'lg'
}

export function Modal({ aberto, aoFechar, titulo, children, largura = 'md' }: Props) {
  useEffect(() => {
    if (!aberto) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [aberto, aoFechar])

  if (!aberto) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-cinza-900/40 backdrop-blur-sm"
        onClick={aoFechar}
      />

      {/* Dialog */}
      <div
        className={cn(
          'relative z-10 w-full rounded-xl bg-white shadow-card-md',
          largura === 'sm' && 'max-w-sm',
          largura === 'md' && 'max-w-md',
          largura === 'lg' && 'max-w-2xl',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cinza-200 px-6 py-4">
          <h2 className="font-semibold text-cinza-900">{titulo}</h2>
          <button
            onClick={aoFechar}
            className="rounded-md p-1 text-cinza-400 hover:bg-cinza-100 hover:text-cinza-600 transition-colors"
            aria-label="Fechar"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}
