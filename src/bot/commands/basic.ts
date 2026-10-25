import type { Bot, Context } from "grammy";
import type { BotDeps } from "../deps";
import { isPrivateContext, type Guards } from "../guards";
import { HELP_GROUP, HELP_PRIVATE, globalStatsText, startText, statsText } from "../../texts";
import { displayName, escapeHtml, isPrivilegedSender, senderLabel, userLink } from "../../utils/telegram";

function escapeText(input: string): string {
  const text = input.length > 200 ? input.slice(0, 200) + "…" : input;
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function registerBasicCommands(bot: Bot<Context>, deps: BotDeps, guards: Guards): void {
  bot.command("start", async (ctx) => {
    await ctx.reply(startText(deps.repo.isInitialized(), guards.isSuperAdmin(ctx), guards.isBotAdmin(ctx)), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command("help", async (ctx) => {
    const text = isPrivateContext(ctx) ? HELP_PRIVATE : HELP_GROUP;
    await ctx.reply(text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("id", async (ctx) => {
    const lines: string[] = ["🆔 <b>ID 信息</b>"];
    if (ctx.chat) {
      const title = "title" in ctx.chat ? ctx.chat.title : undefined;
      const chatLabel = title ? escapeHtml(title) + "（" + ctx.chat.type + "）" : ctx.chat.type;
      lines.push("• 会话：" + chatLabel);
      lines.push("• 会话 ID：<code>" + ctx.chat.id + "</code>");
    }
    if (ctx.from) {
      lines.push("• 你的 ID：<code>" + ctx.from.id + "</code>");
      if (ctx.from.username) lines.push("• 你的用户名：@" + ctx.from.username);
    }
    const senderChat = ctx.message?.sender_chat;
    if (senderChat && ctx.chat && (ctx.chat.type === "group" || ctx.chat.type === "supergroup")) {
      const anonymous = senderChat.id === ctx.chat.id;
      lines.push(
        "• 发言身份：" +
          (anonymous
            ? "匿名管理员（以群组身份发言）"
            : "频道身份：" + escapeHtml(senderChat.title ?? String(senderChat.id))),
      );
    }
    const reply = ctx.message?.reply_to_message;
    if (reply?.from) {
      lines.push("• 被回复者：" + displayName(reply.from) + "（<code>" + reply.from.id + "</code>）");
    }
    const origin = ctx.message?.forward_origin;
    if (origin) {
      if (origin.type === "channel") {
        lines.push(
          "• 转发来源频道：" + escapeHtml(String(origin.chat.title ?? origin.chat.id)) + "（<code>" + origin.chat.id + "</code>）",
        );
      } else if (origin.type === "chat") {
        lines.push(
          "• 转发来源群：" +
            escapeHtml(String(origin.sender_chat.title ?? origin.sender_chat.id)) +
            "（<code>" +
            origin.sender_chat.id +
            "</code>）",
        );
      } else if (origin.type === "user") {
        lines.push("• 转发来源用户：" + displayName(origin.sender_user) + "（<code>" + origin.sender_user.id + "</code>）");
      } else {
        lines.push("• 转发来源：隐藏用户");
      }
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("stats", async (ctx) => {
    if (isPrivateContext(ctx)) {
      if (!guards.isBotAdmin(ctx)) {
        await ctx.reply("🚫 仅管理员可查看全局统计。");
        return;
      }
      const profile = deps.repo.profile;
      const adminCount = profile.superAdmins.length + profile.admins.length;
      await ctx.reply(
        globalStatsText(deps.repo.listGroups(), new Array(adminCount).fill(0), deps.repo.listGlobalBans().length),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
      );
      return;
    }
    const group = ctx.chat ? deps.repo.getGroup(ctx.chat.id) : undefined;
    if (!group) {
      await ctx.reply("⚠️ 本群尚未加入受管列表，先由超管执行 /addgroup。");
      return;
    }
    await ctx.reply(statsText(group), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("report", guards.managedGroup, async (ctx) => {
    const chatId = ctx.chat!.id;
    const group = deps.repo.getGroup(chatId);
    if (!group) return;
    const reply = ctx.message?.reply_to_message;
    if (!reply) {
      await ctx.reply("⚠️ 请回复要举报的消息后再发送 /report。");
      return;
    }
    const reporter = isPrivilegedSender(ctx.message)
      ? escapeHtml(senderLabel(ctx.message))
      : ctx.from
        ? userLink(ctx.from.id, displayName(ctx.from))
        : "群成员";
    const admins = await deps.adminCache.get(ctx.api, chatId);
    const mentions = [...admins].slice(0, 5).map((id) => userLink(id, "管理员")).join(" ");
    const lines = ["🚨 " + reporter + " 举报了一条消息"];
    if (mentions) lines.push(mentions + " 请查看");
    lines.push("原消息：" + (reply.text ? escapeText(reply.text) : "（非文本内容）"));
    await deps.moderator.notify(chatId, lines.join("\n"), reply.message_id);
    const logLines = [
      "🚨 举报 · " + group.title,
      "• 举报人：" + displayName(ctx.from) + " (" + (ctx.from?.id ?? 0) + ")",
      "• 被举报者：" + displayName(reply.from),
    ];
    await deps.moderator.log(logLines.join("\n"), group);
  });
}
