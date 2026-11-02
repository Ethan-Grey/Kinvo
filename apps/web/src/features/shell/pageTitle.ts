/** Names each screen in the browser tab and for screen readers (WCAG 2.4.2). */
export function pageTitle(pathname: string): string {
  const sections: [prefix: string, title: string][] = [
    ['/loans/new', 'New loan'],
    ['/loans/', 'Loan'],
    ['/loans', 'Loans'],
    ['/people/', 'Person'],
    ['/people', 'People'],
    ['/notifications', 'Alerts'],
    ['/account', 'Account'],
    ['/invite/', 'Invite'],
  ]
  const match = sections.find(([prefix]) => pathname.startsWith(prefix))
  return `${match ? match[1] : 'Home'} · Kinvo`
}
