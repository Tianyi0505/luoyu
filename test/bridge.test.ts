/**
 * Tests of the chat bridge helpers.
 *
 * @module dsh-luoyu/test/bridge.test
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPrompt, splitReply } from '../src/bridge.ts'

test('keeps a short reply in one part', () => {
  assert.deepEqual(splitReply('hello', 100), ['hello'])
})

test('splits a long reply at the last newline that fits', () => {
  const text = `${'a'.repeat(40)}\n${'b'.repeat(40)}`
  const parts = splitReply(text, 50)
  assert.deepEqual(parts, ['a'.repeat(40), 'b'.repeat(40)])
})

test('splits a long reply without a newline at the limit', () => {
  const parts = splitReply('c'.repeat(120), 50)
  assert.equal(parts.length, 3)
  assert.equal(parts.join('').length, 120)
})

test('splits a Chinese reply at a full stop', () => {
  const sentence = `${'字'.repeat(30)}。`
  const parts = splitReply(sentence.repeat(4), 80)
  assert.ok(parts.length > 1)
  for (const part of parts) assert.ok(part.length <= 80)
})

test('returns one part when the limit is not positive', () => {
  assert.deepEqual(splitReply('hello', 0), ['hello'])
})

test('builds a group prompt with speaker QQ and one-time group context', () => {
  const text = buildPrompt(
    {
      key: 'group:782795932',
      kind: 'group',
      targetId: '782795932',
      title: '782795932',
      messageId: 'm-1',
      senderName: 'Ada',
      senderId: '10001',
      text: 'hello',
      segments: [],
      directlyAddressed: false,
    },
    'Asia/Shanghai',
    Date.UTC(2026, 9, 22, 2, 30),
    true,
  )
  assert.match(text, /\[group chat 782795932 · 2026-10-22 10:30 Asia\/Shanghai\]/)
  assert.match(text, /Ada \(QQ 10001\): hello/)
  assert.match(text, /memory\/people\/10001\.md/)
  assert.equal(text.split('782795932').length - 1, 1)
})

test('omits the group number after the first prompt in a group session', () => {
  const text = buildPrompt(
    {
      key: 'group:782795932',
      kind: 'group',
      targetId: '782795932',
      title: '782795932',
      messageId: 'm-2',
      senderName: 'Ada',
      senderId: '10001',
      text: 'again',
      segments: [],
      directlyAddressed: false,
    },
    'Asia/Shanghai',
    Date.UTC(2026, 9, 22, 2, 31),
    false,
  )
  assert.match(text, /Ada \(QQ 10001\): again/)
  assert.doesNotMatch(text, /782795932/)
})

test('builds a private prompt without QQ source identifiers', () => {
  const text = buildPrompt(
    {
      key: 'private:10001',
      kind: 'private',
      targetId: '10001',
      title: 'Ada',
      messageId: 'm-2',
      senderName: 'Ada',
      senderId: '10001',
      text: 'hi',
      segments: [],
      directlyAddressed: false,
    },
    'Asia/Shanghai',
    Date.UTC(2026, 9, 22, 2, 30),
  )
  assert.match(text, /\[private chat with Ada · 2026-10-22 10:30 Asia\/Shanghai\]/)
  assert.match(text, /Ada: hi/)
  assert.match(text, /memory\/people\/Ada\.md/)
  assert.doesNotMatch(text, /QQ|10001/)
})

test('does not expose a private QQ number when the display name is missing', () => {
  const text = buildPrompt(
    {
      key: 'private:10001',
      kind: 'private',
      targetId: '10001',
      title: '10001',
      messageId: 'm-3',
      senderName: '10001',
      senderId: '10001',
      text: 'hello',
      segments: [],
      directlyAddressed: false,
    },
    'Asia/Shanghai',
    Date.UTC(2026, 9, 22, 2, 30),
  )
  assert.match(text, /private chat with 对方/)
  assert.match(text, /对方: hello/)
  assert.match(text, /memory\/people\/对方\.md/)
  assert.doesNotMatch(text, /10001|QQ/)
})
