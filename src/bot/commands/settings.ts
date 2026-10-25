import type { Bot, Context } from "grammy";
import type { BotDeps } from "../deps";
import type { Guards } from "../guards";
import type { CaptchaMode, GroupConfig, GroupSettings } from "../../types";
import { captchaText, settingsText } from "../../texts";
import { settingsKeyboard, TOGGLE_SETTINGS } from "../keyboards";
import { parseArgs } from "../../utils/args";
import { parseDuration, humanizeDuration } from "../../utils/time";
import { ACTION_LABEL, CAPTCHA_MODE_LABEL } from "../../utils/labels";

const BOOL_TRUE = ["1", "on", "true", "yes", "开", "启用", "开启"];
const BOOL_FALSE = ["0", "off", "false", "no", "关", "关闭", "禁用"];

export function parseBool(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (BOOL_TRUE.includes(value)) return true;
  if (BOOL_FALSE.includes(value)) return false;
  return null;
}

const BOOL_SETTINGS: (keyof GroupSettings)[] = TOGGLE_SETTINGS.map((item) => item.key);
const CAPTCHA_MODES: CaptchaMode[] = ["button", "image", "web"];

export interface ApplyResult {
  ok: boolean;
  message: string;
}

/** 应用一条 /set 设置 */
export function applySetting(group: GroupConfig, key: string, value: string): ApplyResult {
  const name = key.trim().toLowerCase();

  if (BOOL_SETTINGS.includes(name as keyof GroupSettings)) {
    const parsed = parseBool(value);
    if (parsed === null) return { ok: false, message: "⚠️ 该设置需要 on/off" };
    (group.settings as unknown as Record<string, boolean>)[name] = parsed;
    return { ok: true, message: "✅ " + name + " = " + (parsed ? "on" : "off") };
  }

  switch (name) {
    case "antiflood.enabled":
    case "antiflood": {
      const parsed = parseBool(value);
      if (parsed === null) return { ok: false, message: "⚠️ 该设置需要 on/off" };
      group.antiflood.enabled = parsed;
      return { ok: true, message: "✅ 反刷屏 = " + (parsed ? "on" : "off") };
    }
    case "builtinaction":
    case "builtin.action": {
      const parsed = value.trim().toLowerCase();
      if (!["delete", "warn", "mute", "ban", "kick"].includes(parsed)) {
        return { ok: false, message: "⚠️ 可选值：delete / warn / mute / ban / kick" };
      }
      group.settings.builtinAction = parsed as GroupSettings["builtinAction"];
      return { ok: true, message: "✅ 内置检测处置 = " + (ACTION_LABEL[parsed] ?? parsed) };
    }
    case "onwarnlimit":
    case "onwarn": {
      const parsed = value.trim().toLowerCase();
      if (!["mute", "ban", "kick"].includes(parsed)) {
        return { ok: false, message: "⚠️ 可选值：mute / ban / kick" };
      }
      group.settings.onWarnLimit = parsed as GroupSettings["onWarnLimit"];
      return { ok: true, message: "✅ 警告上限动作 = " + (ACTION_LABEL[parsed] ?? parsed) };
    }
    case "warnlimit": {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
        return { ok: false, message: "⚠️ warnLimit 需为 1-20 的整数" };
      }
      group.warnLimit = parsed;
      return { ok: true, message: "✅ 警告上限 = " + parsed + " 次" };
    }
    case "muteseconds":
    case "mute": {
      const seconds = parseDuration(value);
      if (!seconds) return { ok: false, message: "⚠️ 时长格式无效，例如 10m / 2h / 1d" };
      group.muteSeconds = seconds;
      return { ok: true, message: "✅ 默认禁言时长 = " + humanizeDuration(seconds) };
    }
    case "antiflood.maxmessages":
    case "flood.max": {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 2 || parsed > 60) {
        return { ok: false, message: "⚠️ 反刷屏阈值需为 2-60 的整数" };
      }
      group.antiflood.maxMessages = parsed;
      return { ok: true, message: "✅ 反刷屏阈值 = " + parsed + " 条" };
    }
    case "antiflood.windowseconds":
    case "flood.window": {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3600) {
        return { ok: false, message: "⚠️ 统计窗口需为 1-3600 秒" };
      }
      group.antiflood.windowSeconds = parsed;
      return { ok: true, message: "✅ 反刷屏窗口 = " + parsed + " 秒" };
    }
    case "antiflood.muteseconds":
    case "flood.mute": {
      const seconds = parseDuration(value);
      if (!seconds) return { ok: false, message: "⚠️ 时长格式无效，例如 5m / 1h" };
      group.antiflood.muteSeconds = seconds;
      return { ok: true, message: "✅ 刷屏禁言时长 = " + humanizeDuration(seconds) };
    }
    // ---------- 入群验证 ----------
    case "captcha.enabled":
    case "captcha": {
      const parsed = parseBool(value);
      if (parsed === null) return { ok: false, message: "⚠️ 需要 on/off" };
      group.captcha.enabled = parsed;
      return { ok: true, message: "✅ 入群验证 = " + (parsed ? "on" : "off") };
    }
    case "captcha.mode":
    case "captchamode": {
      const parsed = value.trim().toLowerCase() as CaptchaMode;
      if (!CAPTCHA_MODES.includes(parsed)) {
        return { ok: false, message: "⚠️ 可选值：button / image / web" };
      }
      group.captcha.mode = parsed;
      return { ok: true, message: "✅ 验证方式 = " + (CAPTCHA_MODE_LABEL[parsed] ?? parsed) };
    }
    case "captcha.timeout":
    case "captcha.kickafterminutes": {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1440) {
        return { ok: false, message: "⚠️ 超时分钟数需为 1-1440 的整数" };
      }
      group.captcha.kickAfterMinutes = parsed;
      return { ok: true, message: "✅ 超时踢出 = " + parsed + " 分钟" };
    }
    case "captcha.ban":
    case "captcha.banseconds": {
      const raw = value.trim().toLowerCase();
      if (["permanent", "forever", "永久", "0"].includes(raw)) {
        group.captcha.banSeconds = 0;
        return { ok: true, message: "✅ 验证失败 = 踢出并永久封禁" };
      }
      const seconds = parseDuration(raw) ?? (/^\d+$/.test(raw) ? Number(raw) : null);
      if (!seconds) return { ok: false, message: "⚠️ 用秒数或时长：600 / 10m / permanent" };
      group.captcha.banSeconds = seconds;
      return { ok: true, message: "✅ 验证失败 = 踢出并封禁 " + humanizeDuration(seconds) };
    }
    case "captcha.attempts":
    case "captcha.maxattempts": {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
        return { ok: false, message: "⚠️ 允许输错次数需为 1-10" };
      }
      group.captcha.maxAttempts = parsed;
      return { ok: true, message: "✅ 允许输错 = " + parsed + " 次" };
    }
    case "captcha.welcome":
    case "captcha.welcomeafterverify": {
      const parsed = parseBool(value);
      if (parsed === null) return { ok: false, message: "⚠️ 需要 on/off" };
      group.captcha.welcomeAfterVerify = parsed;
      return { ok: true, message: "✅ 验证通过后发欢迎语 = " + (parsed ? "on" : "off") };
    }
    // ---------- 欢迎 / 日志 ----------
    case "welcome.text": {
      const text = value.trim();
      if (!text) return { ok: false, message: "⚠️ 欢迎语不能为空" };
      group.welcome.text = text;
      return { ok: true, message: "✅ 欢迎语已更新（支持 {name} {username} {id} {chat}）" };
    }
    case "welcome.autodelete":
    case "welcome.autodeleteseconds": {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3600) {
        return { ok: false, message: "⚠️ 自动删除秒数需为 0-3600（0 表示不删）" };
      }
      group.welcome.autoDeleteSeconds = parsed;
      return { ok: true, message: "✅ 欢迎语自动删除 = " + (parsed === 0 ? "不删除" : parsed + " 秒") };
    }
    case "logchannel": {
      const raw = value.trim();
      if (!raw || raw.toLowerCase() === "off" || raw === "0") {
        delete group.logChannelId;
        return { ok: true, message: "✅ 已清除本群日志频道（回落到全局）" };
      }
      const parsed = Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed === 0) {
        return { ok: false, message: "⚠️ 日志频道需为 chat_id 或 off" };
      }
      group.logChannelId = parsed;
      return { ok: true, message: "✅ 日志频道 = <code>" + parsed + "</code>" };
    }
    default:
      return { ok: false, message: "⚠️ 未知设置项，发送 /set 查看可用项。" };
  }
}

