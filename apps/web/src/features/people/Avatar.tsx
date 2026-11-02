/** Initials in a circle. Decorative: the name is always shown beside it. */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
  return (
    <span
      aria-hidden="true"
      className={
        'flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-ink ' +
        (size === 'lg' ? 'size-14 text-lg' : 'size-9 text-sm')
      }
    >
      {initials || '?'}
    </span>
  )
}
