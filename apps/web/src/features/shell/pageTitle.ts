/** Steps inside a loan, matched by how the path ends (e.g. /loans/abc/pay). */
const LOAN_STEPS: [suffix: string, title: string][] = [
  ['/accept', 'Accept'],
  ['/change', 'Suggest changes'],
  ['/sent', 'Money sent'],
  ['/pay', 'Record a payment'],
  ['/remove', 'Remove'],
  ['/schedule', 'Change dates'],
]

const SECTIONS: [prefix: string, title: string][] = [
  ['/loans/new', 'Add what’s owed'],
  ['/loans/', 'Details'],
  ['/loans', 'Owed'],
  ['/people/', 'Person'],
  ['/people', 'People'],
  ['/bills/new', 'Split a bill'],
  ['/spend', 'Add spending'],
  ['/households', 'Household'],
  ['/household-invite/', 'Join a household'],
  ['/repeating/new', 'Repeating'],
  ['/repeating/', 'Repeating'],
  ['/notifications', 'Alerts'],
  ['/account', 'Account'],
  ['/invite/', 'Invite'],
]

/** Names each screen in the browser tab and for screen readers (WCAG 2.4.2). */
export function pageTitle(pathname: string): string {
  const step = pathname.startsWith('/loans/') ? LOAN_STEPS.find(([suffix]) => pathname.endsWith(suffix)) : undefined
  if (!step && pathname.startsWith('/people/') && pathname.endsWith('/reminders')) return 'Reminders · Kinvo'
  const match = step ?? SECTIONS.find(([prefix]) => pathname.startsWith(prefix))
  return `${match ? match[1] : 'Home'} · Kinvo`
}