const SET_HELP = [
  "⚙️ <b>/set 用法</b>：/set &lt;项&gt; &lt;值&gt;",
  "",
  "<b>开关（on/off）</b>",
  "keywordFilter antiLink antiForward antiZalgo welcome",
  "deleteServiceMessages deleteCommandMessages notifyOnPunish antiflood.enabled",
  "captcha.enabled captcha.welcomeAfterVerify",
  "",
  "<b>枚举</b>",
  "builtinAction = delete|warn|mute|ban|kick",
  "onWarnLimit = mute|ban|kick",
  "captcha.mode = button|image|web",
  "",
  "<b>数值</b>",
  "warnLimit = 1-20",
  "muteSeconds = 10m / 2h / 1d",
  "antiflood.maxMessages = 2-60",
  "antiflood.windowSeconds = 1-3600",
  "antiflood.muteSeconds = 5m",
  "captcha.timeout = 1-1440（分钟）",
  "captcha.ban = 600 / 10m / permanent",
  "captcha.attempts = 1-10",
  "",
  "<b>文本</b>",
  "welcome.text = 欢迎 {name} 加入 {chat}",
  "welcome.autoDeleteSeconds = 0-3600",
  "logChannel = -1001234567890 或 off",
].join("\n");

export function registerSettingsCommands(bot: Bot<Context>, deps: BotDeps, guards: Guards): void {
  const chain = [guards.managedGroup, guards.groupAdmin];

  bot.command("settings", ...chain, async (ctx) => {
    const group = deps.repo.getGroup(ctx.chat!.id);
    if (!group) return;
    await ctx.reply(settingsText(group), {
      parse_mode: "HTML",
      reply_markup: settingsKeyboard(group),
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command("captcha", ...chain, async (ctx) => {
    const group = deps.repo.getGroup(ctx.chat!.id);
    if (!group) return;
    const args = (ctx.match ?? "").trim();
    if (!args) {
      await ctx.reply(captchaText(group), {
        parse_mode: "HTML",
        reply_markup: settingsKeyboard(group),
        link_preview_options: { is_disabled: true },
      });
      return;
    }
    const [sub, ...rest] = args.split(/\s+/);
    const value = rest.join(" ");
    const keyMap: Record<string, string> = {
      on: "captcha.enabled",
      off: "captcha.enabled",
      mode: "captcha.mode",
      timeout: "captcha.timeout",
      ban: "captcha.ban",
      attempts: "captcha.attempts",
      welcome: "captcha.welcomeAfterVerify",
    };
    const key = keyMap[(sub ?? "").toLowerCase()];
    if (!key) {
      await ctx.reply("⚠️ 用法：/captcha on|off|mode|timeout|ban|attempts|welcome", {
        link_preview_options: { is_disabled: true },
      });
      return;
    }
    const normalized = sub === "on" || sub === "off" ? sub : value;
    const result = applySetting(group, key, normalized);
    if (result.ok) deps.repo.persist();
    await ctx.reply(result.message, {
      parse_mode: "HTML",
      reply_markup: settingsKeyboard(group),
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command("set", ...chain, async (ctx) => {
    const group = deps.repo.getGroup(ctx.chat!.id);
    if (!group) return;
    const parsed = parseArgs(ctx.match);
    const key = parsed.positional[0];
    if (!key) {
      await ctx.reply(SET_HELP, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
      return;
    }
    const value = parsed.positional.slice(1).join(" ").trim();
    if (!value) {
      await ctx.reply("⚠️ 缺少值。例如：/set warnLimit 3");
      return;
    }
    const result = applySetting(group, key, value);
    if (result.ok) deps.repo.persist();
    await ctx.reply(result.message, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });
}
