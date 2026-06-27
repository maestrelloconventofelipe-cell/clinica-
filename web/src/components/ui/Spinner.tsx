import { cn } from '@/lib/cn'

interface Props {
  tamanho?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Spinner({ tamanho = 'md', className }: Props) {
  return (
    <div
      className={cn(
        'animate-spin rounded-full border-2 border-cinza-200 border-t-verde-600',
        tamanho === 'sm' && 'h-4 w-4',
        tamanho === 'md' && 'h-8 w-8',
        tamanho === 'lg' && 'h-12 w-12',
        className,
      )}
    />
  )
}

export function TelaCarregando() {
  return (
    <div className="flex h-screen items-center justify-center bg-cinza-100">
      <Spinner tamanho="lg" />
    </div>
  )
}
