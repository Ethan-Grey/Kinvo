import type { ReactNode } from 'react'
import { getMyProfile } from '../../data/people'
import { useAsync } from '../../shared/useAsync'
import { NameSetup } from '../account/NameSetup'
import { useAuth } from '../auth/useAuth'

/**
 * Until someone has confirmed their real name, that's the only thing the app
 * shows (it asks once). Everything else appears as normal while the profile
 * loads, so there's no flash for people who've already done it.
 */
export function NameGate({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const [profile, reload] = useAsync(() => getMyProfile(userId), `name:${userId}`)

  if (profile.status === 'success' && !profile.data.name_confirmed) {
    return (
      <main id="main" className="mx-auto max-w-2xl px-4 pb-12">
        <NameSetup profile={profile.data} onDone={reload} />
      </main>
    )
  }
  return <>{children}</>
}
