# Docker 部署（本机）

两个容器、一个 compose 局域网：

```
宿主机                                  compose 网络 (luoyu_default)
──────────────────────────────────────  ─────────────────────────────────────────────
localhost:3090  ──(端口发布 3090:3080)──►  luoyu-dsh   dsh --profile web（绑容器自己的 IP）
localhost:6099  ──(端口发布 6099:6099)──►  luoyu-napcat  NapCat + 官方 Linux QQ（镜像自带）

./workspace (luoyu-memory 仓库)   ──►  /workspace          ← 挂在 dsh 里（人设/记忆）
named volume luoyu-dsh-home       ──►  /dsh-home           ← dsh 的会话、状态
./data/napcat-docker/config       ──►  /app/napcat/config  ← 挂在 napcat 里（OneBot 配置）
./data/napcat-docker/qq           ──►  /app/.config/QQ     ← QQ 登录态（重建容器不掉线）

dsh 插件 ── ws://napcat:3001 / http://napcat:3000 ──► napcat（只在 compose 网络内，不对外发布）
```

- **3090 → 3080** 是普通 Docker 端口发布。容器里 `dsh --profile web` 绑定到容器自己的
  网卡 IP（`hostname -I`，dsh 拒绝 `0.0.0.0` 这类通配地址），发布端口即可直达。
- **QQ 客户端不用装**：`mlikiowa/napcat-docker` 镜像里自带官方 Linux QQ，也没有
  腾讯 CDN 403 的问题（镜像走 Docker Hub）。
- OneBot 端口（3000/3001）不发布到宿主机，只有 compose 网络里的 dsh 能连。

## 起停

```bash
cd D:/ai-love

# 首次（或 Dockerfile / 依赖变更后）
docker compose -f deploy/docker/docker-compose.yml up -d --build

# 日常
docker compose -f deploy/docker/docker-compose.yml up -d
docker compose -f deploy/docker/docker-compose.yml logs -f dsh napcat
docker compose -f deploy/docker/docker-compose.yml restart dsh
docker compose -f deploy/docker/docker-compose.yml down          # 保留卷与登录态
docker compose -f deploy/docker/docker-compose.yml down -v       # 连 dsh-home 卷一起删
```

## 首次登录（需要手机 QQ 扫一次码）

1. 打开 NapCat WebUI：<http://localhost:6099/webui>，令牌在 `deploy/docker/.env` 的
   `NAPCAT_WEBUI_TOKEN`（也在 `docker compose logs napcat` 里）。
2. 选 **扫码登录**，用机器人账号的手机 QQ 扫码。
   ⚠️ 登录后这个号就归协议端用了：同一账号再在电脑 QQ 登录会互踢，二者只能留一个在线。
3. 登录成功后 NapCat 会自动按预置配置拉起 OneBot 服务（WS 3001 / HTTP 3000，带令牌），
   dsh 里的插件会自动连上。看状态：<http://localhost:3090/luoyu> → `OneBot connected`。
4. Harness UI 本体：<http://localhost:3090>，首次打开用
   `docker compose ... logs dsh | grep token=` 里带 `?token=` 的完整地址（cookie 有效期
   30 天，容器重启不用重新登录）。

## 配置

| 位置 | 作用 |
| --- | --- |
| `deploy/docker/.env` | 宿主端口、`DEEPSEEK_API_KEY`、`NAPCAT_WEBUI_TOKEN`（由 `.env.example` 复制，已 gitignore） |
| `deploy/docker/luoyu.patch.yml` | 插件配置（workspace、外接 NapCat 地址等），挂成 `$DSH_HOME/cordis.patch.yml` |
| `deploy/docker/luoyu.local.patch.yml` | **令牌等机密**（OneBot accessToken），同样挂进容器但**不进 git** |
| `deploy/docker/settings.yaml` | 默认模型种子，只在首次启动复制进 `luoyu-dsh-home` 卷 |
| `data/napcat-docker/config/onebot11.json` | NapCat 的 OneBot 网络配置（WS/HTTP 服务端 + 令牌），与上面同一个令牌 |

`luoyu.patch.yml` 常改项：

- `workspaceDir` —— 默认 `/workspace`，就是宿主机 `workspace/` 那份 `luoyu-memory` 仓库；
- `groupReply` / `privateReply` —— 回复策略；
- 想改回「插件自己管 NapCat」：`napcatMode: managed` + 删掉 `wsUrl/httpUrl`，那是
  另一条路径（容器内自动下载 NapCat，QQ 需按 `install-qq.sh` 手动装，或让插件自动装）。

## 工作区（luoyu-memory）

宿主机克隆一次即可，容器只往里写文件，不碰 `.git`：

```bash
git clone git@github.com:Tianyi0505/luoyu-memory.git workspace
```

首次启动后插件会补齐 `AGENTS.md`、`PERSONA.md`、`memory/*.md`（已存在的不覆盖）。
把记忆推回仓库：在宿主机 `workspace/` 里 `git add -A && git commit && git push`。
容器里也有 `git`，但默认没挂 SSH 私钥；要让 Agent 自己推，给 dsh 服务加一行
`- ${HOME}/.ssh:/root/.ssh:ro`（Windows 下换成具体路径，并确认私钥权限 600）。

## 代码热更新

镜像里已含 `lib/index.js` 构建产物，但 compose 又把宿主机的 `lib/`、`client.js`、
`cordis.patch.yml` **只读**挂进了 `/opt/dsh-luoyu`。改完源码：

```bash
npm run build
docker compose -f deploy/docker/docker-compose.yml restart dsh
```

只有依赖（`package.json`）变了才需要 `up -d --build`。

## 排查

```bash
docker compose -f deploy/docker/docker-compose.yml ps            # 两个容器都应 healthy/up
docker exec luoyu-dsh dsh --profile web --dump-config | head     # 组合出的配置树
docker exec luoyu-napcat cat /app/napcat/config/webui.json       # WebUI 令牌
```

- `http://localhost:3090/` 返回 401：正常，未带一次性登录令牌。完整地址在 dsh 日志里。
- 插件一直 `OneBot offline`：NapCat 还没登录（看 6099 WebUI），或两边令牌不一致
  （`luoyu.local.patch.yml` 的 `accessToken` vs `data/napcat-docker/config/onebot11.json`）。
- NapCat 起不来 / QQ 掉线重连：删掉 `data/napcat-docker/qq` 重新扫码（登录态作废）。
- 模型报未授权：`DEEPSEEK_API_KEY` 没进容器，检查 `deploy/docker/.env`。

## 已经验证过的

| 检查项 | 结果 |
| --- | --- |
| 端口发布 3090:3080 直达 dsh（无 socat，dsh 绑容器 IP） | `GET /` 401 → 带 `?token=` 303 → cookie 后 200 |
| dsh + napcat 同一 compose 网络 | `napcat` 在 dsh 容器内解析为 172.22.0.2 |
| 插件外接配置 | dump-config 显示 `napcatMode: external`、`wsUrl: ws://napcat:3001` |
| 令牌注入 | `--patch luoyu.local.patch.yml` 后 `accessToken` 出现在组合配置（git 里没有它） |
| NapCat v4.18.41 | 镜像自带 QQ，WebUI 6099 用 `WEBUI_TOKEN` 登录，扫码页正常 |
| 工作区数据卷 | 脚手架文件落在宿主机 `workspace/` 并已推送 `luoyu-memory` |
| 待办 | NapCat 扫码登录（唯一需要人操作的一步） |
