import type { Bot, Context } from "grammy";
import type { BotDeps } from "../deps";
import type { Guards } from "../guards";
import { requireTarget } from "../targets";
import { parseDuration, humanizeDuration, formatDateTime } from "../../utils/time";
import { escapeHtml, userLink } from "../../utils/telegram";

export function registerModerationCommands(bot: Bot<Context>, deps: BotDeps, guards: Guards): void {
  const chain = [guards.managedGroup, guards.groupAdmin];

  bot.command("warn", ...chain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const group = deps.repo.getGroup(chatId);
    if (!group) return;
    const raw = (ctx.match ?? "").trim();
    const first = raw.split(/\s+/)[0] ?? "";
    const target = await requireTarget(ctx, first);
    if (!target) return;
    const reason = raw.split(/\s+/).slice(1).join(" ") || "管理员手动警告";

    const outcome = await deps.moderator.punish({
      chatId,
      userId: target.id,
      userName: target.name,
      action: "warn",
      reason,
    });
    const lines = [`⚠️ 已警告 ${escapeHtml(target.name)}`];
    if (outcome.escalatedTo) {
      lines.push(`已达上限（${group.warnLimit} 次），自动执行：${outcome.escalatedTo}`);
    } else {
      lines.push(`当前警告：${outcome.warnCount}/${outcome.warnLimit}`);
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("warns", ...chain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const group = deps.repo.getGroup(chatId);
    if (!group) return;
    const raw = (ctx.match ?? "").trim();
    const entries = Object.values(group.warnings).sort((a, b) => b.count - a.count);
    if (!entries.length) {
      await ctx.reply("ℹ️ 当前没有用户处于警告状态。");
      return;
    }
    const lines = [`⚠️ <b>警告记录</b>（上限 ${group.warnLimit} 次）`];
    for (const entry of entries.slice(0, 30)) {
      const reason = entry.lastReason ? " · " + escapeHtml(entry.lastReason) : "";
      lines.push(
        `• <code>${entry.userId}</code>：${entry.count} 次 · ${formatDateTime(entry.updatedAt)}${reason}`,
      );
    }
    if (raw) lines.push("", `提示：/unwarn 可清除某人警告`);
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("unwarn", ...chain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const first = (ctx.match ?? "").trim().split(/\s+/)[0] ?? "";
    const target = await requireTarget(ctx, first);
    if (!target) return;
    const removed = deps.repo.resetWarnings(chatId, target.id);
    await ctx.reply(`✅ 已清除 ${escapeHtml(target.name)} 的 ${removed} 次警告。`, {
      parse_mode: "HTML",
    });
  });

  bot.command("resetwarns", ...chain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const count = deps.repo.resetAllWarnings(chatId);
    await ctx.reply(`✅ 已清空本群全部警告记录（${count} 人）。`, { parse_mode: "HTML" });
  });

  bot.command("mute", ...chain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const group = deps.repo.getGroup(chatId);
    if (!group) return;
    const raw = (ctx.match ?? "").trim();
    const parts = raw.split(/\s+/).filter(Boolean);
    let seconds = group.muteSeconds;
    let reason = "管理员手动禁言";
    if (parts.length) {
      const parsed = parseDuration(parts[0]);
      if (parsed) {
        seconds = parsed;
        reason = parts.slice(1).join(" ") || reason;
      } else {
        reason = parts.join(" ") || reason;
      }
    }
    const target = await requireTarget(ctx);
    if (!target) return;
    const ok = await deps.moderator.mute(chatId, target.id, seconds);
    await deps.moderator.log(
      `🔇 禁言 · ${escapeHtml(group.title)}` + "\n" + `• 用户：${userLink(target.id, target.name)} (${target.id})` + "\n" + `• 时长：${humanizeDuration(seconds)} · 原因：${escapeHtml(reason)}`,
      group,
    );
    await ctx.reply(
      ok
        ? `🔇 已禁言 ${escapeHtml(target.name)} ${humanizeDuration(seconds)}`
        : "⚠️ 禁言失败，请检查机器人权限（需要「封禁成员」权限）。",
      { parse_mode: "HTML" },
    );
  });

  bot.command("unmute", ...chain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const target = await requireTarget(ctx, (ctx.match ?? "").trim().split(/\s+/)[0]);
    if (!target) return;
    const ok = await deps.moderator.unmute(chatId, target.id);
    await ctx.reply(ok ? `🔊 已解除 ${escapeHtml(target.name)} 的禁言。` : "⚠️ 解除禁言失败。", {
      parse_mode: "HTML",
    });
  });

  bot.command("kick", ...chain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const group = deps.repo.getGroup(chatId);
    if (!group) return;
    const reason = (ctx.match ?? "").trim() || "管理员手动踢出";
    const target = await requireTarget(ctx);
    if (!target) return;
    const reply = ctx.message?.reply_to_message;
    if (reply) await deps.moderator.purgeOne(chatId, reply.message_id);
    const ok = await deps.moderator.kick(chatId, target.id);
    await deps.moderator.log(
      `👢 踢出 · ${escapeHtml(group.title)}` + "\n" + `• 用户：${userLink(target.id, target.name)} (${target.id})` + "\n" + `• 原因：${escapeHtml(reason)}`,
      group,
    );
    await ctx.reply(ok ? `👢 已踢出 ${escapeHtml(target.name)}。` : "⚠️ 踢出失败，请检查机器人权限。", {
      parse_mode: "HTML",
    });
  });

  bot.command("ban", ...chain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const group = deps.repo.getGroup(chatId);
    if (!group) return;
    const reason = (ctx.match ?? "").trim() || "管理员手动封禁";
    const target = await requireTarget(ctx);
    if (!target) return;
    const reply = ctx.message?.reply_to_message;
    if (reply) await deps.moderator.purgeOne(chatId, reply.message_id);
    const ok = await deps.moderator.ban(chatId, target.id);
    await deps.moderator.log(
      `⛔ 封禁 · ${escapeHtml(group.title)}` + "\n" + `• 用户：${userLink(target.id, target.name)} (${target.id})` + "\n" + `• 原因：${escapeHtml(reason)}`,
      group,
    );
    await ctx.reply(ok ? `⛔ 已封禁 ${escapeHtml(target.name)}。` : "⚠️ 封禁失败，请检查机器人权限。", {
      parse_mode: "HTML",
    });
  });

  bot.command("unban", ...chain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const target = await requireTarget(ctx, (ctx.match ?? "").trim().split(/\s+/)[0]);
    if (!target) return;
    const ok = await deps.moderator.unban(chatId, target.id);
    await ctx.reply(ok ? `✅ 已解封 ${escapeHtml(target.name)}。` : "⚠️ 解封失败。", {
      parse_mode: "HTML",
    });
  });

  bot.command("purge", ...chain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const raw = (ctx.match ?? "").trim();
    const reply = ctx.message?.reply_to_message;
    const currentId = ctx.message!.message_id;

    const ids: number[] = [];
    if (reply) {
      const from = Math.min(reply.message_id, currentId);
      const to = Math.max(reply.message_id, currentId);
      for (let id = from; id <= to && ids.length < 200; id += 1) ids.push(id);
    } else {
      const count = Number(raw);
      if (!Number.isInteger(count) || count < 1 || count > 200) {
        await ctx.reply("⚠️ 用法：/purge <1-200>，或回复某条消息后发送 /purge 清理到该消息为止。");
        return;
      }
      for (let offset = 0; offset < count; offset += 1) ids.push(currentId - offset);
    }
    const deleted = await deps.moderator.deleteMessages(chatId, ids);
    deps.repo.bumpStats(chatId, "deleted", deleted);
    await deps.moderator.notify(chatId, `🧹 已清理 ${deleted} 条消息`);
  });

  bot.command("pin", ...chain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const reply = ctx.message?.reply_to_message;
    const messageId = reply?.message_id;
    if (!messageId) {
      await ctx.reply("⚠️ 请回复要置顶的消息后再发送 /pin。");
      return;
    }
    try {
      await ctx.api.pinChatMessage(chatId, messageId, { disable_notification: true });
      await ctx.reply("📌 已置顶。");
    } catch {
      await ctx.reply("⚠️ 置顶失败，请检查机器人是否有「置顶消息」权限。");
    }
  });

  bot.command("unpin", ...chain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const reply = ctx.message?.reply_to_message;
    try {
      await ctx.api.unpinChatMessage(chatId, reply?.message_id);
      await ctx.reply("📌 已取消置顶。");
    } catch {
      await ctx.reply("⚠️ 取消置顶失败。");
    }
  });

  bot.command("trust", ...chain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const target = await requireTarget(ctx, (ctx.match ?? "").trim().split(/\s+/)[0]);
    if (!target) return;
    if (deps.repo.isTrusted(chatId, target.id)) {
      await ctx.reply(`ℹ️ ${escapeHtml(target.name)} 已在信任名单中。`, { parse_mode: "HTML" });
      return;
    }
    deps.repo.addTrusted(chatId, target.id);
    await ctx.reply(`✅ 已将 ${escapeHtml(target.name)}（<code>${target.id}</code>）加入信任名单，不再被过滤。`, {
      parse_mode: "HTML",
    });
  });

  bot.command("untrust", ...chain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const target = await requireTarget(ctx, (ctx.match ?? "").trim().split(/\s+/)[0]);
    if (!target) return;
    const removed = deps.repo.removeTrusted(chatId, target.id);
    await ctx.reply(
      removed
        ? `✅ 已将 ${escapeHtml(target.name)} 移出信任名单。`
        : "ℹ️ 该用户不在信任名单中。",
      { parse_mode: "HTML" },
    );
  });

  bot.command("trusted", ...chain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const group = deps.repo.getGroup(chatId);
    if (!group) return;
    if (!group.trustedUserIds.length) {
      await ctx.reply("ℹ️ 信任名单为空。回复某人消息并发送 /trust 可加入。");
      return;
    }
    const lines = [`✅ <b>信任名单（${group.trustedUserIds.length}）</b>`];
    for (const id of group.trustedUserIds) lines.push(`• <code>${id}</code>`);
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });
}
