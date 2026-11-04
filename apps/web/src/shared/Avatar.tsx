/**
 * People are shown as initials on a colour from the Kinvo palette. The colour
 * comes from the name, so the same person always looks the same everywhere.
 *
 * RingAvatar adds Kinvo's signature element: a ring around the person showing
 * how much of what they owe has been repaid.
 */
import { useEffect, useState } from 'react'
import { avatarUrl } from '../data/images'
import { ProgressRing } from './ProgressRing'

const SWATCHES = [
  'bg-[#1e3a8a] text-white', // Royal Blue
  'bg-[#93b4ff] text-[#0f1a33]', // Sky
  'bg-[#dce6fa] text-[#1e3a8a]', // Pale blue
  'bg-[#b3b6b7] text-[#0f1a33]', // Silver
  'bg-[#0f1a33] text-white dark:ring-1 dark:ring-white/25', // Midnight
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

/** The URL of a profile photo, once downloaded (null while loading or if there's none). */
function usePhoto(path: string | null | undefined): string | null {
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(null)
  useEffect(() => {
    if (!path) return
    let cancelled = false
    avatarUrl(path).then(
      (url) => {
        if (!cancelled) setLoaded({ path, url })
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [path])
  return path && loaded?.path === path ? loaded.url : null
}

/**
 * The person's photo if they've added one, otherwise their initials on a
 * palette colour. Decorative: the name is always shown beside it.
 */
export function Avatar({ name, size = 'md', photo }: { name: string; size?: AvatarSize; photo?: string | null }) {
  const s = SIZES[size]
  const url = usePhoto(photo)
  if (url) {
    return <img src={url} alt="" aria-hidden="true" className={`shrink-0 rounded-full object-cover ${s.box}`} />
  }
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
  photo,
}: {
  name: string
  progress: number | null
  overdue?: boolean
  size?: AvatarSize
  photo?: string | null
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
      <Avatar name={name} size={size} photo={photo} />
    </span>
  )
}
