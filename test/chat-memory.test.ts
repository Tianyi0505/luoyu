import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { dateInZone, millisecondsUntilMidnight, organizeAllChatMemory, recordChatMemory } from '../src/chat-memory.ts'

test('stores group and private messages in separate identity directories and records group members', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'luoyu-chat-memory-'))
  try {
    await recordChatMemory(workspace, { kind: 'group', chatId: 'group-10', senderId: 'qq-20', senderName: 'Alice', text: 'group only', at: Date.parse('2026-10-27T01:00:00Z') }, 'Asia/Shanghai')
    await recordChatMemory(workspace, { kind: 'private', chatId: 'qq-20', senderId: 'qq-20', senderName: 'Alice', text: 'private only', at: Date.parse('2026-10-27T01:00:00Z') }, 'Asia/Shanghai')
    const groupPath = join(workspace, 'memory/chats/groups/group-10/2026-10-27.md')
    const privatePath = join(workspace, 'memory/chats/people/qq-20/2026-10-27.md')
    assert.match(await readFile(groupPath, 'utf8'), /group only/u)
    assert.doesNotMatch(await readFile(groupPath, 'utf8'), /private only/u)
    assert.match(await readFile(privatePath, 'utf8'), /private only/u)
    assert.match(await readFile(join(workspace, 'memory/chats/groups/group-10/members.md'), 'utf8'), /qq-20 Alice/u)
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('archives records older than 15 days and keeps daily files in the rolling window', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'luoyu-chat-roll-'))
  try {
    const root = join(workspace, 'memory/chats/groups/100')
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, '2026-10-01.md'), 'old event\n')
    await writeFile(join(root, '2026-10-13.md'), 'recent event\n')
    await organizeAllChatMemory(workspace, '2026-10-27')
    assert.equal((await readdir(root)).includes('2026-10-01.md'), false)
    assert.equal((await readdir(root)).includes('2026-10-13.md'), true)
    assert.match(await readFile(join(root, '长期记忆.md'), 'utf8'), /old event/u)
    const info = await stat(join(root, '长期记忆.md'))
    assert.ok(info.size < 24_000)
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('uses the configured time zone for day boundaries', () => {
  assert.equal(dateInZone(Date.parse('2026-10-27T16:30:00Z'), 'Asia/Shanghai'), '2026-10-28')
  const now = Date.parse('2026-10-27T15:59:00Z')
  assert.ok(millisecondsUntilMidnight(now, 'Asia/Shanghai') > 59_000)
  assert.ok(millisecondsUntilMidnight(now, 'Asia/Shanghai') < 61_000)
})
