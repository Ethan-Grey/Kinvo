import { describe, expect, it } from 'vitest'
import { allocatePayments } from './allocation'
import { toCents } from './money'

const inst = (sequence: number, amount: number) => ({ sequence, amountCents: toCents(amount) })
const pay = (id: string, amount: number, receivedOn: string) => ({
  id,
  amountCents: toCents(amount),
  receivedOn,
  createdAt: `${receivedOn}T00:00:00Z`,
})
const summary = (map: ReturnType<typeof allocatePayments>) =>
  Object.fromEntries([...map].map(([seq, list]) => [seq, list.map((a) => `${a.payment.id}:${a.appliedCents}`)]))

describe('allocatePayments', () => {
  it('fills instalments oldest first, in the order payments were received', () => {
    const map = allocatePayments(
      [inst(1, 15000), inst(2, 15000)],
      [pay('b', 15000, '2026-11-09'), pay('a', 15000, '2026-11-02')],
    )
    expect(summary(map)).toEqual({ 1: ['a:15000'], 2: ['b:15000'] })
  })

  it('splits a payment across instalments and part-pays the next', () => {
    const map = allocatePayments([inst(1, 10000), inst(2, 10000), inst(3, 10000)], [pay('a', 25000, '2026-11-02')])
    expect(summary(map)).toEqual({ 1: ['a:10000'], 2: ['a:10000'], 3: ['a:5000'] })
  })

  it('collects several small payments under one instalment', () => {
    const map = allocatePayments(
      [inst(1, 30000), inst(2, 30000)],
      [pay('a', 10000, '2026-11-01'), pay('b', 10000, '2026-11-02'), pay('c', 15000, '2026-11-03')],
    )
    expect(summary(map)).toEqual({ 1: ['a:10000', 'b:10000', 'c:10000'], 2: ['c:5000'] })
  })

  it('leaves unpaid instalments empty', () => {
    expect(summary(allocatePayments([inst(1, 5000), inst(2, 5000)], []))).toEqual({ 1: [], 2: [] })
  })
})
