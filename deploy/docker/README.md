# Docker 部署（本机）

把 Luoyu（`dsh-luoyu` 插件）和 DeepSeek Harness 一起打成镜像，Harness 的 Web UI
发布到宿主机 **3090**，机器人工作区（人设 + 记忆 Markdown）以数据卷方式挂到宿主机的
`workspace/` —— 也就是 `git@github.com:Tianyi0505/luoyu-memory.git` 这个仓库。

```
宿主机                                  容器 luoyu-dsh
──────────────────────────────────────  ──────────────────────────────────────
./workspace  (luoyu-memory 仓库)   ──►   /workspace          ← 工作区（人设/记忆）
named volume luoyu-dsh-home        ──►   /dsh-home           ← 会话、状态、NapCat
./lib ./client.js ./cordis.patch.yml ─►  /opt/dsh-luoyu      ← 宿主机构建产物（只读）
localhost:3090                     ──►   0.0.0.0:3090 → 127.0.0.1:3080 (socat)
```

`dsh web` 出于安全考虑拒绝绑定 `0.0.0.0`（GUI 能执行代码），所以容器里它只听
`127.0.0.1:3080`，由 `socat` 把 3090 转发进去；`--trusted-host localhost:3090`
让它接受宿主浏览器带过来的 `Host` 头。

## 起停

```bash
cd D:/ai-love

# 首次（或 Dockerfile / 依赖变更后）
docker compose -f deploy/docker/docker-compose.yml up -d --build

# 日常
docker compose -f deploy/docker/docker-compose.yml up -d
docker compose -f deploy/docker/docker-compose.yml logs -f dsh
docker compose -f deploy/docker/docker-compose.yml restart dsh
docker compose -f deploy/docker/docker-compose.yml down          # 保留卷
docker compose -f deploy/docker/docker-compose.yml down -v       # 连卷一起删（会话没了）
```

打开：

- Harness UI → <http://localhost:3090>
- Luoyu 面板（登录状态、二维码、人设、工作区）→ <http://localhost:3090/luoyu>

## 配置

| 位置 | 作用 |
| --- | --- |
| `deploy/docker/.env` | 宿主机端口、工作区路径、`DEEPSEEK_API_KEY`（由 `.env.example` 复制而来，已在 `.gitignore` 里） |
| `deploy/docker/luoyu.patch.yml` | 插件配置，挂成 `$DSH_HOME/cordis.patch.yml`（home 补丁层，优先级高于插件默认值） |
| `deploy/docker/settings.yaml` | 默认模型的种子文件，只在首次启动时复制进 `luoyu-dsh-home` 卷 |

`luoyu.patch.yml` 里最常改的两项：

- `workspaceDir` —— 默认 `/workspace`，就是宿主机 `workspace/` 那一份仓库；
- `napcatMode` —— `managed`（容器内自己下 NapCat + QQ）或 `external`（连你自己跑的
  NapCat，把 `wsUrl`/`httpUrl` 指向它，比如 `ws://host.docker.internal:3001`）。

## 工作区（luoyu-memory）

宿主机克隆一次即可，容器只往里写文件，不碰 `.git`：

```bash
git clone git@github.com:Tianyi0505/luoyu-memory.git workspace
```

首次启动后插件会补齐这些文件（已存在的不覆盖）：

```
workspace/AGENTS.md              Harness 每个会话加载的指令
workspace/PERSONA.md             机器人是谁
workspace/memory/self.md         对自己的了解
workspace/memory/people.md       每个人一段
workspace/memory/episodes.md     带日期的事件
workspace/memory/open-threads.md 未结束的问题和承诺
```

想把这些落盘内容推回仓库，在宿主机 `workspace/` 里 `git add -A && git commit && git push`
即可。容器里也有 `git`，但默认没有挂 SSH 私钥；要让 Agent 自己推，给 compose 加一行：

```yaml
      - ${HOME}/.ssh:/root/.ssh:ro
```

（Windows 下把 `${HOME}` 换成一个具体路径，并确认私钥权限是 600。）

## 代码热更新

镜像里已经包含 `lib/index.js` 构建产物，但 compose 又把宿主机的 `lib/`、
`client.js`、`cordis.patch.yml` **只读**挂进了 `/opt/dsh-luoyu`。所以改完源码：

