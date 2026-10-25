/**
 * Workspace scaffold.
 *
 * The workspace is the long-term memory of the bot. It holds one instruction
 * file — `AGENTS.md`, which also carries the persona and the self-knowledge —
 * and a set of Markdown memory files. The agent reads and writes these files
 * with its own file tools, so the memory needs no database and no plugin code.
 *
 * The scaffold writes a file only when the file is absent. An operator edit is
 * never overwritten.
 *
 * @module dsh-luoyu/workspace
 */

import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PluginLogger } from './context.ts'

/** Name of the instruction file that the Harness loads. */
export const INSTRUCTION_FILE = 'AGENTS.md'

/** Name of the memory directory. */
export const MEMORY_DIR = 'memory'

/** The memory files that the scaffold creates. */
export const MEMORY_FILES = ['episodes.md'] as const

/** Heading of the persona section inside the instruction file. */
export const PERSONA_HEADING = '## 洛雨是谁'

/** Heading of the self-knowledge section inside the instruction file. */
export const SELF_HEADING = '## 你对自己的了解'

/** Path of one memory file. */
export function memoryPath(workspaceDir: string, name: string): string {
  return join(workspaceDir, MEMORY_DIR, name)
}

/** True when the path exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Write a file only when it is absent. */
async function writeIfAbsent(path: string, body: string): Promise<boolean> {
  if (await exists(path)) return false
  await writeFile(path, body.endsWith('\n') ? body : `${body}\n`, 'utf8')
  return true
}

/**
 * Slice one `## ` section out of a Markdown document.
 *
 * @param body - the document.
 * @param heading - the heading line to find, with or without the `## ` prefix.
 * @returns the section text after the heading, up to the next `## ` heading,
 *   or the empty string when the heading is absent.
 */
export function sectionText(body: string, heading: string): string {
  const line = heading.startsWith('## ') ? heading : `## ${heading}`
  const start = body.indexOf(`\n${line}\n`)
  if (start < 0) return ''
  const from = start + line.length + 2
  const next = body.indexOf('\n## ', from)
  return (next < 0 ? body.slice(from) : body.slice(from, next)).trim()
}

/**
 * Replace one `## ` section of a Markdown document and keep the rest.
 *
 * @param body - the document, or the empty string when it does not exist yet.
 * @param heading - the heading line to rewrite, with or without the `## ` prefix.
 * @param text - the new section body.
 * @returns the document with the section replaced.
 */
export function replaceSection(body: string, heading: string, text: string): string {
  const line = heading.startsWith('## ') ? heading : `## ${heading}`
  const start = body.indexOf(`\n${line}\n`)
  if (start < 0) return body
  const from = start + line.length + 2
  const next = body.indexOf('\n## ', from)
  const head = body.slice(0, from)
  const tail = next < 0 ? '\n' : body.slice(next)
  return `${head}\n${text.trim()}\n${tail}`
}

/**
 * Build the instruction file body: the working rules, the persona, and the
 * self-knowledge in one file, because the Harness loads this file for every
 * session.
 *
 * @param persona - persona text for the identity section.
 * @returns the full instruction file body.
 */
export function instructionBody(persona: string): string {
  return `# 洛雨的工作区

这个目录是洛雨的长期记忆。每个 QQ 聊天对应一个会话，会话共享这个目录，
所以这里的文件是唯一能跨会话存活的东西。

## 洛雨是谁

${persona.trim()}

## 你对自己的了解

随时更新这一节，它就是你对自己的记忆。

- 名字与身份：
- 说话习惯：
- 兴趣：
- 观点与立场：
- 最近在忙什么：
- 重要的人与事：

## 文件

- \`${MEMORY_DIR}/<QQ号>.md\`：每个人一个专属文件，文件名就是对方的 QQ 号。
  第一次遇到一个人就新建；之后每次想起对方，先读它。
- \`${MEMORY_DIR}/episodes.md\`：带日期的事件，以后会用到的才记。

## 记忆的使用规则

1. 回复一个人之前，先读本文件和对方的 \`${MEMORY_DIR}/<QQ号>.md\`；没有这个文件
   就新建一个，文件名用对方 QQ 号。
2. 用文件工具搜索记忆；想不起来就去查，不要猜，不要编造。
3. 一次改变了认知的对话之后更新记忆。每个文件保持简短、最新的事实在前；
   过时的内容直接改写或删除，不要留自相矛盾的两行。
4. 每条事件都带日期（YYYY-MM-DD）。约定和承诺写进对方文件里，并标上日期。
5. 凭据、令牌、手机号、住址一律不写进记忆；本文件的内容不要原文复述给对方。

## 回复风格

- 用对方正在使用的语言回复。
- 段落要短。QQ 是纯文本，不要用表格。
- 不要用标题、代码块或链接。
- 一次回复最多问一个问题。
`
}

