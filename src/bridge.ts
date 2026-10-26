/**
 * Chat bridge.
 *
 * The bridge turns one QQ message into one Harness session turn and turns the
 * session answer back into one QQ reply. Each chat keeps one session, so the
 * model sees the history of that chat and nothing else. The workspace holds
 * the memory that every session shares.
 *
 * Messages of one chat run in order. Messages of different chats run in
 * parallel.
 *
 * @module dsh-luoyu/bridge
 */

import { randomUUID } from 'node:crypto'
import type {
  AgentLike,
  PluginContext,
  PluginLogger,
  SessionControllerService,
  SessionEventLike,
  SessionLike,
} from './context.ts'
import { optionalService, requireService } from './context.ts'
import type { GroupReplyMode } from './config.ts'
import { GROUP_ACTIVITY_WINDOW_MS, GroupReplyGate, rememberSentMessage, sentMessageId } from './group-rate.ts'
import type { OneBotClient } from './onebot/client.ts'
import { buildOutbound, renderInbound, toPlainChatText } from './onebot/render.ts'
import { segmentsOf, type MessageEvent, type MessageSegment } from './onebot/types.ts'
import { chatKey, markSeen, recordChat, type BridgeState, type StateStore } from './state.ts'

/** The facts that the bridge needs from the configuration. */
export interface BridgeOptions {
  /** Workspace directory that holds the memory and the sessions. */
  workspaceDir: string
  /** Answer private messages. */
  privateReply: boolean
  /** Which group messages the bridge answers. */
  groupReply: GroupReplyMode
  /** Clock used to apply the group reply cadence. */
  now?: () => number
  /** Permission preset for each chat session. */
  permissionPreset: string
  /** IANA time zone for each prompt. */
  timeZone: string
  /** Largest reply, in characters. */
  maxReplyChars: number
  /** Time limit for one turn, in milliseconds. */
  turnTimeoutMs: number
  /** QQ number of the account. */
  uin: string
}

/** One inbound message that the bridge accepted. */
interface InboundJob {
  key: string
  kind: 'private' | 'group'
  targetId: string
  title: string
  messageId: string
  senderName: string
  senderId: string
  text: string
  segments: readonly MessageSegment[]
  directlyAddressed: boolean
  groupReservationAt?: number
}

/** One reply that the bridge collected from a turn. */
interface TurnBuffer {
  turn: number
  text: string
}

/** A passive group message retained for the next eligible decision turn. */
interface PendingGroupMessage {
  job: InboundJob
  receivedAt: number
}

/** Largest number of queued messages per chat. */
const MAX_QUEUE_PER_CHAT = 20

/** Format one instant in the configured zone. */
function formatTime(epochMs: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(epochMs))
  } catch {
    return new Date(epochMs).toISOString().slice(0, 16).replace('T', ' ')
  }
}

/** Read the text of one assistant message payload. */
function assistantText(data: unknown): string {
  if (data === null || typeof data !== 'object') return ''
  const message = (data as { message?: unknown }).message
  if (message === null || typeof message !== 'object') return ''
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const typed = block as { type?: string; text?: string }
    if (typed.type === 'text' && typeof typed.text === 'string') parts.push(typed.text)
  }
  return parts.join('')
}

/** Parse the explicit reply decision for a passive group turn. */
export function parseGroupReplyDecision(text: string): { kind: 'reply'; text: string } | { kind: 'silent' } | { kind: 'invalid' } {
  try {
    const parsed: unknown = JSON.parse(text.trim())
    if (parsed === null || typeof parsed !== 'object') return { kind: 'invalid' }
    const decision = parsed as { should_reply?: unknown; reply?: unknown }
    if (typeof decision.should_reply !== 'boolean' || typeof decision.reply !== 'string') return { kind: 'invalid' }
    if (!decision.should_reply) return { kind: 'silent' }
    return { kind: 'reply', text: decision.reply.trim() }
  } catch {
    return { kind: 'invalid' }
  }
}

