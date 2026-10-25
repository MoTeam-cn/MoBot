import type { Bot, Context } from "grammy";
import type { BotDeps } from "../deps";
import type { Guards } from "../guards";
import { escapeHtml } from "../../utils/telegram";
import { formatDateTime } from "../../utils/time";
import { requireTarget } from "../targets";
import { groupsKeyboard } from "../keyboards";

export function registerGroupCommands(bot: Bot<Context>, deps: BotDeps, guards: Guards): void {
  bot.command("addgroup", guards.superAdminOnly, async (ctx) => {
    const arg = (ctx.match ?? "").trim();
    let chatId: number | undefined;
    if (arg) {
      const parsed = Number(arg);
      if (!Number.isSafeInteger(parsed) || parsed === 0) {
        await ctx.reply("⚠️ 用法：/addgroup <群ID>（群 ID 形如 -1001234567890）");
        return;
      }
      chatId = parsed;
    } else if (ctx.chat && ctx.chat.type !== "private") {
      chatId = ctx.chat.id;
    }
    if (!chatId) {
      await ctx.reply("⚠️ 用法：/addgroup <群ID>，或在目标群内直接发送 /addgroup");
      return;
    }

    let title = String(chatId);
    let type = "unknown";
    try {
      const chat = await ctx.api.getChat(chatId);
      type = chat.type;
      title = "title" in chat && chat.title ? chat.title : String(chatId);
    } catch {
      await ctx.reply("⚠️ 无法获取该群信息，请确认机器人已在群内且 ID 正确。");
      return;
    }
    if (type !== "group" && type !== "supergroup") {
      await ctx.reply("⚠️ 只能添加群组或超级群。");
      return;
    }
    if (deps.repo.hasGroup(chatId)) {
      await ctx.reply("ℹ️ 该群已在受管列表中。");
      return;
    }

    deps.repo.ensureGroup(chatId, title, ctx.from?.id);

    let rightsHint = "";
    try {
      const me = await ctx.api.getChatMember(chatId, ctx.me.id);
      const isAdmin = me.status === "administrator" || me.status === "creator";
      const canDelete = me.status === "administrator" && me.can_delete_messages;
      const canRestrict = me.status === "administrator" && me.can_restrict_members;
      if (!isAdmin) rightsHint = "\n⚠️ 机器人还不是该群管理员，无法删除消息，请先授予管理员权限。";
      else if (!canDelete || !canRestrict) rightsHint = "\n⚠️ 建议给机器人开启「删除消息」和「封禁成员」权限。";
    } catch {
      rightsHint = "\n⚠️ 无法确认机器人在群内的权限，请检查是否已加入该群。";
    }

    const lines = [
      "✅ 已添加受管群",
      `• 群名：${escapeHtml(title)}`,
      `• ID：<code>${chatId}</code>`,
    ];
    const text = lines.join("\n") + rightsHint + "\n\n建议下一步：\n1. 在群里发送 /settings 检查开关\n2. 用 /addword 添加要拦截的关键词";
    await ctx.reply(text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("delgroup", guards.superAdminOnly, async (ctx) => {
    const arg = (ctx.match ?? "").trim();
    const chatId = arg ? Number(arg) : ctx.chat && ctx.chat.type !== "private" ? ctx.chat.id : NaN;
    if (!Number.isSafeInteger(chatId) || chatId === 0) {
      await ctx.reply("⚠️ 用法：/delgroup <群ID>");
      return;
    }
    if (!deps.repo.removeGroup(chatId)) {
      await ctx.reply("ℹ️ 该群不在受管列表中。");
      return;
    }
    await ctx.reply(`🗑 已移除受管群 <code>${chatId}</code>，机器人不再处理该群消息。`, {
      parse_mode: "HTML",
    });
  });

  bot.command("groups", guards.superAdminOnly, async (ctx) => {
    const groups = deps.repo.listGroups();
    if (!groups.length) {
      await ctx.reply("ℹ️ 还没有受管群。在目标群发送 /id 获取群 ID 后，用 /addgroup 添加。");
      return;
    }
    const lines = [`📋 <b>受管群（${groups.length}）</b>`];
    for (const group of groups) {
      lines.push(`• <b>${escapeHtml(group.title || String(group.chatId))}</b>`);
      lines.push(
        `  ID：<code>${group.chatId}</code> · 关键词 ${group.keywords.length} 条 · 已删 ${group.stats.deleted} 条`,
      );
    }
    const isPrivateChat = ctx.chat?.type === "private";
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: isPrivateChat ? groupsKeyboard(groups) : undefined,
    });
  });

  bot.command("gban", guards.superAdminOnly, async (ctx) => {
    const args = (ctx.match ?? "").trim();
    const first = args.split(/\s+/)[0];
    const reason = args.split(/\s+/).slice(1).join(" ") || undefined;
    const target = await requireTarget(ctx, first);
    if (!target) return;
    if (deps.repo.isSuperAdmin(target.id)) {
      await ctx.reply("⚠️ 不能封禁超级管理员。");
      return;
    }
    if (!deps.repo.addGlobalBan(target.id, ctx.from?.id, reason)) {
      await ctx.reply("ℹ️ 该用户已在全局封禁名单中。");
      return;
    }
    let banned = 0;
    for (const group of deps.repo.listGroups()) {
      if (await deps.moderator.ban(group.chatId, target.id)) banned += 1;
    }
    await ctx.reply(
      `🚫 已全局封禁 ${escapeHtml(target.name)}（<code>${target.id}</code>），已在 ${banned} 个群执行。`,
      { parse_mode: "HTML" },
    );
  });

  bot.command("ungban", guards.superAdminOnly, async (ctx) => {
    const first = (ctx.match ?? "").trim().split(/\s+/)[0];
    const target = await requireTarget(ctx, first);
    if (!target) return;
    if (!deps.repo.removeGlobalBan(target.id)) {
      await ctx.reply("ℹ️ 该用户不在全局封禁名单中。");
      return;
    }
    for (const group of deps.repo.listGroups()) {
      await deps.moderator.unban(group.chatId, target.id);
    }
    await ctx.reply(`✅ 已解除 ${escapeHtml(target.name)}（<code>${target.id}</code>）的全局封禁。`, {
      parse_mode: "HTML",
    });
  });

  bot.command("glist", guards.superAdminOnly, async (ctx) => {
    const bans = deps.repo.state.globalBans;
    const ids = Object.keys(bans);
    if (!ids.length) {
      await ctx.reply("ℹ️ 全局封禁名单为空。");
      return;
    }
    const lines = [`🚫 <b>全局封禁（${ids.length}）</b>`];
    for (const id of ids.slice(0, 50)) {
      const entry = bans[id];
      if (!entry) continue;
      const reason = entry.reason ? " · " + escapeHtml(entry.reason) : "";
      lines.push(`• <code>${id}</code> · ${formatDateTime(entry.at)}${reason}`);
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });
}
