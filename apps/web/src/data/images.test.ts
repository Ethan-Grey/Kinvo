// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { cleanImage, ReceiptError } from './images'

describe('cleanImage', () => {
  it('refuses files that aren’t images', async () => {
    await expect(cleanImage(new Blob(['<svg onload=alert(1)>'], { type: 'text/html' }))).rejects.toBeInstanceOf(
      ReceiptError,
    )
  })

  it('refuses an "image" that can’t be decoded', async () => {
    // jsdom has no image decoder, which stands in for a file that only claims to be a JPEG.
    await expect(cleanImage(new Blob(['MZ not really a jpeg'], { type: 'image/jpeg' }))).rejects.toThrow(
      /couldn’t be opened/,
    )
  })

  it('refuses huge files before decoding them', async () => {
    const big = new Blob([new Uint8Array(26 * 1024 * 1024)], { type: 'image/png' })
    await expect(cleanImage(big)).rejects.toThrow(/too large/)
  })
})
