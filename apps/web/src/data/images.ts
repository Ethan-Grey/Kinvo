/**
 * Images people add: receipts for each movement of money, and profile photos
 * (ADR-0016). Both live in private Storage buckets.
 *
 * Every image is redrawn onto a canvas and saved as a fresh JPEG before it
 * leaves the phone. Only the pixels survive: camera details, location and
 * anything else hidden in the original file are dropped, and a file that
 * isn't really an image fails to decode and is refused.
 */
import { toAppError } from './errors'
import { supabase } from './supabase'

const RECEIPTS = 'receipts'
const AVATARS = 'avatars'
/** Big enough to read a statement, small enough to upload quickly. */
const MAX_SIDE = 2000
const MAX_INPUT_BYTES = 25 * 1024 * 1024
const MAX_PIXELS = 50_000_000

export class ReceiptError extends Error {}

/** Decode, check and re-encode an image as a clean JPEG. `square` crops to the centre. */
export async function cleanImage(file: Blob, { maxSide = MAX_SIDE, square = false } = {}): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new ReceiptError('That file isn’t a photo. Choose an image instead.')
  if (file.size > MAX_INPUT_BYTES) throw new ReceiptError('That image is too large. Try a screenshot instead.')

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new ReceiptError('That image couldn’t be opened. Try a different one.')
  }
  try {
    if (bitmap.width * bitmap.height > MAX_PIXELS || bitmap.width < 16 || bitmap.height < 16) {
      throw new ReceiptError('That image is an unusual size. Try a screenshot instead.')
    }
    const side = Math.min(bitmap.width, bitmap.height)
    const source = square
      ? { x: (bitmap.width - side) / 2, y: (bitmap.height - side) / 2, w: side, h: side }
      : { x: 0, y: 0, w: bitmap.width, h: bitmap.height }
    const scale = Math.min(1, maxSide / Math.max(source.w, source.h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(source.w * scale)
    canvas.height = Math.round(source.h * scale)
    const context = canvas.getContext('2d')
    if (!context) throw new ReceiptError('This device couldn’t process the image.')
    // White behind transparent screenshots, so text stays readable as JPEG.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, source.x, source.y, source.w, source.h, 0, 0, canvas.width, canvas.height)
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!jpeg) throw new ReceiptError('This device couldn’t process the image.')
    return jpeg
  } finally {
    bitmap.close()
  }
}

/** Uploads a cleaned receipt into the loan's folder and returns its path. */
export async function uploadReceipt(loanId: string, jpeg: Blob): Promise<string> {
  const path = `${loanId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase().storage.from(RECEIPTS).upload(path, jpeg, {
    contentType: 'image/jpeg',
    upsert: false,
    cacheControl: '31536000',
  })
  if (error) throw toAppError({ message: error.message })
  return path
}

/** Downloads a receipt for viewing. The caller revokes the URL when done. */
export async function receiptObjectUrl(path: string): Promise<string> {
  const { data, error } = await supabase().storage.from(RECEIPTS).download(path)
  if (error) throw toAppError({ message: error.message })
  return URL.createObjectURL(data)
}

/** The first image on the clipboard, if any (needs a tap, e.g. a Paste button). */
export async function imageFromClipboard(): Promise<Blob | null> {
  if (!navigator.clipboard?.read) return null
  const items = await navigator.clipboard.read()
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'))
    if (type) return item.getType(type)
  }
  return null
}

/** Uploads a cleaned profile photo into your own folder and starts using it. */
export async function uploadAvatar(userId: string, jpeg: Blob): Promise<string> {
  const path = `${userId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase().storage.from(AVATARS).upload(path, jpeg, {
    contentType: 'image/jpeg',
    upsert: false,
    cacheControl: '31536000',
  })
  if (error) throw toAppError({ message: error.message })
  await setAvatar(path)
  return path
}

export async function setAvatar(path: string | null): Promise<void> {
  const { error } = await supabase().rpc('set_avatar', { p_path: path })
  if (error) throw toAppError(error)
}

// Photos never change once uploaded (a new photo gets a new path), so each
// is downloaded once per session.
const avatarCache = new Map<string, Promise<string>>()

/** A viewable URL for a profile photo. */
export function avatarUrl(path: string): Promise<string> {
  let url = avatarCache.get(path)
  if (!url) {
    url = supabase()
      .storage.from(AVATARS)
      .download(path)
      .then(({ data, error }) => {
        if (error) throw error
        return URL.createObjectURL(data)
      })
    url.catch(() => avatarCache.delete(path))
    avatarCache.set(path, url)
  }
  return url
}
