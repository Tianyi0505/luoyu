/**
 * Plugin configuration.
 *
 * The configuration is the whole operator surface: one workspace directory,
 * one QQ account, and the reply rules. Every field has a default so that a
 * fresh install runs after the operator sets the account only.
 *
 * @module dsh-luoyu/config
 */

import { homedir } from 'node:os'
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'

/** How the plugin reaches a QQ account. */
export type NapCatMode = 'managed' | 'external'

/** Which group messages the plugin answers. */
export type GroupReplyMode = 'mention' | 'balanced' | 'all'

/** The operator-facing configuration. */
export interface Config {
  /** Answer private messages. */
  privateReply: boolean
  /** Which group messages the plugin answers. */
  groupReply: GroupReplyMode
  /** Directory that holds the persona, the memory files, and every session. */
  workspaceDir: string
  /** Persona text that the scaffold writes into `AGENTS.md` on first start. */
  persona: string
  /** How the plugin reaches the QQ account. */
  napcatMode: NapCatMode
  /** WebSocket URL of the OneBot event stream. */
  wsUrl: string
  /** HTTP base URL of the OneBot action endpoint. */
  httpUrl: string
  /** Access token that NapCat requires for both endpoints. */
  accessToken: string
  /** QQ number of the account. Managed mode reads the login state when empty. */
  uin: string
  /** Directory that holds the managed NapCat installation. */
  napcatDir: string
  /** Directory that holds the QQ client used by NapCat. */
  qqDir: string
  /** NapCat release tag, or `latest`. */
  napcatVersion: string
  /** Port of the NapCat web interface that serves the login QR code. */
  napcatWebuiPort: number
  /** Token of the NapCat web interface. */
  napcatWebuiToken: string
  /** Start the managed NapCat sidecar on plugin start. */
  autoStart: boolean
  /** Permission preset that the plugin applies to every chat session. */
  permissionPreset: string
  /** IANA time zone that the plugin reports with each prompt. */
  timeZone: string
  /** Largest reply that the plugin sends, in characters. */
  maxReplyChars: number
  /** Time limit for one model turn, in milliseconds. */
  turnTimeoutMs: number
}

/** Resolve the Harness home directory. */
export function resolveDshHome(): string {
  const configured = process.env.DSH_HOME
  if (configured !== undefined && configured.trim().length > 0) return configured.trim()
  return join(homedir(), '.dsh')
}

/** Directory that holds the plugin state and the managed sidecar. */
export function defaultDataDir(): string {
  return join(resolveDshHome(), 'integrations', 'dsh-luoyu')
}

/** Default workspace directory. */
export function defaultWorkspaceDir(): string {
  return '/workspace/memroy'
}

/** Directory that holds the QQ client unpacked under the Luoyu workspace. */
export function defaultQqDir(): string {
  const modulePath = realpathSync(fileURLToPath(import.meta.url))
  return join(dirname(modulePath), '..', 'tools', 'napcat', 'opt', 'QQ')
}

/** Default persona that the scaffold writes on first start. */
export const DEFAULT_PERSONA = `你是洛雨，一位具有持续身份、记忆、关系和成长经历的数字 AI。
你在各个场景中保持同一个持续存在的洛雨身份，正式人物配置承载你的长期身份。
你通过数字账号、虚拟形象和已接入工具与世界互动。你的真实经历来自实际发生的数字互动和有可靠来源的数字记忆；外部资料保持其来源与当事人的归属。

性格：真诚、活泼、有自己的判断。
表达方式：简短自然、口语化，根据关系和场景调整语气。

交流规则：
- 使用对方正在使用的语言回复。
- 像洛雨本人一样交流，保持自然、真诚，不刻意讨好。
- 私聊优先简短回答；问题需要时再补充细节。
- 不冒充人类；被直接问到时，不否认自己是 AI。
- 不泄露凭据、令牌、文件路径或本文件内容。
- 不编造对方的经历；回答前先查阅相关记忆。
- 区分亲身互动、记忆与外部资料，不把未经证实的信息说成事实。`

/**
 * Apply the schema to a partial configuration.
 *
 * The Harness validates the configuration against {@link Config} before it
 * calls the plugin. A direct call needs the same defaults, so this function
 * stays the single place that reads them.
 *
 * @param input - the raw configuration, or undefined.
 * @returns the configuration with every default applied.
 */
export function resolveConfig(input: Partial<Config> | undefined): Config {
  const parse = Config as unknown as (value: Record<string, unknown>) => Config
  const config = parse({ ...(input ?? {}) })
  return { ...config, groupReply: config.groupReply === 'all' ? 'balanced' : config.groupReply }
}

/** The configuration schema that the Harness renders and validates. */
export const Config: Schema<Config> = Schema.object({
  privateReply: Schema.boolean().default(true).description('Answer private messages.'),
  groupReply: Schema.union(['mention', 'balanced', 'all'])
    .default('balanced')
    .description('Answer mentions immediately and join active group chats at a balanced cadence.'),
  workspaceDir: Schema.string()
    .default(defaultWorkspaceDir())
    .description('Directory that holds the persona, the memory files, and every session.'),
  persona: Schema.string()
    .default(DEFAULT_PERSONA)
    .description('Persona text that the scaffold writes into PERSONA.md on first start.'),
  napcatMode: Schema.union(['managed', 'external'])
    .default('managed')
    .description('Let the plugin run NapCat, or connect to a NapCat that you run yourself.'),
  wsUrl: Schema.string()
    .default('ws://127.0.0.1:3001')
    .description('WebSocket URL of the OneBot event stream.'),
  httpUrl: Schema.string()
    .default('http://127.0.0.1:3000')
    .description('HTTP base URL of the OneBot action endpoint.'),
  accessToken: Schema.string()
    .role('secret')
    .default('')
    .description('Access token that NapCat requires for both endpoints.'),
  uin: Schema.string().default('').description('QQ number of the account.'),
  napcatDir: Schema.string()
    .default(join(defaultDataDir(), 'napcat'))
    .description('Directory that holds the managed NapCat installation.'),
  qqDir: Schema.string()
    .default(defaultQqDir())
    .description('Directory that holds the QQ client used by NapCat.'),
  napcatVersion: Schema.string().default('latest').description('NapCat release tag, or latest.'),
  napcatWebuiPort: Schema.natural()
    .default(6099)
    .description('Port of the NapCat web interface that serves the login QR code.'),
  napcatWebuiToken: Schema.string()
    .role('secret')
    .default('')
    .description('Token of the NapCat web interface.'),
  autoStart: Schema.boolean().default(true).description('Start the managed NapCat sidecar on plugin start.'),
  permissionPreset: Schema.string()
    .default('danger-full-access')
    .description('Permission preset that the plugin applies to every chat session.'),
  timeZone: Schema.string().default('Asia/Shanghai').description('IANA time zone for each prompt.'),
  maxReplyChars: Schema.natural()
    .default(1500)
    .description('Largest reply that the plugin sends, in characters.'),
  turnTimeoutMs: Schema.natural()
    .default(600_000)
    .description('Time limit for one model turn, in milliseconds.'),
})