```bash
npm run build
docker compose -f deploy/docker/docker-compose.yml restart dsh
```

不需要重新构建镜像；只有依赖（`package.json`）变了才 `up -d --build`。

## NapCat / QQ 的注意事项

`managed` 模式在容器里需要：Linux QQ（Electron，需要显示服务器）、`unzip`、`sudo` +
`apt`。镜像已经装了 Xvfb（`DISPLAY=:99`）、`unzip`、`sudo`、QQ 需要的 Electron 库和
CJK 字体。点「启动 NapCat」后，插件会自行把 NapCat 下载到
`/dsh-home/integrations/dsh-luoyu/napcat`（这一步实测可用，v4.18.41 已装好）。

QQ 客户端这一步在本机走不通：插件会从腾讯官方配置源取 `.deb` 地址，而
`qqdl.gtimg.cn` 对本机 IP 直接返回 403（宿主机和容器都一样，带 Referer / UA 也无效），
所以自动安装会停在 `needs-qq`。手动装一次即可：

```bash
# 1. 用浏览器打开 https://im.qq.com/linuxqq/download.html 下载 amd64 的 .deb
#    （CDN 对本机 403，浏览器下不动的话就换个网络/设备下载后拷过来）
# 2. 装进容器（解压到卷里，重建容器不丢）
./deploy/docker/install-qq.sh /path/to/QQ_3.2.34_260924_amd64_01.deb
# 3. 回到 http://localhost:3090/luoyu 点「启动 NapCat」，扫码
```

`install-qq.sh` 做的是 `dpkg -x` 到 `/dsh-home/qq`，entrypoint 每次启动再把
`/dsh-home/qq/opt/QQ` 链到 `/opt/QQ`（NapCat 认这个路径），插件配置里的 `qqDir` 指向
同一处，所以 `docker compose down/up` 之后不用重装 QQ。

其他限制：

- QQ 首次登录大概率要做设备/短信验证，和在本机跑一样；
- 容器以 root 运行、Agent 权限预设是 `danger-full-access`，它只能在容器里执行命令、
  只能看到挂进去的 `/workspace` 和 `/dsh-home`——这是隔离点，不要给它挂宿主目录；
- OneBot 端口（3000/3001）只在容器内部，宿主机不需要暴露。

## 已经验证过的

| 检查项 | 结果 |
| --- | --- |
| `dsh web` 在容器内起在 `127.0.0.1:3080`，socat 转发到 3090 | `GET /` 401 → 带 `?token=` 303 → cookie 后 200 |
| 插件作为 bundle 层加载（`--dump-config` 可见 `dsh-luoyu` 行） | `workspaceDir: /workspace`、`napcatMode: managed` 生效 |
| 工作区数据卷 | 容器内写入的 `AGENTS.md`、`PERSONA.md`、`memory/*.md` 落在宿主机 `workspace/` 并已推送 `luoyu-memory` |
| 默认模型 | 种子 `settings.yaml` 生效为 `deepseek-official / deepseek-v4-pro` |
| NapCat | 自动下载安装 v4.18.41 到卷内 |
| QQ 客户端 | 自动下载被腾讯 CDN 403，改用手动 `install-qq.sh` |

## 排查

```bash
docker compose -f deploy/docker/docker-compose.yml ps          # healthy?
docker exec -it luoyu-dsh bash                                 # 进容器
docker exec luoyu-dsh ls -la /workspace                        # 工作区是否挂上
docker exec luoyu-dsh dsh --profile web --dump-config | head   # 组合出的配置树
```

- 打开 `http://localhost:3090/` 显示 `dsh web authentication required`：这是浏览器的
  一次性登录地址没带 `?token=`，从 `docker compose ... logs dsh | grep token=` 里
  取完整 URL 打开一次即可（之后 cookie 有效期 30 天，重启容器也不用再登录）；
- 页面 403 / `browser-trust` 报错：说明访问用的 authority 不在信任列表里，把
  `LUOYU_PORT` 或 `DSH_EXTRA_TRUSTED_HOSTS` 改成你实际用的地址。
- 模型报未授权：`DEEPSEEK_API_KEY` 没进容器，检查 `deploy/docker/.env`。
- 日志里 `no display server`：`LUOYU_XVFB` 被设成了 0。
