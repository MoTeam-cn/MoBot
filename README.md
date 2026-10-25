# tg-guard-bot · Telegram 关键词过滤 + 入群验证 + 群管理

Node.js + TypeScript + [grammY](https://grammy.dev) 写的 Telegram 群管机器人。

**核心能力**

1. **关键词过滤**：群内出现敏感词/广告词 → 立刻撤回消息，并按规则警告 / 禁言 / 封禁（抗「广 告」「ＶＸ」「广\u200b告」这类变形）。
2. **入群验证**（对标 nmBot / KinhBot）：新人入群先禁言 → 私聊下发验证 → 未在 N 分钟内完成则踢出并按配置封禁（支持永久）。方式支持**按钮点击 / 图像验证码 / 网页 JS 验证**。
3. **代理**：Telegram API 支持 **http / https / socks5** 代理，运行时可热切换。
4. **热更新**：代码热重启、数据热加载、设置/关键词/代理即时生效，都不需要停服。

**配置方式**：没有配置文件地狱。填好 `BOT_TOKEN` 启动，控制台打印一次性初始化 token，第一个私聊发 `/setup <token>` 的人自动成为**超级管理员**，其余全部在私聊里用命令维护。

- 121 个自动化测试（含 mock API 端到端、真实 HTTP 代理 / SOCKS5 服务端、multipart 上传）
- 零数据库依赖：本地 JSON 原子落盘
- 零原生依赖生成验证码图片（自研 PNG 编码器 + 点阵字体）

---

## 一、3 步上线

```bash
npm install
copy .env.example .env     # 只填 BOT_TOKEN（cp 亦可）
npm run build && npm start # 或 npm run dev
```

启动后控制台会打印：

```text
══════════════════════════════════════════════════════════
  首次启动 · 初始化引导（只需做一次）
  1) 打开 Telegram，私聊机器人：@your_bot
  2) 发送下面这条命令：

        /setup AB3D7K9Q

  第一个完成 /setup 的用户将成为【超级管理员】，可管理一切。
══════════════════════════════════════════════════════════
```

私聊机器人发送 `/setup AB3D7K9Q` → 你就是超管，token 立即失效。

接着：拉进群并给管理员权限（删除消息 + 封禁成员）→ 群里 `/id` 拿群 ID → 私聊 `/addgroup <群ID>` → 群里 `/settings` 开面板、`/captcha on` 开验证、`/addword 广告 --action mute` 加关键词。

---

## 二、角色体系

| 角色 | 怎么获得 | 能做什么 |
| --- | --- | --- |
| **超级管理员** | 第一个 `/setup` 成功的人 | 一切：增删受管群、增删管理员、全局封禁、机器人配置、代理 |
| **普通管理员** | 超管 `/addadmin <ID>` | 管理所有受管群：设置面板、关键词、警告/禁言/封禁/踢人、信任名单；**不能**增删群与管理员、不能全局封禁 |
| **群管理员** | Telegram 群里自带的 admin | 只管本群：`/settings`、`/captcha`、`/addword`、成员处置 |
| 普通成员 | — | 无权限；发言会被关键词/反垃圾规则约束 |

> 超管、普通管理员、群管理员、信任名单都**不会被关键词误杀**，也不会被要求做入群验证。

---

## 三、私聊命令（控制台）

| 命令 | 权限 | 说明 |
| --- | --- | --- |
| `/setup <token>` | 首次 | 初始化，把当前用户设为超管 |
| `/start` · `/help` · `/id` | 所有人 | 状态 / 帮助 / ID |
| `/menu` | 管理员 | 控制台菜单（群组 / 管理员 / 全局封禁 / 帮助） |
| `/groups` | 超管 | 受管群列表，**点按钮直接改该群设置** |
| `/addgroup <群ID>` · `/delgroup <群ID>` | 超管 | 增删受管群 |
| `/admins` · `/addadmin <ID>` · `/deladmin <ID>` | 管理员 / 超管 | 管理员管理 |
| `/gban <用户> [原因]` · `/ungban` · `/glist` | 超管 | 全局封禁 |
| `/proxy [url\|off]` | 超管 | 切换 http/https/socks5 代理（**热生效**，附连通性自检） |
| `/reload` | 超管 | 从磁盘热加载 `state.json`（**无需重启**） |
| `/config` · `/config publicUrl <https://...>` | 超管 | 查看/设置机器人配置与网页验证地址 |
| `/init` | 超管 | 重新推送命令菜单（私聊 / 群 / 群管理员三套作用域） |
| `/stats` | 管理员 | 全局统计 |

启动时自动 `setMyCommands` 推三套菜单：`all_private_chats`、`all_group_chats`、`all_chat_administrators`。

---

## 四、群内命令

| 分组 | 命令 |
| --- | --- |
| 关键词 | `/addword <词> [--mode contains\|whole\|regex] [--action delete\|warn\|mute\|ban\|kick] [--mute 10m]` · `/delword` · `/words` · `/clearwords` · `/testword` |
| 设置 | `/settings`（按钮面板） · `/captcha` · `/set <项> <值>` |
| 成员 | `/warn /warns /unwarn /resetwarns` · `/mute <时长> /unmute` · `/kick /ban /unban` · `/purge <n>` · `/pin /unpin` |
| 其他 | `/trust /untrust /trusted` · `/report` · `/stats` · `/id` · `/help` |

---

## 五、入群验证

```text
新人入群
  └─ 立刻禁言（只读）
      └─ 私聊下发验证（按钮 / 图像验证码 / 网页链接）
          ├─ 通过 → 解除禁言 +（可选）欢迎语 + 写日志
          └─ 超时 N 分钟 / 输错 M 次 → 踢出 + 封禁（临时或永久）
```

- 用户没和机器人私聊过（Telegram 禁止主动私聊）→ 自动**降级为群内按钮**兜底并 @ 他。
- 未完成的验证**持久化**：重启后按剩余时间重挂定时器，已过期立即处置。
- 验证期间全程禁言；群管理员与信任用户免验证。

| 方式 | 说明 | 依赖 |
| --- | --- | --- |
| `button` | 内联按钮「✅ 我已完成验证」，点击即通过 | 无 |
| `image` | 实时生成**图像验证码**（自研 PNG + 点阵字体），私聊回复 5 位码 | 无 |
| `web` | 私聊发链接，页面必须**真正执行 JS**（SHA-256 PoW）才能通过 | 需 `publicUrl` + 可达端口 |

未配置 `publicUrl` 时 `web` 自动降级为 `image`。

```text
/captcha on | off              开关
/captcha mode button|image|web 验证方式
/captcha timeout 5             多少分钟未验证自动踢出
/captcha ban 600               踢出后封禁 600 秒
/captcha ban permanent         踢出后永久封禁
/captcha attempts 3            允许输错次数
/captcha welcome on|off        通过后是否发欢迎语
```

网页验证部署：机器人进程的 `WEB_PORT`（默认 8080）经 Nginx/Caddy 反代到公网 → 超管 `/config publicUrl https://bot.example.com` → 群里 `/captcha mode web`。
路由：`GET /verify/<token>`（页面）、`POST /verify/<token>/complete`（提交 proof）、`GET /healthz`。

---

## 六、关键词过滤

- 模式：`contains`（默认，抗变形） / `whole`（ASCII 词边界） / `regex`
- 动作：`delete` / `warn` / `mute` / `ban` / `kick`
- 抗变形：NFKC 全角折叠 + 去零宽/方向控制字符 + 小写合并空白 + 去标点「挤压」二次比对
- 警告累计到 `warnLimit` 自动升级为禁言/封禁/踢出
- `/testword <文本>` 直接试哪条规则会命中

---

## 七、代理（http / https / socks5）

支持三种代理，用于访问 `api.telegram.org`：

| 写法 | 说明 |
| --- | --- |
| `http://127.0.0.1:10808` | HTTP 代理（HTTPS 目标走 CONNECT 隧道） |
| `https://user:pass@host:443` | HTTPS 代理（到代理本身也加密） |
| `socks5://user:pass@127.0.0.1:1080` | SOCKS5（内置握手实现，支持用户名密码，域名交代理端解析） |
| `127.0.0.1:10808` | 省略协议时按 http 处理 |
| `off` / 空 | 直连 |

**配置优先级**：`/proxy` 写入数据库的设置 > 环境变量 `TG_PROXY`（也认 `ALL_PROXY / HTTPS_PROXY / HTTP_PROXY`）> 直连。

- 启动即读，**运行中 `/proxy` 切换立即生效**（下一条 API 调用就走新代理，无需重启），并自动做一次 `getMe` 连通性自检。
- 图片验证码等 multipart 上传也走同一代理（已用真实代理链路验证）。
- 代理密码会存进 `data/state.json`（自托管场景），日志与命令回显一律打码。

本次测试默认：`.env` 里已写入 `TG_PROXY=http://127.0.0.1:10808`。

---

## 八、热更新

| 场景 | 做法 | 是否停服 |
| --- | --- | --- |
| 改代码（开发） | `npm run dev`（tsx watch，改完自动重启） | 否 |
| 改代码（生产） | `npm run build:watch` + `npm run start:watch`（`node --watch dist/index.js`） | 否 |
| 改设置/关键词/验证配置 | 命令或面板改完即时生效（内存态 + 防抖落盘） | 否 |
| 切代理 | `/proxy <url>` | 否 |
| 改 `state.json`（手工/还原备份） | `/reload` 或 `kill -HUP <pid>` | 否 |

`/reload` 会重新读盘、重挂未完成验证的定时器、重新应用代理、重推命令菜单，并回显群数与验证数。

---

## 九、工程结构

```text
tg-guard-bot/
├─ src/
│  ├─ index.ts                  # 启动：token → 建 Bot → 打印 setup token → 验证服务 → 长轮询 / SIGHUP 热加载
│  ├─ config.ts                 # BOT_TOKEN 与少量运行参数（含 TG_PROXY）
│  ├─ net/
│  │  ├─ proxy.ts               # 代理地址解析（http/https/socks5、账号密码、打码展示）
│  │  └─ transport.ts           # undici 传输层：ProxyAgent + 自实现 SOCKS5 连接器 + 热切换 + grammY 兼容
│  ├─ captcha/
│  │  ├─ code.ts / png.ts       # 验证码生成 / 自研 PNG 编码器
│  │  ├─ service.ts             # 验证状态机（禁言 → 私聊 → 通过/超时 → 踢出+封禁 → 重启恢复）
│  │  └─ webServer.ts           # 网页 JS 验证（PoW）
│  ├─ core/                     # 归一化、匹配、检测、刷屏、统一处置
│  ├─ storage/                  # JSON 原子存储 + 仓储（档案/角色/群/关键词/验证记录）
│  └─ bot/                      # 装配、守卫、菜单、键盘、事件、命令
└─ test/                        # 121 个用例
```

---

## 十、开发与测试

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run dev         # tsx watch
npm run build       # 编译到 dist/
```

覆盖点：归一化抗变形、三种匹配模式、时长/参数解析、检测器、存储与 v1→v2 迁移、初始化 token 与角色权限、
设置面板回调、入群验证全流程（按钮/图像/私聊失败兜底/超时封禁/永久封禁/输错上限/重启恢复）、网页验证 PoW 与路由、
**代理解析与三种代理的真实转发**、**代理下 grammY init 与 multipart 上传**、`/proxy` 与 `/reload` 命令。

---

## 十一、常见问题

**私聊发不出去？** 用户必须先给机器人发过消息，否则 Telegram 禁止主动私聊 → 自动用群内按钮兜底。

**连不上 Telegram？** 配置 `TG_PROXY` 或用 `/proxy`；启动日志会打印 `Telegram 传输层就绪 {"proxy":"..."}`。token 无效会直接提示 401。

**匿名管理员发命令提示"不是管理员"？** 已修复。匿名管理员（以群组身份发言）与频道身份发言的消息，其 `from` 是 Telegram 的 GroupAnonymousBot（1087968824），不能拿它查成员权限。现在改为识别 `message.sender_chat`：只要 sender_chat 存在（群组本身或关联频道），就按管理员处理 —— 这类身份 Telegram 只允许管理员使用。同时这类发言也**不会被关键词误删**；回复它们的消息执行 /warn 之类会明确提示"无法定位具体用户"（Telegram 限制）。

**消息删不掉 / 禁言失败？** 需要「删除消息」「封禁成员」权限；超过 48 小时的消息删不掉；机器人账号只能删消息不能禁言。

**网页验证打不开？** 检查 `/config` 的 publicUrl 是否指向本机 `WEB_PORT`，反代是否放行 `/verify/*`。

**数据在哪？** `data/state.json`（防抖 + 原子写，损坏自动备份为 `.corrupt-<时间戳>`）。复制该文件即可备份，`/reload` 可热加载。

**发命令机器人没反应、日志报 can't parse entities？** 消息里出现了未转义的 `<` / `&`（比如群名里带 HTML）。代码里已全部转义，并且内置兜底：解析失败会自动降级为纯文本重发，不会静默失败。

**想先观察不真删？** `DRY_RUN=true`，日志打印 `[dry-run]`，统计照常累计。

---

## 十二、许可

仅供自行部署使用。请遵守 Telegram 服务条款与所在群群规。
