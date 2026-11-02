import { useEffect, useState } from 'react'

const TONES = {
  brand: 'stroke-brand-ink',
  danger: 'stroke-danger',
  positive: 'stroke-positive',
  'on-brand': 'stroke-white',
} as const

/**
 * A circular progress ring. It fills from empty on first render, which is the
 * one piece of motion that plays without the user doing anything: it shows
 * repayment as something that grows. Reduced-motion users see it filled.
 */
export function ProgressRing({
  value,
  size,
  stroke = 4,
  tone = 'brand',
  track = 'stroke-ring-track',
  className = '',
}: {
  /** 0 to 1. */
  value: number
  size: number
  stroke?: number
  tone?: keyof typeof TONES
  track?: string
  className?: string
}) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const [shown, setShown] = useState(0)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(clamped))
    return () => cancelAnimationFrame(frame)
  }, [clamped])

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`-rotate-90 ${className}`}
    >
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className={track} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - shown)}
        className={`${TONES[tone]} transition-[stroke-dashoffset] duration-700 ease-out ${shown === 0 ? 'opacity-0' : ''}`}
      />
    </svg>
  )
}
