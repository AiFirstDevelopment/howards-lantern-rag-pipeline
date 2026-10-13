import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'sky' | 'danger' | 'ghost'

const variantClasses: Record<Variant, string> = {
  primary: 'bg-brand text-white border-brand-dark',
  sky: 'bg-sky text-white border-sky-dark',
  danger: 'bg-danger text-white border-danger-dark',
  ghost: 'bg-paper text-sky border-line',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

/** Chunky press-down button in the Duolingo mold. */
export default function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  return (
    <button
      className={`inline-flex min-h-12 w-full items-center justify-center rounded-2xl border-b-4 px-6 py-3 text-base font-extrabold uppercase tracking-wide transition-all duration-100 active:translate-y-1 active:border-b-0 ${variantClasses[variant]} ${className}`}
      {...rest}
    />
  )
}
