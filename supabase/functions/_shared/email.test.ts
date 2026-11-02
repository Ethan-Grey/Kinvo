import assert from 'node:assert/strict'
import { appLink, buildEmail, escapeHtml, hasSharedSecret } from './email.ts'

const APP = 'https://kinvo.example'

Deno.test('uses the notification title as the subject', () => {
  const email = buildEmail(
    { displayName: 'Bob Borrower', title: '$60.00 due to Lena tomorrow', body: 'Tap "I\'ve paid" once paid.', linkPath: '/loans/abc' },
    APP,
  )
  assert.equal(email.subject, '$60.00 due to Lena tomorrow')
})

Deno.test('greets by first name and links to the loan', () => {
  const email = buildEmail({ displayName: 'Bob Borrower', title: 'Hi', body: '', linkPath: '/loans/abc' }, APP)
  assert.ok(email.text.includes('Kia ora Bob,'))
  assert.ok(email.text.includes('Open Kinvo: https://kinvo.example/loans/abc'))
  assert.ok(email.html.includes('href="https://kinvo.example/loans/abc"'))
})

Deno.test('escapes names and text in the HTML', () => {
  const email = buildEmail(
    { displayName: '<b>Eve</b>', title: 'Tom & Jerry <script>', body: 'Note: "hi"', linkPath: '/' },
    APP,
  )
  assert.ok(email.html.includes('Kia ora &lt;b&gt;Eve&lt;/b&gt;,'))
  assert.ok(email.html.includes('Tom &amp; Jerry &lt;script&gt;'))
  assert.equal(email.html.includes('<script>'), false)
})

Deno.test('only links inside the app', () => {
  assert.equal(appLink(APP, '/loans/1'), 'https://kinvo.example/loans/1')
  assert.equal(appLink(APP, '//evil.example'), 'https://kinvo.example/')
  assert.equal(appLink(APP, 'https://evil.example'), 'https://kinvo.example/')
})

Deno.test('escapeHtml handles quotes', () => {
  assert.equal(escapeHtml(`a'b"c`), 'a&#39;b&quot;c')
})

Deno.test('omits the body paragraph when empty', () => {
  const email = buildEmail({ displayName: 'Bob', title: 'Confirmed', body: '', linkPath: '/' }, APP)
  assert.equal(email.text.includes('\n\n\n'), false)
})

Deno.test('hasSharedSecret only accepts the exact bearer secret', () => {
  assert.equal(hasSharedSecret('Bearer s3cret', 's3cret'), true)
  assert.equal(hasSharedSecret('Bearer s3creT', 's3cret'), false)
  assert.equal(hasSharedSecret('Bearer s3cret!', 's3cret'), false)
  assert.equal(hasSharedSecret(null, 's3cret'), false)
  assert.equal(hasSharedSecret('Bearer ', ''), false)
})

Deno.test('explains how to stop the emails', () => {
  const email = buildEmail({ displayName: 'Bob', title: 'Hi', body: '', linkPath: '/' }, APP)
  assert.ok(email.text.includes('https://kinvo.example/account'))
  assert.ok(email.html.includes('href="https://kinvo.example/account"'))
})
