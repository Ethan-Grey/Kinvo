import axe from 'axe-core'
import { expect } from 'vitest'

/**
 * Runs axe-core (the engine behind most accessibility checkers) against a
 * rendered component and fails with a readable list of problems.
 *
 * Colour contrast is skipped because jsdom can't compute styles; contrast is
 * checked against the palette in docs/design.md instead. Page-level rules
 * (one <main>, one <h1>, everything in a landmark) are skipped because these
 * tests render single components; AppLayout provides those landmarks.
 */
export async function expectNoAxeViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    rules: {
      'color-contrast': { enabled: false },
      region: { enabled: false },
      'landmark-one-main': { enabled: false },
      'page-has-heading-one': { enabled: false },
    },
  })
  const problems = results.violations.map(
    (v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`,
  )
  expect(problems, problems.join('\n\n')).toEqual([])
}