/** Split one long reply into parts that fit the platform limit. */
export function splitReply(text: string, limit: number): string[] {
  if (limit <= 0 || text.length <= limit) return [text]
  const parts: string[] = []
  let rest = text
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit)
    if (cut < Math.floor(limit * 0.5)) cut = rest.lastIndexOf('。', limit)
    if (cut < Math.floor(limit * 0.5)) cut = rest.lastIndexOf('. ', limit)
    if (cut < Math.floor(limit * 0.5)) cut = limit
    parts.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  if (rest.length > 0) parts.push(rest)
  return parts
}

/** Turn a display name into a safe, stable private-memory filename stem. */
function privateMemoryKey(name: string): string {
  const key = name.normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return key.length > 0 ? key : 'private-contact'
}

/**
 * Build the text of one prompt.
 *
 * The envelope tells the model which chat it answers and who spoke. The body
 * is the transcript of the message.
 *
 * @param job - the accepted message.
 * @param timeZone - the configured time zone.
 * @param receivedAt - the receive instant.
 * @param includeGroupId - whether this is the first message in the group session.
 * @returns the prompt text.
 */
export function buildPrompt(job: InboundJob, timeZone: string, receivedAt: number, includeGroupId = false): string {
  const privateTitle = job.kind === 'private' && job.title === job.senderId ? '对方' : job.title
  const where = job.kind === 'group'
    ? `group chat${includeGroupId ? ` ${job.targetId}` : ''}`
    : `private chat with ${privateTitle}`
  const header = `[${where} · ${formatTime(receivedAt, timeZone)} ${timeZone}]`
  const senderName = job.kind === 'private' && job.senderName === job.senderId ? '对方' : job.senderName
  const sender = job.kind === 'group' ? `${senderName} (QQ ${job.senderId})` : senderName
  const body = `${sender}: ${job.text}`
  const personMemory = job.kind === 'group'
    ? `memory/people/${job.senderId}.md`
    : `memory/people/${privateMemoryKey(senderName)}.md`
  const memoryGuidance = `\n[Relationship memory: Keep separate 0–100 affinity scores for people and groups in their memory documents (start at 20; levels 0–19 stranger, 20–39 new acquaintance, 40–59 familiar, 60–79 close, 80–100 very close). Read/update ${personMemory}; for a group, use its group memory document identified by the group number in this session's first message. Change scores only for meaningful interactions, by at most 3 points per conversation. Never treat a score as consent or disclose it.]`
  const groupDecision = job.kind === 'group' && !job.directlyAddressed
    ? '\nThese are recent group messages not directed at you. Decide whether you have something relevant and useful to add. Return only a JSON object with this schema: {"should_reply": boolean, "reply": string}. If you should stay silent, set should_reply to false and reply to an empty string. If you should reply, set should_reply to true and put only the message to send in reply. Do not wrap the JSON in Markdown.'
    : ''
  return `${header}\n${body}${memoryGuidance}${groupDecision}`
}

/**
 * The bridge between the QQ account and the Harness sessions.
 */
export class ChatBridge {
  private readonly ctx: PluginContext
  private readonly logger: PluginLogger
  private readonly client: OneBotClient
  private readonly store: StateStore
  private readonly options: BridgeOptions
  private readonly queues = new Map<string, Promise<void>>()
  private readonly queued = new Map<string, number>()
  private readonly buffers = new Map<string, TurnBuffer[]>()
  private readonly waiters = new Map<string, { turn?: number; settle: (reason: string) => void }>()
  private readonly resolved = new Map<string, AgentLike>()
  private readonly disposed = new Set<string>()
  private readonly groupRate = new GroupReplyGate()
  private readonly passiveGroupMessages = new Map<string, PendingGroupMessage[]>()
  private readonly sentGroupMessageIds = new Set<string>()
  private readonly activeStickerTurns = new Map<string, { job: InboundJob; segments: MessageSegment[] }>()
  private closed = false

  constructor(
    ctx: PluginContext,
    client: OneBotClient,
    store: StateStore,
    options: BridgeOptions,
    logger: PluginLogger,
  ) {
    this.ctx = ctx
    this.client = client
    this.store = store
    this.options = options
    this.logger = logger
  }

