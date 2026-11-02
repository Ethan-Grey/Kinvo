/**
 * People are shown as initials on a colour from the Kinvo palette. The colour
 * comes from the name, so the same person always looks the same everywhere.
 *
 * RingAvatar adds Kinvo's signature element: a ring around the person showing
 * how much of what they owe has been repaid.
 */
import { ProgressRing } from './ProgressRing'

const SWATCHES = [
  'bg-[#97dffc] text-[#2c0735]', // Frozen Lake
  'bg-[#858ae3] text-[#2c0735]', // Soft Periwinkle
  'bg-[#613dc1] text-white', // Violet Twilight
  'bg-[#4e148c] text-white', // Indigo
  'bg-[#2c0735] text-white dark:ring-1 dark:ring-white/20', // Dark Amethyst
]

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZES: Record<AvatarSize, { box: string; text: string; px: number }> = {
  sm: { box: 'size-8', text: 'text-xs', px: 32 },
  md: { box: 'size-10', text: 'text-sm', px: 40 },
  lg: { box: 'size-14', text: 'text-lg', px: 56 },
  xl: { box: 'size-20', text: 'text-2xl', px: 80 },
}

function initialsOf(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
  return initials || '?'
}

/** Stable palette colour for a name. */
function swatchFor(name: string): string {
  let hash = 0
  for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return SWATCHES[hash % SWATCHES.length] ?? 'bg-brand-soft text-on-brand-soft'
}

/** Initials in a circle. Decorative: the name is always shown beside it. */
export function Avatar({ name, size = 'md' }: { name: string; size?: AvatarSize }) {
  const s = SIZES[size]
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full font-display font-semibold ${s.box} ${s.text} ${swatchFor(name)}`}
    >
      {initialsOf(name)}
    </span>
  )
}

/**
 * An avatar inside a repayment ring. `progress` is 0–1 (null hides the ring,
 * e.g. before any money has moved). The ring turns red when something is overdue.
 */
export function RingAvatar({
  name,
  progress,
  overdue = false,
  size = 'md',
}: {
  name: string
  progress: number | null
  overdue?: boolean
  size?: AvatarSize
}) {
  const s = SIZES[size]
  const outer = s.px + 10
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: outer, height: outer }}
    >
      {progress !== null && (
        <ProgressRing
          value={progress}
          size={outer}
          stroke={3}
          tone={overdue ? 'danger' : 'brand'}
          className="absolute inset-0"
        />
      )}
      <Avatar name={name} size={size} />
    </span>
  )
}
