/**
 * Returns `next` only if it's a path inside this app, otherwise "/".
 *
 * The sign-in flow carries a `next` parameter through external redirects.
 * Without this check, a crafted link like `?next=//evil.example` could send
 * someone to another site straight after they sign in (an "open redirect").
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return '/'
  if (!next.startsWith('/')) return '/'
  // "//host" and "/\host" are treated by browsers as links to another site.
  if (next.startsWith('//') || next.startsWith('/\\')) return '/'
  return next
}
