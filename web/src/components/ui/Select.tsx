import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  erro?: string
  opcoes: { valor: string; rotulo: string }[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, Props>(
  ({ label, erro, opcoes, placeholder, className, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-cinza-700">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={inputId}
          className={cn(
            'w-full rounded-lg border bg-white px-3 py-2 text-sm text-cinza-900',
            'transition-colors focus:outline-none focus:ring-2 focus:ring-verde-600 focus:border-transparent',
            'appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\'%3E%3Cpath d=\'M4 6l4 4 4-4\' stroke=\'%236B7575\' stroke-width=\'1.5\' fill=\'none\' stroke-linecap=\'round\'/%3E%3C/svg%3E")] bg-no-repeat bg-[right_0.5rem_center] pr-8',
            erro
              ? 'border-red-400 focus:ring-red-400'
              : 'border-cinza-300 hover:border-cinza-400',
            className,
          )}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {opcoes.map(o => (
            <option key={o.valor} value={o.valor}>{o.rotulo}</option>
          ))}
        </select>
        {erro && <p className="text-xs text-red-600">{erro}</p>}
      </div>
    )
  },
)
Select.displayName = 'Select'
