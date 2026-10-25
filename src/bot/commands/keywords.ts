import type { Bot, Context } from "grammy";
import type { BotDeps } from "../deps";
import type { Guards } from "../guards";
import type { KeywordMode, PunishAction } from "../../types";
import { parseArgs } from "../../utils/args";
import { humanizeDuration } from "../../utils/time";
import { escapeHtml } from "../../utils/telegram";
import { ACTION_LABEL } from "../../texts";
import { compileRules, findKeywordMatch, validatePattern } from "../../core/keywordMatcher";
import { detectLink, detectZalgo } from "../../core/detectors";
import { ruleCache } from "../events/messageGuard";

const MODES: KeywordMode[] = ["contains", "whole", "regex"];
const ACTIONS: PunishAction[] = ["delete", "warn", "mute", "ban", "kick"];
const PAGE_SIZE = 10;

function modeLabel(mode: KeywordMode): string {
  return mode === "contains" ? "包含" : mode === "whole" ? "整词" : "正则";
}

export function registerKeywordCommands(bot: Bot<Context>, deps: BotDeps, guards: Guards): void {
  const guardsChain = [guards.managedGroup, guards.groupAdmin];

  bot.command("addword", ...guardsChain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const parsed = parseArgs(ctx.match);
    const pattern = parsed.positional.join(" ").trim();
    if (!pattern) {
      await ctx.reply(
        [
          "⚠️ 用法：/addword <关键词> [选项]",
          "",
          "选项：",
          "  --mode contains|whole|regex  匹配模式（默认 contains）",
          "  --action delete|warn|mute|ban|kick  命中动作（默认 delete）",
          "  --mute 10m                   仅 mute 动作用，禁言时长",
          "  --note 说明                  备注",
          "",
          "示例：/addword 广告 --action mute --mute 1h",
          "示例：/addword 免费领取 --mode whole --action ban",
          "示例：/addword (加|私)我.*领 --mode regex --action mute",
        ].join("\n"),
        { link_preview_options: { is_disabled: true } },
      );
      return;
    }

    const mode = ((parsed.flags.mode ?? "contains").toLowerCase() as KeywordMode) ?? "contains";
    if (!MODES.includes(mode)) {
      await ctx.reply("⚠️ --mode 只能是 contains / whole / regex");
      return;
    }
    const action = ((parsed.flags.action ?? "delete").toLowerCase() as PunishAction) ?? "delete";
    if (!ACTIONS.includes(action)) {
      await ctx.reply("⚠️ --action 只能是 delete / warn / mute / ban / kick");
      return;
    }
    const invalid = validatePattern(pattern, mode);
    if (invalid) {
      await ctx.reply("⚠️ " + invalid);
      return;
    }
    if (deps.repo.findKeyword(chatId, pattern)) {
      await ctx.reply("ℹ️ 该关键词已存在，可用 /delword 删除后重建。");
      return;
    }

    let muteSeconds: number | undefined;
    if (parsed.flags.mute) {
      const seconds = parseDurationSafe(parsed.flags.mute);
      if (!seconds) {
        await ctx.reply("⚠️ --mute 时长格式无效，例如 10m / 2h / 1d");
        return;
      }
      muteSeconds = seconds;
    }

    const rule = deps.repo.addKeyword(chatId, {
      pattern,
      mode,
      action,
      muteSeconds,
      note: parsed.flags.note,
      createdBy: ctx.from?.id,
    });
    ruleCache.invalidate(chatId);
    if (!rule) {
      await ctx.reply("⚠️ 添加失败，请稍后重试。");
      return;
    }

    const lines = [
      "✅ 已添加关键词规则",
      `• 关键词：${escapeHtml(pattern)}`,
      `• 模式：${modeLabel(mode)}（${mode}）`,
      `• 命中动作：${ACTION_LABEL[action] ?? action}${muteSeconds ? " · " + humanizeDuration(muteSeconds) : ""}`,
      `• 规则 ID：<code>${rule.id}</code>`,
    ];
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("delword", ...guardsChain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const selector = (ctx.match ?? "").trim();
    if (!selector) {
      await ctx.reply("⚠️ 用法：/delword <关键词|序号>（序号见 /words）");
      return;
    }
    const removed = deps.repo.removeKeyword(chatId, selector);
    if (!removed) {
      await ctx.reply("⚠️ 未找到该关键词，请用 /words 查看序号。");
      return;
    }
    ruleCache.invalidate(chatId);
    await ctx.reply(`🗑 已删除关键词「${escapeHtml(removed.pattern)}」`, { parse_mode: "HTML" });
  });

  bot.command("words", ...guardsChain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const group = deps.repo.getGroup(chatId);
    if (!group) return;
    if (!group.keywords.length) {
      await ctx.reply("ℹ️ 本群还没有关键词。用 /addword <关键词> 添加，或 /importwords 批量导入。");
      return;
    }
    const pageRaw = Number((ctx.match ?? "").trim());
    const totalPages = Math.max(1, Math.ceil(group.keywords.length / PAGE_SIZE));
    const page = Math.min(Math.max(1, Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1), totalPages);
    const slice = group.keywords.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const lines = [
      `📚 <b>关键词规则</b>（${group.keywords.length} 条 · 第 ${page}/${totalPages} 页）`,
    ];
    slice.forEach((rule, index) => {
      const order = (page - 1) * PAGE_SIZE + index + 1;
      const state = rule.enabled ? "" : "（已停用）";
      lines.push(
        `${order}. 「${escapeHtml(rule.pattern)}」${state} · ${modeLabel(rule.mode)} · ${ACTION_LABEL[rule.action] ?? rule.action} · 命中 ${rule.hits}`,
      );
    });
    if (totalPages > 1) lines.push("", `翻页：/words ${page < totalPages ? page + 1 : 1}`);
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("clearwords", ...guardsChain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const removed = deps.repo.clearKeywords(chatId);
    ruleCache.invalidate(chatId);
    await ctx.reply(`🗑 已清空 ${removed} 条关键词规则。`, { parse_mode: "HTML" });
  });

  bot.command("testword", ...guardsChain, async (ctx) => {
    const chatId = ctx.chat!.id;
    const group = deps.repo.getGroup(chatId);
    if (!group) return;
    const text = (ctx.match ?? "").trim();
    if (!text) {
      await ctx.reply("⚠️ 用法：/testword <要测试的文本>");
      return;
    }
    const lines = [`🔎 <b>测试结果</b>`, `文本：${escapeHtml(text.slice(0, 200))}`, ""];

    const match = findKeywordMatch(text, compileRules(group.keywords));
    if (match) {
      lines.push(`✅ 命中关键词「${escapeHtml(match.rule.pattern)}」`);
      lines.push(`• 动作：${ACTION_LABEL[match.rule.action] ?? match.rule.action}`);
      lines.push(`• 片段：${escapeHtml(match.fragment)}`);
    } else {
      lines.push("❌ 未命中任何关键词");
    }

    if (group.settings.antiLink) {
      const link = detectLink(text);
      lines.push(link ? `✅ 链接检测：${escapeHtml(link.reason)}` : "❌ 链接检测：未命中");
    }
    if (group.settings.antiZalgo) {
      const zalgo = detectZalgo(text);
      lines.push(zalgo ? "✅ 乱码检测：命中" : "❌ 乱码检测：未命中");
    }
    if (group.settings.keywordFilter === false) {
      lines.push("", "ℹ️ 注意：关键词过滤当前处于关闭状态，实际不会拦截。");
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });
}

function parseDurationSafe(raw: string): number | null {
  const match = raw.trim().toLowerCase().match(/^(\d+)\s*(s|m|h|d|w)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2] ?? "m";
  const factor = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : unit === "d" ? 86400 : 604800;
  return amount > 0 ? amount * factor : null;
}
