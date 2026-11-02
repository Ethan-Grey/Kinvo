// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RefreshContext } from './refresh'
import { useAsync } from './useAsync'

function Probe({ load }: { load: () => Promise<string> }) {
  const [state] = useAsync(load)
  return <p>{state.status === 'success' ? state.data : state.status}</p>
}

/** Renders Probe under a refresh provider and exposes a button to refresh. */
function Harness({ load }: { load: () => Promise<string> }) {
  const [generation, setGeneration] = useState(0)
  return (
    <RefreshContext.Provider value={{ generation, refresh: () => setGeneration((g) => g + 1) }}>
      <button onClick={() => setGeneration((g) => g + 1)}>refresh</button>
      <Probe load={load} />
    </RefreshContext.Provider>
  )
}

describe('useAsync with live refresh', () => {
  afterEach(cleanup)

  it('fetches again on refresh and updates in place, without a loading flash', async () => {
    let resolveSecond: (value: string) => void = () => {}
    const load = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('first')
      .mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)))
    render(<Harness load={load} />)
    expect(await screen.findByText('first')).toBeTruthy()

    act(() => screen.getByText('refresh').click())
    expect(load).toHaveBeenCalledTimes(2)
    expect(screen.getByText('first')).toBeTruthy() // still showing the old data

    await act(async () => resolveSecond('second'))
    expect(screen.getByText('second')).toBeTruthy()
  })

  it('keeps the current data if a background refresh fails', async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce('first').mockRejectedValueOnce(new Error('offline'))
    render(<Harness load={load} />)
    expect(await screen.findByText('first')).toBeTruthy()
    await act(async () => screen.getByText('refresh').click())
    expect(screen.getByText('first')).toBeTruthy()
  })
})
