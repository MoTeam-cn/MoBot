import type { Bot, Context } from "grammy";
import type { BotDeps } from "../deps";
import type { Guards } from "../guards";
import type { GroupConfig, GroupSettings } from "../../types";
import { HELP_GROUP, HELP_PRIVATE, globalStatsText, menuText, settingsText } from "../../texts";
import {
  CAPTCHA_BAN_CYCLE,
  CAPTCHA_KICK_CYCLE,
  TOGGLE_SETTINGS,
  groupsKeyboard,
  privateMenuKeyboard,
  settingsKeyboard,
} from "../keyboards";
import { isChatAdmin } from "../../utils/telegram";
import { formatDateTime } from "../../utils/time";

const BUILTIN_CYCLE: GroupSettings["builtinAction"][] = ["delete", "warn", "mute", "ban", "kick"];
const ONWARN_CYCLE: GroupSettings["onWarnLimit"][] = ["mute", "ban", "kick"];
const MODE_CYCLE: GroupConfig["captcha"]["mode"][] = ["button", "image", "web"];

function cycle<T>(list: T[], current: T): T {
  const index = list.indexOf(current);
  return list[(index + 1) % list.length] as T;
}

async function editPanel(ctx: Context, group: GroupConfig): Promise<void> {
  try {
    await ctx.editMessageText(settingsText(group), {
      parse_mode: "HTML",
      reply_markup: settingsKeyboard(group),
      link_preview_options: { is_disabled: true },
    });
  } catch {
    // 内容未变化时 Telegram 会报错，忽略
  }
}

