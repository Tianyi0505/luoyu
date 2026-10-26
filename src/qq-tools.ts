/**
 * 为 DSH 会话注册 NapCat 查询和贴图工具。
 *
 * @module dsh-luoyu/qq-tools
 */

import type { AgentLike, PluginContext, ToolRegistryService } from './context.ts'
import type { ChatBridge } from './bridge.ts'
import type { OneBotClient } from './onebot/client.ts'

interface ToolExecution {
  agent?: AgentLike
  signal: AbortSignal
}

interface Parameter {
  type: 'string' | 'number'
  description: string
}

interface ToolOutput {
  schema: Record<string, unknown>
  render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }>
}

interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: ToolOutput
  execute(args: unknown, exec: ToolExecution): Promise<unknown>
}

function definition(
  name: string,
  description: string,
  properties: Record<string, Parameter>,
  required: string[],
  outputSchema: Record<string, unknown>,
  execute: ToolDefinition['execute'],
): ToolDefinition {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) ?? 'null' }],
    },
    execute,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

function field(record: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    const value = record[name]
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function requireDigits(value: unknown, label: string): string {
  const text = asText(value).trim()
  if (!/^\d+$/.test(text)) throw new Error(`${label} 必须是数字。`)
  return text
}

function argsObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('工具参数必须是对象。')
  }
  return value as Record<string, unknown>
}

const userResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    found: { type: 'boolean' },
    user_id: { type: 'string' },
    nickname: { type: 'string' },
    remark: { type: 'string' },
    card: { type: 'string' },
    title: { type: 'string' },
    role: { type: 'string' },
    group_id: { type: 'string' },
    source: { type: 'string' },
  },
  required: ['found', 'user_id', 'nickname', 'remark', 'card', 'title', 'role', 'group_id', 'source'],
}

const groupResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    found: { type: 'boolean' },
    group_id: { type: 'string' },
    group_name: { type: 'string' },
    member_count: { type: 'number' },
  },
  required: ['found', 'group_id', 'group_name', 'member_count'],
}

const stickerResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stickers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'number' },
          emoji_id: { type: 'string' },
          emoji_package_id: { type: 'number' },
          key: { type: 'string' },
          summary: { type: 'string' },
          file_name: { type: 'string' },
        },
        required: ['index', 'emoji_id', 'emoji_package_id', 'key', 'summary', 'file_name'],
      },
    },
  },
  required: ['stickers'],
}

const sendResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    queued: { type: 'boolean' },
    note: { type: 'string' },
  },
  required: ['queued', 'note'],
}

