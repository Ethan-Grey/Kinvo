/**
 * Where the sign-in session is kept on this device.
 *
 * Supabase stores it in localStorage. On iPhone, an app on the Home Screen
 * keeps its own storage, but localStorage can still be lost (e.g. when the
 * phone is low on space, or after an update). So every write is mirrored to
 * IndexedDB too, and if localStorage comes back empty the session is restored
 * from the copy. Both stay on this device only.
 */
import type { SupportedStorage } from '@supabase/supabase-js'

const DB = 'kinvo-auth'
const STORE = 'kv'

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

let dbPromise: Promise<IDBDatabase | null> | null = null
const db = () => (dbPromise ??= openDb())

async function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const database = await db()
  if (!database) return null
  return new Promise((resolve) => {
    try {
      const req = run(database.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function local(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const durableStorage: SupportedStorage = {
  async getItem(key) {
    const fromLocal = local()?.getItem(key) ?? null
    if (fromLocal !== null) return fromLocal
    const copy = await idb<string | undefined>('readonly', (s) => s.get(key) as IDBRequest<string | undefined>)
    if (typeof copy === 'string') {
      try {
        local()?.setItem(key, copy)
      } catch {
        /* full or unavailable: the copy still works */
      }
      return copy
    }
    return null
  },
  async setItem(key, value) {
    try {
      local()?.setItem(key, value)
    } catch {
      /* ignore: IndexedDB below */
    }
    await idb('readwrite', (s) => s.put(value, key))
  },
  async removeItem(key) {
    local()?.removeItem(key)
    await idb('readwrite', (s) => s.delete(key))
  },
}

/** True when running as the app on the Home Screen (not a Safari tab). */
export function isInstalledApp(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
}

const LAST_EMAIL = 'kinvo.lastEmail'
const SIGNED_OUT_ON_PURPOSE = 'kinvo.signedOutOnPurpose'

export function rememberEmail(email: string): void {
  try {
    localStorage.setItem(LAST_EMAIL, email)
  } catch {
    /* private mode */
  }
}

export function lastEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL) ?? ''
  } catch {
    return ''
  }
}

export function markSignedOutOnPurpose(): void {
  try {
    sessionStorage.setItem(SIGNED_OUT_ON_PURPOSE, '1')
  } catch {
    /* ignore */
  }
}

export function takeSignedOutOnPurpose(): boolean {
  try {
    const v = sessionStorage.getItem(SIGNED_OUT_ON_PURPOSE) === '1'
    sessionStorage.removeItem(SIGNED_OUT_ON_PURPOSE)
    return v
  } catch {
    return false
  }
}
