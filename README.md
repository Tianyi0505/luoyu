# Luoyu

[简体中文](README.zh-CN.md)

Luoyu is a personalized QQ bot. It runs on your own QQ account. You set its
persona, its memory, and its reply rules. Luoyu is a plugin for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Each QQ group and private chat has an independent Harness session. Markdown memory lives in the configured workspace, which shares instructions and memory across sessions. The plugin communicates with NapCat through OneBot 11.

## Capabilities

- Independent session and memory directories for group and private chats.
- Daily context summaries, a 15-day recent-history window, and bounded long-term memory.
- Group conversations can enrich participating members' personal memory; private conversations remain in their personal spaces.
- Configurable default model and permissions for new sessions.
- Text and saved-sticker replies, QQ contact and group tools, status page, and login QR code.

## Interface

The Settings page provides persona, workspace, and NapCat management. The Luoyu status page provides login state and QR access at `http://127.0.0.1:3080/luoyu`. Configuration is stored in the active profile, and workspace changes create independent sessions.

Docker deployment configuration is available in [`deploy/docker/`](deploy/docker/), with the Web interface on port 3090.

## Requirements

- DeepSeek Harness 0.2.x.
- Node.js 22.19 or later.
- Linux QQ client runtime: Debian/Ubuntu, `apt-get`, and passwordless sudo or desktop `pkexec` authorization.
- Display server for the Electron QQ client.

## Configuration

Configuration fields provide defaults for QQ connectivity, reply behavior, permissions, and the memory workspace:

| Key | Default | Meaning |
| --- | --- | --- |
| `workspaceDir` | `/workspace/memroy` | Holds the persona, the memory files, and every session. |
| `persona` | A short bot persona | Written into `PERSONA.md`. You can edit it in **Settings → Luoyu**. |
| `privateReply` | `true` | Answer private messages. |
| `groupReply` | `balanced` | Answer direct mentions immediately. In balanced mode, answer active group chats with a 90–300 second cooldown. |
| `uin` | empty | QQ account identity; managed mode supports login-based identity. |
| `napcatMode` | `managed` | Managed NapCat runtime or custom NapCat connection. |
| `wsUrl` | `ws://127.0.0.1:3001` | OneBot event stream. |
| `httpUrl` | `http://127.0.0.1:3000` | OneBot action endpoint. |
| `accessToken` | empty | Token that NapCat requires. |
| `napcatDir` | `<DSH_HOME>/integrations/dsh-luoyu/napcat` | Installation directory of the managed NapCat. |
| `qqDir` | `tools/napcat/opt/QQ` under the plugin workspace | Directory containing the QQ client used by NapCat. |
| `napcatVersion` | `latest` | NapCat release tag. |
| `napcatWebuiPort` | `6099` | Port of the NapCat web interface. |
| `napcatWebuiToken` | empty | Token of the NapCat web interface. |
| `autoStart` | `true` | Automatic startup option for managed NapCat. |
| `permissionPreset` | `danger-full-access` | Permission preset for each chat session. |
| `timeZone` | `Asia/Shanghai` | Zone that the plugin reports with each prompt. |
| `maxReplyChars` | `1500` | Largest reply, in characters. The plugin splits a longer reply. |
| `turnTimeoutMs` | `600000` | Time limit for one turn, in milliseconds. |


## The workspace

Workspace files provide Harness instructions, persona, and layered memory:

~~~
AGENTS.md                  Instructions that the Harness loads for every session
PERSONA.md                 Who the bot is
memory/self.md             What the bot learned about itself
memory/people.md           One section for each person
memory/episodes.md         Dated events that matter later
memory/open-threads.md     Follow-up questions and commitments
~~~

Every chat session shares the instructions and memory in `workspaceDir`. The agent retrieves memory files as needed, keeping long-term memory focused and maintainable.

## State

Chat-to-session mappings and the latest 2000 processed message identities are stored in `<DSH_HOME>/integrations/dsh-luoyu/state.json` with mode `0600`.

## Security

- OneBot services are bound to the local address `127.0.0.1`.
- The state file uses mode `0600`; access tokens receive log protection.
- Persona guidance includes credential protection, and memory remains in the configured workspace.
