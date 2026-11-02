import { useId, useState } from 'react'
import { cleanImage, setAvatar, uploadAvatar } from '../../data/images'
import { Avatar } from '../../shared/Avatar'
import { Notice, Spinner } from '../../shared/ui'

/**
 * Your photo, with "Add photo" / "Change" / "Remove". The image is cropped to
 * a square and re-encoded as a small, clean JPEG before it's uploaded
 * (data/images.ts), so nothing but the picture leaves the phone.
 */
export function ProfilePhoto({
  userId,
  name,
  photo,
  onChange,
}: {
  userId: string
  name: string
  photo: string | null
  onChange: (path: string | null) => void
}) {
  const inputId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(file: File) {
    setBusy(true)
    setError(null)
    try {
      const jpeg = await cleanImage(file, { maxSide: 512, square: true })
      onChange(await uploadAvatar(userId, jpeg))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await setAvatar(null)
      onChange(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <Avatar name={name || '?'} photo={photo} size="xl" />
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-surface/70">
            <Spinner />
          </span>
        )}
      </div>
      <div className="flex gap-4 text-sm font-medium">
        <label htmlFor={inputId} className="cursor-pointer text-brand-ink underline focus-within:outline-2">
          {photo ? 'Change photo' : 'Add a photo'}
          <input
            id={inputId}
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void choose(file)
            }}
          />
        </label>
        {photo && (
          <button type="button" onClick={remove} disabled={busy} className="text-ink-muted underline">
            Remove
          </button>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}
