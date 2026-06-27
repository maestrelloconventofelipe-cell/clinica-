import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  erro?: string
}

export const Input = forwardRef<HTMLInputElement, Props>(
  ({ label, erro, className, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-cinza-700">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'w-full rounded-lg border bg-white px-3 py-2 text-sm text-cinza-900',
            'placeholder:text-cinza-400',
            'transition-colors focus:outline-none focus:ring-2 focus:ring-verde-600 focus:border-transparent',
            erro
              ? 'border-red-400 focus:ring-red-400'
              : 'border-cinza-300 hover:border-cinza-400',
            className,
          )}
          {...props}
        />
        {erro && <p className="text-xs text-red-600">{erro}</p>}
      </div>
    )
  },
)
Input.displayName = 'Input'