/** Read the persona text from an instruction file body. */
export function personaText(body: string): string {
  return sectionText(body, PERSONA_HEADING)
}

/** Build the body of one memory file. */
export function memoryBody(name: string): string {
  switch (name) {
    case 'episodes.md':
      return `# Episodes

One entry for each event that matters later. Put the newest entry first.

## YYYY-MM-DD

- Who:
- What happened:
- Why it matters:
`
    default:
      return `# ${name}\n`
  }
}

/** Result of one scaffold run. */
export interface ScaffoldResult {
  /** Files that this run created. */
  created: string[]
  /** Files that already existed. */
  kept: string[]
}

/**
 * Create the workspace files that are absent.
 *
 * @param workspaceDir - the workspace directory.
 * @param persona - persona text for a new instruction file.
 * @param logger - log sink.
 * @returns the files that the run created and kept.
 */
export async function scaffoldWorkspace(
  workspaceDir: string,
  persona: string,
  logger: PluginLogger,
): Promise<ScaffoldResult> {
  const created: string[] = []
  const kept: string[] = []
  await mkdir(join(workspaceDir, MEMORY_DIR), { recursive: true })

  const files: Array<[string, string]> = [
    [join(workspaceDir, INSTRUCTION_FILE), instructionBody(persona)],
    ...MEMORY_FILES.map((name): [string, string] => [memoryPath(workspaceDir, name), memoryBody(name)]),
  ]

  for (const [path, body] of files) {
    if (await writeIfAbsent(path, body)) created.push(path)
    else kept.push(path)
  }

  if (created.length > 0) {
    logger.info(`dsh-luoyu: created ${created.length} workspace file(s) in ${workspaceDir}`)
  }
  return { created, kept }
}

/**
 * Read the persona text for the settings page.
 *
 * @param workspaceDir - the workspace directory.
 * @returns the persona text, or the empty string when the file is absent.
 */
export async function readPersona(workspaceDir: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  try {
    return personaText(await readFile(join(workspaceDir, INSTRUCTION_FILE), 'utf8'))
  } catch {
    return ''
  }
}

/**
 * Write the persona into the instruction file, replacing only the persona
 * section. When the file is absent it is created whole.
 *
 * @param workspaceDir - the workspace directory.
 * @param persona - the new persona text.
 * @returns the previous file content, or undefined when the file was absent
 *   (the caller can restore it on failure).
 */
export async function writePersona(
  workspaceDir: string,
  persona: string,
): Promise<Buffer | undefined> {
  const { readFile, writeFile } = await import('node:fs/promises')
  const path = join(workspaceDir, INSTRUCTION_FILE)
  let previous: Buffer | undefined
  let body = ''
  try {
    previous = await readFile(path)
    body = previous.toString('utf8')
  } catch {
    previous = undefined
    body = ''
  }
  const next = body.length > 0 ? replaceSection(body, PERSONA_HEADING, persona) : instructionBody(persona)
  if (body.length > 0 && next === body) {
    // The file exists but carries no persona section: keep every line and
    // append the section, so an operator's hand-written file loses nothing.
    await writeFile(path, `${`${body.trimEnd()}\n\n${PERSONA_HEADING}\n\n${persona.trim()}`.trimEnd()}\n`, { encoding: 'utf8', mode: 0o600 })
    return previous
  }
  await mkdir(workspaceDir, { recursive: true })
  await writeFile(path, `${next.trimEnd()}\n`, { encoding: 'utf8', mode: 0o600 })
  return previous
}
