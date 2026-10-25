import type { Context, MiddlewareFn } from "grammy";
import type { BotDeps } from "../deps";
import type { GroupConfig } from "../../types";
import { compileRules, findKeywordMatch, type CompiledRule } from "../../core/keywordMatcher";
import { detectLink, detectZalgo, isForwarded, type DetectionResult } from "../../core/detectors";
import { displayName, isPrivilegedSender } from "../../utils/telegram";

/** 关键词编译缓存：规则集合不变时复用 */
class RuleCache {
  private cache = new Map<number, { signature: string; compiled: CompiledRule[] }>();

  get(group: GroupConfig): CompiledRule[] {
    const signature = group.keywords
      .map((rule) => `${rule.id}:${rule.mode}:${rule.enabled ? 1 : 0}:${rule.pattern}`)
      .join("|");
    const hit = this.cache.get(group.chatId);
    if (hit && hit.signature === signature) return hit.compiled;
    const compiled = compileRules(group.keywords);
    this.cache.set(group.chatId, { signature, compiled });
    return compiled;
  }

  invalidate(chatId: number): void {
    this.cache.delete(chatId);
  }
}

export const ruleCache = new RuleCache();

/**
 * 核心过滤管线：关键词 → 链接 → 转发 → 乱码 → 刷屏。
 * 命中即删除并按规则处置，管理员与信任用户豁免。
 */
export function createMessageGuard(deps: BotDeps): MiddlewareFn<Context> {
  const { repo, adminCache, flood, moderator, logger } = deps;

  return async (ctx, next) => {
    const message = ctx.message;
    if (!message) return next();

    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return next();

    const group = repo.getGroup(chat.id);
    if (!group) return next();

    const from = message.from;
    if (!from) return next();

    // 匿名管理员 / 频道身份发言：属于管理员，永不拦截
    if (isPrivilegedSender(message)) return next();

    // 命令消息由命令处理器负责
    if (message.text?.startsWith("/")) return next();

    // 全局封禁：任何受管群都直接处理
    if (!from.is_bot && repo.isGloballyBanned(from.id)) {
      await moderator.punish({
        chatId: chat.id,
        userId: from.id,
        userName: displayName(from),
        messageId: message.message_id,
        action: "ban",
        reason: "全局封禁用户在受管群发言",
      });
      return;
    }

    const admins = await adminCache.get(ctx.api, chat.id);
    const privileged = admins.has(from.id) || repo.isTrusted(chat.id, from.id) || repo.isBotAdmin(from.id);
    if (privileged) return next();

    const text = message.text ?? message.caption ?? "";

    // 1) 关键词过滤
    if (group.settings.keywordFilter && text) {
      const match = findKeywordMatch(text, ruleCache.get(group));
      if (match) {
        repo.bumpStats(chat.id, "keywordHits");
        await moderator.punish({
          chatId: chat.id,
          userId: from.id,
          userName: displayName(from),
          messageId: message.message_id,
          action: match.rule.action,
          muteSeconds: match.rule.muteSeconds,
          reason: `命中关键词「${match.rule.pattern}」`,
          keywordRuleId: match.rule.id,
          isBot: from.is_bot,
        });
        return;
      }
    }

    // 2) 内置检测
    let detection: DetectionResult | undefined;
    if (group.settings.antiLink) detection = detectLink(text);
    if (!detection && group.settings.antiForward && isForwarded(message)) {
      detection = { kind: "forward", reason: "转发他人消息" };
    }
    if (!detection && group.settings.antiZalgo) detection = detectZalgo(text);

    // 3) 刷屏
    if (!detection && group.antiflood.enabled) {
      const count = flood.hit(chat.id, from.id, group.antiflood.windowSeconds);
      if (count > group.antiflood.maxMessages) {
        flood.reset(chat.id, from.id);
        await moderator.punish({
          chatId: chat.id,
          userId: from.id,
          userName: displayName(from),
          messageId: message.message_id,
          action: "mute",
          muteSeconds: group.antiflood.muteSeconds,
          reason: `刷屏：${group.antiflood.windowSeconds} 秒内 ${count} 条消息`,
          isBot: from.is_bot,
        });
        return;
      }
    }

    if (detection) {
      logger.debug("内置检测命中", { chatId: chat.id, userId: from.id, kind: detection.kind });
      await moderator.punish({
        chatId: chat.id,
        userId: from.id,
        userName: displayName(from),
        messageId: message.message_id,
        action: group.settings.builtinAction,
        reason: detection.reason,
        isBot: from.is_bot,
      });
      return;
    }

    return next();
  };
}
