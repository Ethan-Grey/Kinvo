import assert from 'node:assert/strict'
import { buildPushPayload, isGone } from './push.ts'

const APP = 'https://kinvo.example'

Deno.test('a push carries the title, text, in-app link and badge', () => {
  const payload = buildPushPayload({ id: 'n1', title: 'Bob asked to borrow $50.00', body: 'Open Kinvo to reply.', linkPath: '/loans/abc', unread: 3 }, APP)
  assert.deepEqual(payload, {
    tag: 'n1',
    title: 'Bob asked to borrow $50.00',
    body: 'Open Kinvo to reply.',
    url: 'https://kinvo.example/loans/abc',
    badge: 3,
  })
})

Deno.test('links can only point inside the app', () => {
  assert.equal(buildPushPayload({ id: 'n', title: 't', body: '', linkPath: '//evil.example', unread: 0 }, APP).url, 'https://kinvo.example/')
})

Deno.test('long text is trimmed to fit a push', () => {
  const payload = buildPushPayload({ id: 'n', title: 't', body: 'x'.repeat(1000), linkPath: '/', unread: 500 }, APP)
  assert.equal(payload.body.length, 300)
  assert.equal(payload.badge, 99)
})

Deno.test('only 404 and 410 mean the device is gone', () => {
  assert.equal(isGone(410), true)
  assert.equal(isGone(404), true)
  assert.equal(isGone(500), false)
  assert.equal(isGone(undefined), false)
})
