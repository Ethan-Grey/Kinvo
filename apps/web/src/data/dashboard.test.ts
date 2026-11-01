import { describe, expect, it } from 'vitest'
import { describeTrackRecord } from './dashboard'

describe('describeTrackRecord', () => {
  it('says when nothing has been due yet', () => {
    expect(describeTrackRecord({ instalmentsAssessed: 0, instalmentsOnTime: 0, averageDaysLate: null })).toBe(
      'No payments due yet',
    )
  })

  it('reports a perfect record without a lateness figure', () => {
    expect(describeTrackRecord({ instalmentsAssessed: 4, instalmentsOnTime: 4, averageDaysLate: null })).toBe(
      '4 of 4 payments on time',
    )
  })

  it('reports on-time count and average lateness', () => {
    expect(describeTrackRecord({ instalmentsAssessed: 10, instalmentsOnTime: 8, averageDaysLate: 2.5 })).toBe(
      '8 of 10 payments on time · late ones 2.5 days late on average',
    )
  })

  it('uses singular words for one', () => {
    expect(describeTrackRecord({ instalmentsAssessed: 1, instalmentsOnTime: 0, averageDaysLate: 1 })).toBe(
      '0 of 1 payment on time · late ones 1 day late on average',
    )
  })
})
