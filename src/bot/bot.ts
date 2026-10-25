import { Bot, GrammyError, HttpError } from "grammy";
import type { Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { BotDeps } from "./deps";
import { createGuards } from "./guards";
import { registerCommands } from "./commands/index";
import { createMessageGuard } from "./events/messageGuard";
import { registerJoinHandlers } from "./events/joins";
import { escapeHtml } from "../utils/telegram";
import { createHtmlFallbackTransformer } from "./htmlFallback";

export const ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "callback_query",
  "chat_member",
  "my_chat_member",
] as const;

export interface CreateBotOptions {
  /** 注入 botInfo，便于离线测试（跳过 getMe） */
  botInfo?: UserFromGetMe;
}

/**
 * 组装机器人：
 * 未初始化拦截 → 命令消息清理 → 命令 → 入群事件 → 图像验证码文本 → 消息过滤。
 */
export function createBot(deps: BotDeps, options: CreateBotOptions = {}): Bot<Context> {
  const bot = new Bot<Context>(deps.config.botToken, {
    ...(options.botInfo ? { botInfo: options.botInfo } : {}),
    // 自定义 fetch：支持 http / https / socks5 代理，并可在运行时热切换
    client: { fetch: deps.transport.fetch as unknown as typeof fetch },
  });
  deps.moderator.attachApi(bot.api);
  deps.captcha.attachApi(bot.api);
  deps.bot = bot;

  // HTML 解析失败自动降级为纯文本（最先注册，位于 API 调用最内层）
  bot.api.config.use(createHtmlFallbackTransformer(deps.logger));

  const guards = createGuards(deps);

  // 未初始化：只允许 /setup /start /help /id
  bot.use(async (ctx, next) => {
    if (deps.repo.isInitialized()) return next();
    const text = ctx.message?.text ?? "";
    if (/^\/(setup|start|help|id)(@\w+)?(\s|$)/.test(text)) return next();
    if (!ctx.chat) return next();
    await ctx
      .reply("⚠️ 机器人尚未初始化。\n请在服务器控制台查看初始化 token，然后私聊我发送：/setup <token>")
      .catch(() => undefined);
  });

  // 可选：自动删除群内命令消息
  bot.use(async (ctx, next) => {
    const message = ctx.message;
    const chat = ctx.chat;
    if (message?.text?.startsWith("/") && chat && (chat.type === "group" || chat.type === "supergroup")) {
      const group = deps.repo.getGroup(chat.id);
      if (group?.settings.deleteCommandMessages) {
        deps.moderator.scheduleDelete(chat.id, message.message_id, 5);
      }
    }
    return next();
  });

  registerCommands(bot, deps, guards);
  registerJoinHandlers(bot, deps);

  // 图像验证码：私聊/群内回复验证码
  bot.on("message:text", async (ctx, next) => {
    const from = ctx.from;
    const text = (ctx.message.text ?? "").trim();
    if (!from || from.is_bot || !text || text.startsWith("/")) return next();
    const pending = deps.captcha.pendingFor(from.id);
    if (!pending || pending.mode !== "image") return next();
    if (!/^[A-Za-z0-9]{4,8}$/.test(text)) return next();

    const chatId = ctx.chat?.type === "private" ? undefined : ctx.chat?.id;
    const result = await deps.captcha.verifyByCode(from.id, text, chatId);
    if (!result.message) return next();
    await ctx.reply(result.message).catch(() => undefined);
  });

  // 机器人被拉入/移出群
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;
    const chat = update.chat;
    const status = update.new_chat_member.status;
    if (chat.type === "private") return;

    if (status === "member" || status === "administrator") {
      const title = "title" in chat && chat.title ? chat.title : String(chat.id);
      deps.logger.info("机器人加入群组", { chatId: chat.id, title, status });
      if (!deps.repo.hasGroup(chat.id)) {
        const text = [
          "🤖 我已加入 <b>" + escapeHtml(title) + "</b>",
          "群 ID：<code>" + chat.id + "</code>",
          "",
          "请把我设为管理员（需要「删除消息」「封禁成员」权限），",
          "然后由超管私聊我执行：",
          "<code>/addgroup " + chat.id + "</code>",
        ].join("\n");
        for (const adminId of [...deps.repo.profile.superAdmins, ...deps.repo.profile.admins]) {
          await ctx.api
            .sendMessage(adminId, text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } })
            .catch(() => undefined);
        }
      }
      return;
    }

    if (status === "left" || status === "kicked") {
      deps.logger.info("机器人离开群组", { chatId: chat.id, status });
    }
  });

  // 关键词 / 链接 / 刷屏等过滤（放最后）
  bot.on("message", createMessageGuard(deps));

  bot.catch((err) => {
    const ctx = err.ctx;
    const error = err.error;
    if (error instanceof GrammyError) {
      if (error.error_code === 403 || /message to delete not found|not enough rights/i.test(error.description)) {
        deps.logger.debug("Telegram 拒绝操作", { updateId: ctx.update.update_id, description: error.description });
        return;
      }
      deps.logger.error("Telegram API 错误", { description: error.description, payload: error.payload });
      return;
    }
    if (error instanceof HttpError) {
      deps.logger.error("网络错误", { error: String(error) });
      return;
    }
    deps.logger.error("未捕获的处理异常", { error: error instanceof Error ? error.stack : String(error) });
  });

  return bot;
}
