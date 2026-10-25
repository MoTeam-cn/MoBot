# MoBot

Telegram 群组 **关键词过滤 + 入群验证 + 群管理** 机器人，Node.js + TypeScript + [grammY](https://grammy.dev)。

## 功能

- **关键词过滤**：命中即撤回消息，可按规则警告 / 禁言 / 封禁；抗「广 告」「ＶＸ」「广\u200b告」等变形写法
- **入群验证**：入群先禁言 → 私聊验证（按钮 / 图像验证码 / 网页 JS）→ 超时踢出并按配置封禁（支持永久）
- **群管理**：反链接、反转发、反刷屏、警告系统、信任名单、入群欢迎、日志频道、统计
- **零配置初始化**：首次启动在控制台打印一次性 token，私聊 `/setup <token>` 的第一个人自动成为超管
- **代理**：http / https / socks5，`/proxy` 运行时热切换
- **热更新**：`/reload` 热加载数据、设置即时生效、`node --watch` 热重启

## 快速开始

```bash
npm install
copy .env.example .env     # 只需填 BOT_TOKEN
npm run build && npm start
```

启动后按控制台提示，私聊机器人发送 `/setup <token>` 完成初始化，然后：

1. 把机器人拉进群 → 设为管理员（勾选「删除消息」「封禁成员」）
2. 群里发 `/id` 拿到群 ID
3. 私聊 `/addgroup <群ID>` 登记受管群
4. 群里 `/settings` 开面板、`/captcha on` 开验证、`/addword 广告 --action mute` 加关键词

## 常用命令

| 场景 | 命令 |
| --- | --- |
| 初始化 | `/setup <token>` |
| 受管群 | `/groups` · `/addgroup <群ID>` · `/delgroup <群ID>` |
| 管理员 | `/admins` · `/addadmin <ID>` · `/deladmin <ID>` |
| 关键词 | `/addword <词> [--action mute]` · `/delword` · `/words` · `/testword` |
| 入群验证 | `/captcha on` · `/captcha mode button\|image\|web` · `/captcha timeout 5` · `/captcha ban 600\|permanent` |
| 群设置 | `/settings` · `/set <项> <值>` |
| 成员管理 | `/warn` · `/mute` · `/kick` · `/ban` · `/purge` · `/pin` · `/trust` |
| 全局封禁 | `/gban <用户>` · `/ungban` · `/glist` |
| 运维 | `/proxy <url\|off>` · `/reload` · `/config` · `/init` |

## 文档

完整文档（架构、验证流程、代理与热更新细节、常见问题）在 [`v1`](../../tree/v1) 分支的 README。

## 许可

Apache License 2.0，见 [LICENSE](./LICENSE)。