export function registerCallbacks(bot: Bot<Context>, deps: BotDeps, guards: Guards): void {
  // ---------- 入群验证按钮 ----------
  bot.callbackQuery(/^vfy:([A-Za-z0-9]+)$/, async (ctx) => {
    const token = ctx.match[1] ?? "";
    const result = await deps.captcha.verifyByToken(token, ctx.from.id);
    await ctx.answerCallbackQuery({
      text: result.message || (result.ok ? "已验证" : "验证失败"),
      show_alert: !result.ok,
    });
    if (result.ok) {
      const message = ctx.callbackQuery.message;
      if (message) await deps.moderator.deleteMessage(message.chat.id, message.message_id);
    }
  });

  // ---------- 群设置面板（群内 / 私聊通用） ----------
  bot.callbackQuery(/^cfg:(-?\d+):(.+)$/, async (ctx) => {
    const chatId = Number(ctx.match[1]);
    const op = ctx.match[2] ?? "";
    const group = deps.repo.getGroup(chatId);
    if (!group) {
      await ctx.answerCallbackQuery({ text: "该群已不在受管列表", show_alert: true });
      return;
    }
    const allowed = guards.isBotAdmin(ctx) || (await isChatAdmin(ctx.api, chatId, ctx.from.id));
    if (!allowed) {
      await ctx.answerCallbackQuery({ text: "🚫 只有管理员可以修改设置", show_alert: true });
      return;
    }

    if (op === "close") {
      await ctx.answerCallbackQuery();
      const message = ctx.callbackQuery.message;
      if (message) await deps.moderator.deleteMessage(message.chat.id, message.message_id);
      return;
    }

    let answer = "";
    if (op === "refresh" || op === "open") {
      answer = op === "open" ? "" : "已刷新";
    } else if (op === "flood") {
      group.antiflood.enabled = !group.antiflood.enabled;
      answer = "反刷屏：" + (group.antiflood.enabled ? "开" : "关");
    } else if (op === "cap") {
      group.captcha.enabled = !group.captcha.enabled;
      answer = "入群验证：" + (group.captcha.enabled ? "开" : "关");
    } else if (op === "capmode") {
      group.captcha.mode = cycle(MODE_CYCLE, group.captcha.mode);
      answer = "验证方式：" + group.captcha.mode;
    } else if (op === "capkick") {
      group.captcha.kickAfterMinutes = cycle(CAPTCHA_KICK_CYCLE, group.captcha.kickAfterMinutes);
      answer = "超时踢出：" + group.captcha.kickAfterMinutes + " 分钟";
    } else if (op === "capban") {
      group.captcha.banSeconds = cycle(CAPTCHA_BAN_CYCLE, group.captcha.banSeconds);
      answer =
        "失败封禁：" + (group.captcha.banSeconds > 0 ? group.captcha.banSeconds + " 秒" : "永久");
    } else if (op === "builtin") {
      group.settings.builtinAction = cycle(BUILTIN_CYCLE, group.settings.builtinAction);
      answer = "内置处置：" + group.settings.builtinAction;
    } else if (op === "onwarn") {
      group.settings.onWarnLimit = cycle(ONWARN_CYCLE, group.settings.onWarnLimit);
      answer = "警告上限动作：" + group.settings.onWarnLimit;
    } else if (op.startsWith("t:")) {
      const key = op.slice(2) as keyof GroupSettings;
      const toggle = TOGGLE_SETTINGS.find((item) => item.key === key);
      if (!toggle) {
        await ctx.answerCallbackQuery({ text: "未知设置项" });
        return;
      }
      const next = !Boolean(group.settings[key]);
      (group.settings as unknown as Record<string, boolean>)[key] = next;
      answer = toggle.label + "：" + (next ? "开" : "关");
    } else {
      await ctx.answerCallbackQuery();
      return;
    }

    deps.repo.persist();
    await ctx.answerCallbackQuery(answer ? { text: answer } : undefined);
    await editPanel(ctx, group);
  });

  // ---------- 私聊主菜单 ----------
  bot.callbackQuery(/^pm:(groups|admins|bans|help)$/, async (ctx) => {
    const op = ctx.match[1] ?? "";
    if (!guards.isBotAdmin(ctx)) {
      await ctx.answerCallbackQuery({ text: "🚫 仅管理员可用", show_alert: true });
      return;
    }
    if (op === "bans" && !guards.isSuperAdmin(ctx)) {
      await ctx.answerCallbackQuery({ text: "🚫 仅超管可查看", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();

    if (op === "groups") {
      const groups = deps.repo.listGroups();
      const text = groups.length
        ? "📋 选择要管理的群（" + groups.length + " 个）："
        : "还没有受管群。在群里发 /id 拿群 ID，然后 /addgroup <群ID>。";
      try {
        await ctx.editMessageText(text, { reply_markup: groups.length ? groupsKeyboard(groups) : undefined });
      } catch {
        // 忽略
      }
      return;
    }

    if (op === "admins") {
      const profile = deps.repo.profile;
      const lines = ["👤 <b>管理员</b>", "• 超级管理员：" + (profile.superAdmins.join(", ") || "无")];
      lines.push("• 普通管理员：" + (profile.admins.join(", ") || "无"));
      try {
        await ctx.editMessageText(lines.join("\n"), {
          parse_mode: "HTML",
          reply_markup: privateMenuKeyboard(),
        });
      } catch {
        // 忽略
      }
      return;
    }

    if (op === "bans") {
      const bans = deps.repo.state.globalBans;
      const ids = Object.keys(bans);
      const lines = ["🚫 <b>全局封禁（" + ids.length + "）</b>"];
      for (const id of ids.slice(0, 30)) {
        const entry = bans[id];
        if (!entry) continue;
        lines.push("• <code>" + id + "</code> · " + formatDateTime(entry.at));
      }
      try {
        await ctx.editMessageText(ids.length ? lines.join("\n") : "全局封禁名单为空。", {
          parse_mode: "HTML",
          reply_markup: privateMenuKeyboard(),
        });
      } catch {
        // 忽略
      }
      return;
    }

    try {
      await ctx.editMessageText(HELP_PRIVATE, {
        parse_mode: "HTML",
        reply_markup: privateMenuKeyboard(),
        link_preview_options: { is_disabled: true },
      });
    } catch {
      // 忽略
    }
  });
}

export { HELP_GROUP, globalStatsText, menuText };
