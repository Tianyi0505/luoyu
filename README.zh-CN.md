# Luoyu

[English](README.md)

Luoyu 是一个运行在你自己的 QQ 账号上的个性化机器人。你可以设置它的人设、记忆和
回复规则。Luoyu 是
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的插件。

每个 QQ 群聊和私聊对应独立的 Harness 会话。记忆以 Markdown 保存在指定工作区，
各会话共享工作区中的指令和记忆。插件通过 OneBot 11 与 NapCat 通信。

## 能力

- 群聊与私聊分别维护会话和记忆目录。
- 每日整理聊天上下文，保留近 15 天记录，并以有界长期记忆归纳较早内容。
- 群聊内容可补充参与成员的个人记忆；私聊内容仅保存在对应个人空间。
- 新建会话支持配置默认模型与权限。
- 支持文本和收藏贴图回复、QQ 联系人及群信息工具、状态页与登录二维码。

## 界面

设置页提供人设、工作区和 NapCat 管理。Luoyu 状态页提供登录状态和二维码，
地址为 `http://127.0.0.1:3080/luoyu`。配置按当前 profile 保存；工作区变更会建立独立的新会话。

Docker 部署配置位于 [`deploy/docker/`](deploy/docker/)，Web 界面端口为 3090。

## 环境要求

- DeepSeek Harness 0.2.x。
- Node.js 22.19 或更高版本。
- Linux QQ 客户端运行环境：Debian/Ubuntu、`apt-get`，以及免密 sudo 或桌面 `pkexec` 授权。
- 显示服务器：Electron QQ 客户端使用的图形运行环境。

## 配置

配置字段均提供默认值，覆盖 QQ 连接、回复策略、权限和记忆工作区：

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `workspaceDir` | `/workspace/memroy` | 保存人设、记忆文件和所有会话。 |
| `persona` | 一段简短的机器人人设 | 写入 `PERSONA.md`。可在 **设置 → Luoyu** 中编辑。 |
| `privateReply` | `true` | 回复私聊消息。 |
| `groupReply` | `balanced` | 立即回复直接提及。适度模式下，在三分钟内有两条消息的活跃群聊中参与，两条回复之间等待 90 到 300 秒。 |
| `uin` | 空 | 账号的 QQ 号。托管模式在为空时读取登录状态。 |
| `napcatMode` | `managed` | 让插件运行 NapCat，或连接你自己运行的 NapCat。 |
| `wsUrl` | `ws://127.0.0.1:3001` | OneBot 事件流。 |
| `httpUrl` | `http://127.0.0.1:3000` | OneBot 动作接口。 |
| `accessToken` | 空 | NapCat 要求的令牌。 |
| `napcatDir` | `<DSH_HOME>/integrations/dsh-luoyu/napcat` | 托管模式下的 NapCat 安装目录。 |
| `qqDir` | 插件工作区下的 `tools/napcat/opt/QQ` | NapCat 使用的 QQ 客户端目录。 |
| `napcatVersion` | `latest` | NapCat 发布标签。 |
| `napcatWebuiPort` | `6099` | NapCat Web 界面的端口。 |
| `napcatWebuiToken` | 空 | NapCat Web 界面的令牌。 |
| `autoStart` | `true` | 托管模式下的自动启动选项。 |
| `permissionPreset` | `danger-full-access` | 每个聊天会话的权限预设。 |
| `timeZone` | `Asia/Shanghai` | 插件在每个提示词中报告的时区。 |
| `maxReplyChars` | `1500` | 回复的最大字符数。更长的回复会被拆分。 |
| `turnTimeoutMs` | `600000` | 一个回合的时间限制，单位毫秒。 |


## 工作区

工作区文件提供 Harness 指令、人设和分层记忆：

~~~
AGENTS.md                  Harness 为每个会话加载的指令
PERSONA.md                 机器人是谁
memory/self.md             机器人对自己的了解
memory/people.md           每个人一个段落
memory/episodes.md         以后会用到的带日期事件
memory/open-threads.md     待跟进的问题和承诺
~~~

所有聊天会话共享 `workspaceDir` 中的指令和记忆。Agent 可按需检索记忆文件，保持
长期记忆聚焦且易于维护。

## 状态

会话映射和最近 2000 条已处理消息标识保存在
`<DSH_HOME>/integrations/dsh-luoyu/state.json`，文件权限为 `0600`。

## 安全

- OneBot 服务绑定本机地址 `127.0.0.1`。
- 状态文件使用 `0600` 权限；访问令牌受到日志保护。
- 人设包含凭据保护要求，记忆保存在用户指定的工作区。