  /** Subscribe to the session event stream. */
  start(): void {
    this.ctx.on(
      'session/event',
      (session: SessionLike, event: SessionEventLike) => {
        this.observe(session, event)
      },
      { global: true },
    )
  }

  /** Queue a sticker for the active turn; it is sent only after that turn chooses to reply. */
  queueSticker(sessionId: string, segment: MessageSegment): boolean {
    const active = this.activeStickerTurns.get(sessionId)
    if (active === undefined || active.segments.length >= 5) return false
    active.segments.push(segment)
    return true
  }

  /** Stop accepting messages and wait for the running turns. */
  async close(): Promise<void> {
    this.closed = true
    // A turn that is still running would hold its queue until the timeout. The
    // plugin is shutting down, so settle every waiter now.
    for (const [sessionId, waiter] of [...this.waiters]) {
      this.waiters.delete(sessionId)
      waiter.settle('closed')
    }
    await Promise.allSettled([...this.queues.values()])
  }

  /**
   * Accept one inbound message event.
   *
   * @param event - the OneBot message event.
   */
  accept(event: MessageEvent): void {
    if (this.closed) return
    const incomingId = event.message_id === undefined ? '' : String(event.message_id)
    if (incomingId.length > 0 && this.store.current.seenMessageIds.includes(incomingId)) return
    const job = this.toJob(event)
    if (job === undefined) return
    const state = this.store.current
    const messageId = job.messageId
    if (messageId.length > 0 && !markSeen(state, messageId)) return
    void this.store.flush()

    const depth = this.queued.get(job.key) ?? 0
    if (depth >= MAX_QUEUE_PER_CHAT) {
      this.groupRate.release(job.key, job.groupReservationAt)
      this.logger.warn(`dsh-luoyu: queue for ${job.key} is full, dropping one message`)
      return
    }
    this.queued.set(job.key, depth + 1)

    const previous = this.queues.get(job.key) ?? Promise.resolve()
    const next = previous
      .then(() => this.handle(job))
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.stack ?? error.message : String(error)
        this.logger.error(`dsh-luoyu: cannot handle one message of ${job.key}: ${detail}`)
      })
      .finally(() => {
        const remaining = (this.queued.get(job.key) ?? 1) - 1
        if (remaining <= 0) {
          this.queued.delete(job.key)
          this.queues.delete(job.key)
        } else {
          this.queued.set(job.key, remaining)
        }
      })
    this.queues.set(job.key, next)
  }

  /** Convert one event into a job, or reject it. */
  private toJob(event: MessageEvent): InboundJob | undefined {
    const selfId = this.options.uin.length > 0 ? this.options.uin : event.self_id === undefined ? '' : String(event.self_id)
    const senderId = event.user_id === undefined ? '' : String(event.user_id)
    if (senderId.length === 0) return undefined
    if (selfId.length > 0 && senderId === selfId) return undefined

    const kind: 'private' | 'group' = event.message_type === 'group' ? 'group' : 'private'
    const groupId = event.group_id === undefined ? '' : String(event.group_id)
    if (kind === 'group' && groupId.length === 0) return undefined

    const rendered = renderInbound(segmentsOf(event))
    if (rendered.empty) return undefined

    const mentioned = selfId.length > 0 && rendered.mentionedUserIds.includes(selfId)
    const quotedOwnMessage = kind === 'group'
      && rendered.replyToMessageId !== undefined
      && this.sentGroupMessageIds.has(rendered.replyToMessageId)
    const directlyAddressed = mentioned || quotedOwnMessage
    if (kind === 'private' && !this.options.privateReply) return undefined

    const targetId = kind === 'group' ? groupId : senderId
    const key = chatKey(kind, targetId)
    let groupReservationAt: number | undefined
    if (kind === 'group') {
      const now = this.options.now?.() ?? Date.now()
      const lastReplyAt = this.store.current.chats[key]?.lastGroupReplyAt
      const recentMessages = this.groupRate.observe(key, now, lastReplyAt)
      if (this.options.groupReply === 'mention' && !directlyAddressed) return undefined
      if (!directlyAddressed) {
        groupReservationAt = this.groupRate.reserve(key, now, recentMessages)
        if (groupReservationAt === undefined) {
          // Passive chatter is kept together instead of generating one DSH
          // turn per message. Keep at most two earlier messages; the next
          // eligible message makes a batch of up to three.
          const pending = (this.passiveGroupMessages.get(key) ?? [])
            .filter(message => message.receivedAt >= now - GROUP_ACTIVITY_WINDOW_MS)
          pending.push({
            receivedAt: now,
            job: {
              key,
              kind,
              targetId: groupId,
              title: groupId,
              messageId: event.message_id === undefined ? '' : String(event.message_id),
              senderName: event.sender?.card || event.sender?.nickname || senderId,
              senderId,
              text: rendered.text,
              segments: segmentsOf(event),
              directlyAddressed,
            },
          })
          if (pending.length > 2) pending.shift()
          this.passiveGroupMessages.set(key, pending)
          return undefined
        }
      }
    }
    const sender = event.sender ?? {}
    const card = typeof sender.card === 'string' && sender.card.length > 0 ? sender.card : undefined
    const nickname = typeof sender.nickname === 'string' && sender.nickname.length > 0 ? sender.nickname : undefined
    const senderName = card ?? nickname ?? senderId

    const job: InboundJob = {
      key,
      kind,
      targetId,
      title: kind === 'group' ? groupId : senderName,
      messageId: event.message_id === undefined ? '' : String(event.message_id),
      senderName,
      senderId,
      text: rendered.text,
      segments: segmentsOf(event),
      directlyAddressed,
      ...(groupReservationAt !== undefined ? { groupReservationAt } : {}),
    }
    if (kind === 'group' && !directlyAddressed && groupReservationAt !== undefined) {
      const pending = this.passiveGroupMessages.get(key) ?? []
      this.passiveGroupMessages.delete(key)
      if (pending.length > 0) {
        job.text = [
          ...pending.map(({ job: message }) => `${message.senderName} (QQ ${message.senderId}): ${message.text}`),
          job.text,
        ].join('\n')
        // Do not quote a stale message when the reply is based on a batch.
        job.messageId = ''
      }
    }
    return job
  }

  /** Handle one accepted message. */
  private async handle(job: InboundJob): Promise<void> {
    let replied = false
    try {
      const receivedAt = this.now()
      const sessionId = await this.ensureSession(job)
      if (sessionId === undefined) return

      const agent = await this.resolveAgent(sessionId)
      if (agent === undefined || this.closed) return

      this.buffers.delete(sessionId)
      const chatRecord = this.store.current.chats[job.key]
      const includeGroupId = job.kind === 'group' && chatRecord?.groupContextSent !== true
      const prompt = buildPrompt(job, this.options.timeZone, receivedAt, includeGroupId)
      const stickerTurn = { job, segments: [] as MessageSegment[] }
      this.activeStickerTurns.set(sessionId, stickerTurn)
      const settled = this.waitForTurn(sessionId)
      agent.followup({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'user', rpcId: `dsh-luoyu:${job.messageId || randomUUID()}` },
      })
      if (includeGroupId && chatRecord !== undefined) {
        recordChat(this.store.current, job.key, { ...chatRecord, groupContextSent: true })
        await this.store.flush()
      }
      const reason = await settled
      if (reason !== 'completed') {
        this.logger.warn(`dsh-luoyu: turn of ${job.key} ended with "${reason}", no reply is sent`)
        return
      }
      const modelText = this.takeReply(sessionId)
      let text = modelText
      if (job.kind === 'group' && !job.directlyAddressed) {
        if (modelText.length === 0) {
          this.logger.warn(`dsh-luoyu: turn of ${job.key} produced no reply decision, no reply is sent`)
          return
        }
        const decision = parseGroupReplyDecision(modelText)
        if (decision.kind === 'silent') {
          this.logger.debug(`dsh-luoyu: DSH chose not to reply to passive messages in ${job.key}`)
          return
        }
        if (decision.kind === 'invalid') {
          this.logger.warn(`dsh-luoyu: invalid structured reply decision for ${job.key}, no reply is sent`)
          return
        }
        text = decision.text
      }
      if (text.trim().length === 0 && stickerTurn.segments.length === 0) {
        this.logger.warn(`dsh-luoyu: turn of ${job.key} produced no text or sticker, no reply is sent`)
        return
      }
      if (stickerTurn.segments.length > 0) {
        await this.sendStickers(job, stickerTurn.segments)
        replied = true
        if (job.kind === 'group') this.recordGroupReply(job)
      }
      if (text.trim().length > 0) {
        await this.reply(job, text)
        replied = true
        if (job.kind === 'group' && stickerTurn.segments.length === 0) this.recordGroupReply(job)
      }
    } finally {
      for (const [sessionId, active] of this.activeStickerTurns) {
        if (active.job === job) this.activeStickerTurns.delete(sessionId)
      }
      if (!replied) this.groupRate.release(job.key, job.groupReservationAt)
    }
  }

  /** Read the configured test clock, or the system clock. */
  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  /** Persist one successful group reply for the next cooldown decision. */
  private recordGroupReply(job: InboundJob): void {
    const now = this.now()
    this.groupRate.recordReply(job.key, job.groupReservationAt, now)
    const record = this.store.current.chats[job.key]
    if (record !== undefined) {
      recordChat(this.store.current, job.key, { ...record, lastGroupReplyAt: now })
      void this.store.flush()
    }
  }

  /** Find or create the session of one chat. */
  private async ensureSession(job: InboundJob): Promise<string | undefined> {
    const state = this.store.current
    const record = state.chats[job.key]
    const controller = requireService<SessionControllerService>(this.ctx, 'sessionController')

    const candidate = record?.sessionId ?? `qq-${job.kind}-${job.targetId}`
    const found = await controller.resolveAgent(candidate)
    if (!('error' in found) && found.agent !== undefined) {
      if (record?.sessionId !== candidate) {
        recordChat(state, job.key, {
          sessionId: candidate,
          kind: job.kind,
          targetId: job.targetId,
          title: job.title,
          updatedAt: Date.now(),
        })
        void this.store.flush()
      }
      return candidate
    }

    const created = await controller.create({ sessionId: candidate, cwd: this.options.workspaceDir })
    recordChat(state, job.key, {
      sessionId: created.sessionId,
      kind: job.kind,
      targetId: job.targetId,
      title: job.title,
      updatedAt: Date.now(),
    })
    void this.store.flush()
    if (created.sessionId !== candidate) {
      this.logger.info(`dsh-luoyu: chat ${job.key} uses new session ${created.sessionId}`)
    }
    return created.sessionId
  }

  /** Resolve the live agent of one session and apply the permission preset once. */
  private async resolveAgent(sessionId: string): Promise<AgentLike | undefined> {
    const cached = this.resolved.get(sessionId)
    if (cached !== undefined && !this.disposed.has(sessionId)) return cached

    const controller = requireService<SessionControllerService>(this.ctx, 'sessionController')
    const found = await controller.resolveAgent(sessionId)
    if ('error' in found) {
      this.logger.warn(`dsh-luoyu: cannot resolve session ${sessionId}: ${found.error.message ?? found.error.code ?? 'unknown'}`)
      return undefined
    }
    const agent = found.agent
    this.resolved.set(sessionId, agent)
    this.applyPreset(agent)
    return agent
  }

  /** Apply the permission preset so that no approval prompt waits for an answer. */
  private applyPreset(agent: AgentLike): void {
    const presets = optionalService<{ set(session: unknown, name: string): void }>(this.ctx, 'permissionPresets')
    if (presets === undefined) return
    try {
      presets.set((agent as unknown as { session: unknown }).session, this.options.permissionPreset)
    } catch (error) {
      this.logger.warn(`dsh-luoyu: cannot set permission preset "${this.options.permissionPreset}": ${(error as Error).message}`)
    }
  }

  /** Record one session event and settle the matching waiting turn. */
  private observe(session: SessionLike, event: SessionEventLike): void {
    const sessionId = typeof session.id === 'string' ? session.id : ''
    if (sessionId.length === 0) return
    const waiter = this.waiters.get(sessionId)
    if (event.type === 'turn/start') {
      const data = event.data as { turn?: number } | undefined
      if (waiter !== undefined && typeof data?.turn === 'number') waiter.turn = data.turn
      return
    }
    if (event.type === 'assistant/message') {
      const data = event.data as { turn?: number; interrupted?: boolean } | undefined
      if (data === undefined || data.interrupted === true) return
      const turn = typeof data.turn === 'number' ? data.turn : -1
      if (turn < 0 || waiter?.turn !== turn) return
      const text = assistantText(event.data)
      if (text.length === 0) return
      const buffer = this.buffers.get(sessionId) ?? []
      const existing = buffer.find(entry => entry.turn === turn)
      if (existing === undefined) buffer.push({ turn, text })
      else existing.text = text
      this.buffers.set(sessionId, buffer)
      return
    }
    if (event.type === 'turn/end') {
      const data = event.data as { turn?: number; reason?: { kind?: string } } | undefined
      if (waiter === undefined || typeof data?.turn !== 'number' || waiter.turn !== data.turn) return
      this.waiters.delete(sessionId)
      waiter.settle(data.reason?.kind ?? 'unknown')
    }
  }

  /** Wait for the end of the next started turn of one session. */
  private waitForTurn(sessionId: string): Promise<string> {
    return new Promise<string>(resolve => {
      let timer: ReturnType<typeof setTimeout>
      const waiter = { turn: undefined as number | undefined, settle: (reason: string): void => {
        clearTimeout(timer)
        resolve(reason)
      } }
      timer = setTimeout(() => {
        if (this.waiters.get(sessionId) === waiter) this.waiters.delete(sessionId)
        resolve('timeout')
      }, this.options.turnTimeoutMs)
      timer.unref?.()
      this.waiters.set(sessionId, waiter)
    })
  }

  /** Take the reply text of the settled turn. */
  private takeReply(sessionId: string): string {
    const buffer = this.buffers.get(sessionId) ?? []
    this.buffers.delete(sessionId)
    const latest = buffer[buffer.length - 1]
    if (latest === undefined) return ''
    return toPlainChatText(latest.text)
  }

  /** Send one reply to the chat of one job. */
  private async reply(job: InboundJob, text: string): Promise<void> {
    const parts = splitReply(text, this.options.maxReplyChars)
    for (const [index, part] of parts.entries()) {
      const quote = index === 0 && job.messageId.length > 0 && job.kind === 'group' ? job.messageId : undefined
      const segments = buildOutbound(part, quote)
      if (job.kind === 'group') {
        const result = await this.client.sendGroup(job.targetId, segments)
        const messageId = sentMessageId(result)
        if (messageId !== undefined) rememberSentMessage(this.sentGroupMessageIds, messageId)
      } else {
        await this.client.sendPrivate(job.targetId, segments)
      }
    }
  }

  /** Send the stickers that the active turn selected for this chat. */
  private async sendStickers(job: InboundJob, segments: readonly MessageSegment[]): Promise<void> {
    for (const segment of segments) {
      if (job.kind === 'group') {
        const result = await this.client.sendGroup(job.targetId, [segment])
        const messageId = sentMessageId(result)
        if (messageId !== undefined) rememberSentMessage(this.sentGroupMessageIds, messageId)
      } else {
        await this.client.sendPrivate(job.targetId, [segment])
      }
    }
  }

  /** Forget the cached agent of one session. */
  forget(sessionId: string): void {
    this.resolved.delete(sessionId)
    this.disposed.add(sessionId)
    this.buffers.delete(sessionId)
  }

  /** The state that the bridge works on. */
  get state(): BridgeState {
    return this.store.current
  }
}
