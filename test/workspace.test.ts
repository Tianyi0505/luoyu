/**
 * Tests of the workspace scaffold.
 *
 * @module dsh-luoyu/test/workspace.test
 */

import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { PluginLogger } from '../src/context.ts'
import {
  INSTRUCTION_FILE,
  MEMORY_DIR,
  MEMORY_FILES,
  PERSONA_HEADING,
  QQ_SKILL_BODY,
  QQ_SKILL_PATH,
  instructionBody,
  memoryBody,
  memoryPath,
  personaText,
  readPersona,
  replaceSection,
  scaffoldWorkspace,
  sectionText,
  writePersona,
} from '../src/workspace.ts'

const silent: PluginLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

/** Create a temporary directory and remove it after the test. */
async function withTempDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-luoyu-workspace-'))
  try {
    await body(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('creates the instruction file and every memory file', async () => {
  await withTempDir(async dir => {
    const result = await scaffoldWorkspace(dir, 'You are Ada.', silent)
    assert.equal(result.created.length, 2 + MEMORY_FILES.length)
    assert.deepEqual(result.kept, [])

    const instruction = await readFile(join(dir, INSTRUCTION_FILE), 'utf8')
    assert.match(instruction, /长期记忆/)
    assert.match(instruction, /luoyu-qq skill/)
    const skill = await readFile(join(dir, QQ_SKILL_PATH), 'utf8')
    assert.equal(skill, `${QQ_SKILL_BODY}\n`)
    assert.match(skill, /name: luoyu-qq/)
    assert.match(skill, /qq_send_sticker/)
    assert.match(personaText(instruction), /You are Ada\./)
    await access(join(dir, MEMORY_DIR, 'people'))
    await access(join(dir, MEMORY_DIR, 'groups'))
    for (const name of MEMORY_FILES) {
      const body = await readFile(memoryPath(dir, name), 'utf8')
      assert.ok(body.length > 0)
    }
  })
})

test('keeps a file that the operator already edited', async () => {
  await withTempDir(async dir => {
    await scaffoldWorkspace(dir, 'You are Ada.', silent)
    const path = join(dir, INSTRUCTION_FILE)
    await writeFile(path, '# Mine\n', 'utf8')
    const result = await scaffoldWorkspace(dir, 'You are Ada.', silent)
    assert.ok(result.kept.includes(path))
    assert.equal(await readFile(path, 'utf8'), '# Mine\n')
  })
})

test('keeps a QQ skill that the operator already edited', async () => {
  await withTempDir(async dir => {
    await scaffoldWorkspace(dir, 'You are Ada.', silent)
    const path = join(dir, QQ_SKILL_PATH)
    const customSkill = ['---', 'name: luoyu-qq', 'description: Local version', '---', ''].join('\n')
    await writeFile(path, customSkill, 'utf8')
    const result = await scaffoldWorkspace(dir, 'You are Ada.', silent)
    assert.ok(result.kept.includes(path))
    assert.equal(await readFile(path, 'utf8'), customSkill)
  })
})

test('reads the persona back', async () => {
  await withTempDir(async dir => {
    await scaffoldWorkspace(dir, 'You are Ada.', silent)
    assert.match(await readPersona(dir), /You are Ada\./)
  })
})

test('returns the empty persona when the file is absent', async () => {
  await withTempDir(async dir => {
    assert.equal(await readPersona(dir), '')
  })
})

test('the instruction file names every memory file and the per-person layout', () => {
  const body = instructionBody('You are Ada.')
  for (const name of MEMORY_FILES) assert.ok(body.includes(name), `the instruction file must name ${name}`)
  assert.ok(body.includes(MEMORY_DIR))
  assert.ok(body.includes('people/<QQ号>.md'), 'the instruction file must explain group-speaker memory files')
  assert.ok(body.includes('groups/<群号>.md'), 'the instruction file must explain per-group memory files')
  assert.match(body, /亲密度/)
  assert.match(body, /0–100/)
  assert.match(body, /最多调整 3 分/)
  assert.ok(body.includes(PERSONA_HEADING))
  assert.ok(body.includes('你对自己的了解'))
  assert.ok(!body.includes('open-threads'), 'open threads are gone')
  assert.ok(!body.includes('people.md'), 'the people ledger is gone')
})

test('the persona section carries the configured text', () => {
  const body = instructionBody('  You are Ada.  ')
  assert.equal(personaText(body), 'You are Ada.')
})

test('slices and replaces one section without touching the others', () => {
  const body = instructionBody('You are Ada.')
  assert.match(sectionText(body, '你对自己的了解'), /名字与身份/)
  const edited = replaceSection(body, PERSONA_HEADING, 'You are Robin.')
  assert.equal(personaText(edited), 'You are Robin.')
  assert.match(sectionText(edited, '你对自己的了解'), /名字与身份/)
  assert.match(edited, /回复风格/)
})

test('writePersona replaces only the persona section', async () => {
  await withTempDir(async dir => {
    await scaffoldWorkspace(dir, 'You are Ada.', silent)
    const previous = await writePersona(dir, 'You are Robin.')
    assert.ok(previous !== undefined)
    const body = await readFile(join(dir, INSTRUCTION_FILE), 'utf8')
    assert.equal(personaText(body), 'You are Robin.')
    assert.match(body, /名字与身份/)
  })
})

test('writePersona appends the section when the file has none', async () => {
  await withTempDir(async dir => {
    const path = join(dir, INSTRUCTION_FILE)
    await writeFile(path, '# 手写的文件\n\n内容。\n', 'utf8')
    await writePersona(dir, 'You are Robin.')
    const body = await readFile(path, 'utf8')
    assert.match(body, /手写的文件/)
    assert.equal(personaText(body), 'You are Robin.')
  })
})

test('writePersona creates the whole file when it is absent', async () => {
  await withTempDir(async dir => {
    assert.equal(await writePersona(dir, 'You are Robin.'), undefined)
    const body = await readFile(join(dir, INSTRUCTION_FILE), 'utf8')
    assert.equal(personaText(body), 'You are Robin.')
    assert.match(body, /长期记忆/)
  })
})

test('each memory file has its own body', () => {
  const bodies = new Set(MEMORY_FILES.map(name => memoryBody(name)))
  assert.equal(bodies.size, MEMORY_FILES.length)
})

test('an unknown memory file gets a plain heading', () => {
  assert.equal(memoryBody('other.md'), '# other.md\n')
})