/** Register NapCat tools and return one disposer for all registrations. */
export function registerNapCatTools(
  ctx: PluginContext,
  client: OneBotClient,
  bridge: ChatBridge,
): () => void {
  const tools = ctx.tools ?? ctx.get('tools') as ToolRegistryService | undefined
  if (tools === undefined) throw new Error('dsh-luoyu 需要 Harness tools 服务。')

  const registrations: Array<() => void> = []
  const searchedStickers = new Map<string, Map<string, string>>()
  const stickerIdentity = (emojiId: string, packageId: number, key: string): string =>
    JSON.stringify([emojiId, packageId, key])
  const register = (tool: ToolDefinition): void => {
    registrations.push(tools.register(tool))
  }

  register(definition(
    'qq_lookup_user',
    '按 QQ 号查询昵称。可指定群号以查询群名片、群头衔和身份。',
    {
      user_id: { type: 'string', description: '要查询的 QQ 号。' },
      group_id: { type: 'string', description: '可选。群号；提供后查询该用户在群内的名片和头衔。' },
    },
    ['user_id'],
    userResultSchema,
    async (rawArgs, exec) => {
      const args = argsObject(rawArgs)
      const userId = requireDigits(args.user_id, 'QQ 号')
      const groupId = args.group_id === undefined || asText(args.group_id).trim().length === 0
        ? undefined
        : requireDigits(args.group_id, '群号')
      if (groupId !== undefined) {
        const memberValue = await client.call<unknown>('get_group_member_info', {
          group_id: Number(groupId),
          user_id: Number(userId),
          no_cache: false,
        }, exec.signal)
        const member = asRecord(memberValue)
        const found = Object.keys(member).length > 0
        return {
          found,
          user_id: userId,
          nickname: asText(field(member, 'nickname')),
          remark: '',
          card: asText(field(member, 'card')),
          title: asText(field(member, 'title')),
          role: asText(field(member, 'role')),
          group_id: groupId,
          source: 'group',
        }
      }

      const friendValue = await client.call<unknown>('get_friend_list', {}, exec.signal)
      const friends = Array.isArray(friendValue) ? friendValue.map(asRecord) : []
      const friend = friends.find(item => asText(field(item, 'user_id', 'userId')) === userId)
      if (friend !== undefined) {
        return {
          found: true,
          user_id: userId,
          nickname: asText(field(friend, 'nickname')),
          remark: asText(field(friend, 'remark')),
          card: '',
          title: '',
          role: '',
          group_id: '',
          source: 'friend',
        }
      }

      const strangerValue = await client.call<unknown>('get_stranger_info', {
        user_id: Number(userId),
        no_cache: false,
      }, exec.signal)
      const stranger = asRecord(strangerValue)
      return {
        found: Object.keys(stranger).length > 0,
        user_id: userId,
        nickname: asText(field(stranger, 'nickname')),
        remark: '',
        card: '',
        title: '',
        role: '',
        group_id: '',
        source: 'stranger',
      }
    },
  ))

  register(definition(
    'qq_lookup_group',
    '按群号查询群名和成员数。',
    { group_id: { type: 'string', description: '要查询的 QQ 群号。' } },
    ['group_id'],
    groupResultSchema,
    async (rawArgs, exec) => {
      const groupId = requireDigits(argsObject(rawArgs).group_id, '群号')
      const groupValue = await client.call<unknown>('get_group_info', {
        group_id: Number(groupId),
        no_cache: false,
      }, exec.signal)
      const group = asRecord(groupValue)
      return {
        found: Object.keys(group).length > 0,
        group_id: groupId,
        group_name: asText(field(group, 'group_name', 'groupName')),
        member_count: Number(field(group, 'member_count', 'memberCount') ?? 0),
      }
    },
  ))

  register(definition(
    'qq_search_stickers',
    '搜索 QQ 账号已收藏的贴图。查询结果可直接用于 qq_send_sticker。',
    {
      query: { type: 'string', description: '可选。按描述或文件名筛选；留空时列出近期贴图。' },
      limit: { type: 'number', description: '可选。返回数量，范围 1 到 30，默认 20。' },
    },
    [],
    stickerResultSchema,
    async (rawArgs, exec) => {
      const args = argsObject(rawArgs)
      const sessionId = exec.agent?.session.id
      if (sessionId === undefined) throw new Error('无法确认当前 DSH 会话。')
      const query = asText(args.query).trim().toLocaleLowerCase()
      const requestedLimit = Number(args.limit ?? 20)
      const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(30, Math.floor(requestedLimit))) : 20
      const response = await client.call<unknown>('fetch_custom_face_detail', { count: 48 }, exec.signal)
      const responseRecord = asRecord(response)
      const items = Array.isArray(response)
        ? response
        : Array.isArray(responseRecord.emojiInfoList)
          ? responseRecord.emojiInfoList
          : Array.isArray(responseRecord.data)
            ? responseRecord.data
            : []
      const stickers = items.flatMap((value, position) => {
        const item = asRecord(value)
        const emojiId = asText(field(item, 'emoji_id', 'emojiId'))
        const packageId = Number(field(item, 'emoji_package_id', 'emojiPackageId', 'package_id', 'packageId'))
        const key = asText(field(item, 'key'))
        if (emojiId.length === 0 || key.length === 0 || !Number.isFinite(packageId)) return []
        const summary = asText(field(item, 'summary', 'desc', 'description', 'name'))
        const fileName = asText(field(item, 'file_name', 'fileName'))
        if (query.length > 0 && !`${summary} ${fileName}`.toLocaleLowerCase().includes(query)) return []
        return [{
          index: position + 1,
          emoji_id: emojiId,
          emoji_package_id: packageId,
          key,
          summary,
          file_name: fileName,
        }]
      }).slice(0, limit)
      searchedStickers.set(sessionId, new Map(stickers.map(sticker => [
        stickerIdentity(sticker.emoji_id, sticker.emoji_package_id, sticker.key),
        sticker.summary,
      ])))
      while (searchedStickers.size > 100) {
        const oldest = searchedStickers.keys().next().value
        if (oldest === undefined) break
        searchedStickers.delete(oldest)
      }
      return { stickers }
    },
  ))

  register(definition(
    'qq_send_sticker',
    '把 qq_search_stickers 返回的一张贴图加入当前回复。工具不会切换聊天对象。',
    {
      emoji_id: { type: 'string', description: '贴图结果中的 emoji_id。' },
      emoji_package_id: { type: 'number', description: '贴图结果中的 emoji_package_id。' },
      key: { type: 'string', description: '贴图结果中的 key。' },
    },
    ['emoji_id', 'emoji_package_id', 'key'],
    sendResultSchema,
    async (rawArgs, exec) => {
      const args = argsObject(rawArgs)
      const sessionId = exec.agent?.session.id
      if (sessionId === undefined) return { queued: false, note: '无法确认当前 DSH 会话。' }
      const emojiId = asText(args.emoji_id)
      const packageId = Number(args.emoji_package_id)
      const key = asText(args.key)
      const identity = stickerIdentity(emojiId, packageId, key)
      const summary = searchedStickers.get(sessionId)?.get(identity)
      if (!Number.isFinite(packageId) || summary === undefined) {
        return { queued: false, note: '请先搜索贴图，并使用搜索结果中的原始参数。' }
      }
      const queued = bridge.queueSticker(sessionId, {
        type: 'mface',
        data: {
          emoji_id: emojiId,
          emoji_package_id: packageId,
          key,
          summary,
        },
      })
      return queued
        ? { queued: true, note: '贴图已加入本轮回复。' }
        : { queued: false, note: '当前会话没有可用的回复，贴图未发送。' }
    },
  ))

  return () => {
    for (const dispose of registrations.reverse()) dispose()
  }
}

/** Register the tool set inside the plugin's lifecycle scope. */
export function installNapCatTools(
  ctx: PluginContext,
  client: OneBotClient,
  bridge: ChatBridge,
): void {
  ctx.effect(() => registerNapCatTools(ctx, client, bridge), 'dsh-luoyu NapCat tools')
}
