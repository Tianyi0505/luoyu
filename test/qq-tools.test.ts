/** Tests for the DSH NapCat tools. */

import assert from 'node:assert/strict'
import test from 'node:test'
import type { PluginContext, ToolRegistryService } from '../src/context.ts'
import type { OneBotClient } from '../src/onebot/client.ts'
import type { MessageSegment } from '../src/onebot/types.ts'
import { registerNapCatTools } from '../src/qq-tools.ts'

interface ToolExecution {
  agent?: { session: { id: string } }
  signal: AbortSignal
}

interface TestTool {
  name: string
  execute(args: unknown, exec: ToolExecution): Promise<unknown>
}

function harness() {
  const actions: Array<{ action: string; payload: Record<string, unknown> }> = []
  const staged: Array<{ sessionId: string; segment: MessageSegment }> = []
  let stickerData: unknown = []
  const client = {
    async call(action: string, payload: Record<string, unknown>): Promise<unknown> {
      actions.push({ action, payload })
      switch (action) {
        case 'get_group_member_info':
          return { user_id: 1234, nickname: 'Ada', card: '阿达', title: '群主认证', role: 'admin' }
        case 'get_friend_list':
          return [{ user_id: 1234, nickname: 'Ada', remark: 'Alice' }]
        case 'get_stranger_info':
          return { user_id: 9999, nickname: 'Guest' }
        case 'get_group_info':
          return { group_id: 5678, group_name: '测试群', member_count: 32 }
        case 'fetch_custom_face_detail':
          return stickerData
        default:
          throw new Error(`unexpected action ${action}`)
      }
    },
  }
  const bridge = {
    queueSticker(sessionId: string, segment: MessageSegment): boolean {
      staged.push({ sessionId, segment })
      return true
    },
  }
  const definitions = new Map<string, TestTool>()
  const tools: ToolRegistryService = {
    register(definition) {
      definitions.set(definition.name, definition as TestTool)
      return () => definitions.delete(definition.name)
    },
  }
  const context = { tools } as unknown as PluginContext
  const dispose = registerNapCatTools(
    context,
    client as unknown as OneBotClient,
    bridge as unknown as import('../src/bridge.ts').ChatBridge,
  )
  const execution: ToolExecution = {
    agent: { session: { id: 'session-1' } },
    signal: new AbortController().signal,
  }
  return { actions, staged, definitions, dispose, execution, setStickerData(value: unknown) { stickerData = value } }
}

test('looks up a group member name, card, title, and role by QQ number', async () => {
  const h = harness()
  const result = await h.definitions.get('qq_lookup_user')?.execute({ user_id: '1234', group_id: '5678' }, h.execution)
  assert.deepEqual(result, {
    found: true,
    user_id: '1234',
    nickname: 'Ada',
    remark: '',
    card: '阿达',
    title: '群主认证',
    role: 'admin',
    group_id: '5678',
    source: 'group',
  })
  assert.deepEqual(h.actions, [{ action: 'get_group_member_info', payload: { group_id: 5678, user_id: 1234, no_cache: false } }])
  h.dispose()
})

test('looks up a friend by QQ number', async () => {
  const h = harness()
  const result = await h.definitions.get('qq_lookup_user')?.execute({ user_id: '1234' }, h.execution)
  assert.deepEqual(result, {
    found: true,
    user_id: '1234',
    nickname: 'Ada',
    remark: 'Alice',
    card: '',
    title: '',
    role: '',
    group_id: '',
    source: 'friend',
  })
  assert.deepEqual(h.actions.map(item => item.action), ['get_friend_list'])
  h.dispose()
})

test('looks up group names and member counts', async () => {
  const h = harness()
  const result = await h.definitions.get('qq_lookup_group')?.execute({ group_id: '5678' }, h.execution)
  assert.deepEqual(result, { found: true, group_id: '5678', group_name: '测试群', member_count: 32 })
  h.dispose()
})

test('searches saved stickers and stages one for the active DSH reply', async () => {
  const h = harness()
  h.setStickerData({ emojiInfoList: [
    { emojiId: 'emoji-1', emojiPackageId: 17, key: 'key-1', summary: '开心猫', fileName: 'cat.png' },
    { emojiId: 'emoji-2', emojiPackageId: 18, key: 'key-2', summary: '哭泣', fileName: 'cry.png' },
  ] })
  const search = h.definitions.get('qq_search_stickers')
  const result = await search?.execute({ query: 'cat' }, h.execution)
  assert.deepEqual(result, {
    stickers: [{
      index: 1,
      emoji_id: 'emoji-1',
      emoji_package_id: 17,
      key: 'key-1',
      summary: '开心猫',
      file_name: 'cat.png',
    }],
  })

  const send = h.definitions.get('qq_send_sticker')
  const sent = await send?.execute({
    emoji_id: 'emoji-1', emoji_package_id: 17, key: 'key-1', summary: '开心猫',
  }, h.execution)
  assert.deepEqual(sent, { queued: true, note: '贴图已加入本轮回复。' })
  assert.deepEqual(h.staged, [{
    sessionId: 'session-1',
    segment: { type: 'mface', data: { emoji_id: 'emoji-1', emoji_package_id: 17, key: 'key-1', summary: '开心猫' } },
  }])
  h.dispose()
})

test('refuses a sticker that was not returned by the current session search', async () => {
  const h = harness()
  const send = h.definitions.get('qq_send_sticker')
  const result = await send?.execute({ emoji_id: 'invented', emoji_package_id: 1, key: 'unknown' }, h.execution)
  assert.deepEqual(result, { queued: false, note: '请先搜索贴图，并使用搜索结果中的原始参数。' })
  assert.equal(h.staged.length, 0)
  h.dispose()
})

test('removes every registered tool when disposed', () => {
  const h = harness()
  assert.deepEqual([...h.definitions.keys()].sort(), [
    'qq_lookup_group',
    'qq_lookup_user',
    'qq_search_stickers',
    'qq_send_sticker',
  ])
  h.dispose()
  assert.equal(h.definitions.size, 0)
})
