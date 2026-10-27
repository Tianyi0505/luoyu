import { appendFile, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const KEEP_DAYS = 15
const LONG_TERM_MAX_CHARS = 24_000

export interface ChatMemoryRecord {
  kind: 'group' | 'private'
  chatId: string
  senderId: string
  senderName: string
  text: string
  at: number
}

export function dateInZone(at: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at))
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function safeId(id: string): string {
  return id.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 100) || 'unknown'
}

function chatDir(workspace: string, kind: ChatMemoryRecord['kind'], id: string): string {
  return join(workspace, 'memory', 'chats', kind === 'group' ? 'groups' : 'people', safeId(id))
}

/** Persist a message in exactly one group or private-chat directory. */
export async function recordChatMemory(workspace: string, record: ChatMemoryRecord, timeZone: string): Promise<void> {
  const dir = chatDir(workspace, record.kind, record.chatId)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const day = dateInZone(record.at, timeZone)
  const who = `${record.senderName} (QQ ${record.senderId})`
  const line = `- ${new Date(record.at).toISOString()} ${who}: ${record.text.replace(/[\r\n]+/g, ' ').trim()}\n`
  await appendFile(join(dir, `${day}.md`), line, { encoding: 'utf8', mode: 0o600 })
  if (record.kind === 'group') {
    const key = safeId(record.senderId)
    const personDir = chatDir(workspace, 'private', record.senderId)
    await mkdir(personDir, { recursive: true, mode: 0o700 })
    await appendFile(join(personDir, `${day}.md`), `- ${new Date(record.at).toISOString()} （来自群聊 ${safeId(record.chatId)}）${who}: ${record.text.replace(/[\r\n]+/g, ' ').trim()}\n`, { encoding: 'utf8', mode: 0o600 })
    const memberFile = join(dir, 'members.md')
    const previous = await readFile(memberFile, 'utf8').catch(() => '# 互动成员\n')
    if (!previous.includes(`- ${key} `)) {
      await writeFile(memberFile, `${previous}- ${key} ${record.senderName.replace(/[\r\n]+/g, ' ')} → ../../people/${key}\n`, { encoding: 'utf8', mode: 0o600 })
    }
  }
}

/** Archive daily files outside the rolling 15-day window into bounded long-term memory. */
export async function organizeChatMemory(workspace: string, kind: ChatMemoryRecord['kind'], id: string, today: string): Promise<void> {
  const dir = chatDir(workspace, kind, id)
  const names = await readdir(dir).catch(() => [] as string[])
  const cutoff = Date.parse(`${today}T00:00:00.000Z`) - (KEEP_DAYS - 1) * 86_400_000
  const expired = names.filter(name => /^\d{4}-\d{2}-\d{2}\.md$/u.test(name)
    && Date.parse(`${name.slice(0, 10)}T00:00:00.000Z`) < cutoff).sort()
  if (expired.length === 0) return
  const longTermPath = join(dir, '长期记忆.md')
  let longTerm = await readFile(longTermPath, 'utf8').catch(() => '# 长期记忆\n\n')
  for (const name of expired) {
    const path = join(dir, name)
    const content = await readFile(path, 'utf8')
    longTerm += `\n## ${name.slice(0, 10)}\n${content.trim()}\n`
    await rename(path, `${path}.archiving`)
    await writeFile(longTermPath, boundLongTerm(longTerm), { encoding: 'utf8', mode: 0o600 })
    await unlink(`${path}.archiving`)
  }
}

function boundLongTerm(text: string): string {
  if (text.length <= LONG_TERM_MAX_CHARS) return text
  const header = '# 长期记忆\n\n（内容按容量上限滚动保留；更早的记录已淘汰）\n\n'
  return header + text.slice(-(LONG_TERM_MAX_CHARS - header.length))
}

/** Return the delay to the next local midnight in the configured time zone. */
export function millisecondsUntilMidnight(now: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now))
  const values = Object.fromEntries(parts.map(part => [part.type, Number(part.value)]))
  const seconds = (values.hour ?? 0) * 3600 + (values.minute ?? 0) * 60 + (values.second ?? 0)
  return (86_400 - seconds) * 1000 - (now % 1000)
}

export async function organizeAllChatMemory(workspace: string, today: string): Promise<void> {
  for (const [kind, category] of [['group', 'groups'], ['private', 'people']] as const) {
    const root = join(workspace, 'memory', 'chats', category)
    const ids = await readdir(root).catch(() => [] as string[])
    await Promise.all(ids.map(id => organizeChatMemory(workspace, kind, id, today)))
  }
}

export const LONG_TERM_MEMORY_MAX_CHARS = LONG_TERM_MAX_CHARS
export const DAILY_MEMORY_RETENTION_DAYS = KEEP_DAYS
