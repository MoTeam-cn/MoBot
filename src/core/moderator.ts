import type { Api } from "grammy";
import type { AppConfig } from "../config";
import type { Logger } from "../logger";
import type { Repository } from "../storage/repository";
import type { GroupConfig, PunishAction, PunishOutcome } from "../types";
import { punishLog, punishNotice } from "../texts";
import { MUTED_PERMISSIONS, UNMUTED_PERMISSIONS, sendAutoDelete, scheduleDelete } from "../utils/telegram";

/** 群内处罚提示的自动消失秒数 */
export const NOTICE_TTL_SECONDS = 10;

export interface PunishInput {
  chatId: number;
  userId: number;
  userName: string;
  /** 触发处罚的消息，缺省表示只做处置不删消息 */
  messageId?: number;
  action: PunishAction;
  reason: string;
  muteSeconds?: number;
  /** 目标是不是机器人（机器人无法禁言） */
  isBot?: boolean;
  /** 不在群里发提示 */
  silent?: boolean;
  /** 命中关键词的规则（用于计数） */
  keywordRuleId?: string;
}

export interface ModeratorDeps {
  /** 由 createBot 在构造 Bot 之后绑定 */
  api?: Api;
  repo: Repository;
  config: AppConfig;
  logger: Logger;
}

/**
 * 统一的处置入口：删除、警告、禁言、封禁、踢人 + 提示 + 日志 + 统计。
 */
export class Moderator {
  private apiRef?: Api;

  constructor(private readonly deps: ModeratorDeps) {
    this.apiRef = deps.api;
  }

  /** 绑定 grammY Api（Bot 实例创建后调用） */
  attachApi(api: Api): void {
    this.apiRef = api;
  }

  private get api(): Api {
    if (!this.apiRef) throw new Error("Moderator 尚未绑定 Api");
    return this.apiRef;
  }

  private get repo(): Repository {
    return this.deps.repo;
  }

  private get dryRun(): boolean {
    return this.deps.config.dryRun;
  }

  async deleteMessage(chatId: number, messageId: number): Promise<boolean> {
    if (this.dryRun) {
      this.deps.logger.info("[dry-run] 跳过删除消息", { chatId, messageId });
      return true;
    }
    try {
      await this.api.deleteMessage(chatId, messageId);
      return true;
    } catch (error) {
      this.deps.logger.debug("删除消息失败（可能已被删除或无权限）", { chatId, messageId, error: String(error) });
      return false;
    }
  }

  async deleteMessages(chatId: number, messageIds: number[]): Promise<number> {
    if (!messageIds.length) return 0;
    if (this.dryRun) {
      this.deps.logger.info("[dry-run] 跳过批量删除", { chatId, count: messageIds.length });
      return messageIds.length;
    }
    let deleted = 0;
    for (let index = 0; index < messageIds.length; index += 100) {
      const chunk = messageIds.slice(index, index + 100);
      try {
        await this.api.deleteMessages(chatId, chunk);
        deleted += chunk.length;
      } catch {
        for (const id of chunk) {
          if (await this.deleteMessage(chatId, id)) deleted += 1;
        }
      }
    }
    return deleted;
  }

  async mute(chatId: number, userId: number, seconds: number): Promise<boolean> {
    if (this.dryRun) {
      this.deps.logger.info("[dry-run] 跳过禁言", { chatId, userId, seconds });
      return true;
    }
    try {
      await this.api.restrictChatMember(chatId, userId, MUTED_PERMISSIONS, {
        until_date: Math.floor(Date.now() / 1000) + Math.max(30, Math.round(seconds)),
        use_independent_chat_permissions: true,
      });
      return true;
    } catch (error) {
      this.deps.logger.warn("禁言失败（检查机器人权限）", { chatId, userId, error: String(error) });
      return false;
    }
  }

  async unmute(chatId: number, userId: number): Promise<boolean> {
    if (this.dryRun) {
      this.deps.logger.info("[dry-run] 跳过解除禁言", { chatId, userId });
      return true;
    }
    try {
      await this.api.restrictChatMember(chatId, userId, UNMUTED_PERMISSIONS, {
        use_independent_chat_permissions: true,
      });
      return true;
    } catch (error) {
      this.deps.logger.warn("解除禁言失败", { chatId, userId, error: String(error) });
      return false;
    }
  }

  async ban(chatId: number, userId: number): Promise<boolean> {
    if (this.dryRun) {
      this.deps.logger.info("[dry-run] 跳过封禁", { chatId, userId });
      return true;
    }
    try {
      await this.api.banChatMember(chatId, userId);
      return true;
    } catch (error) {
      this.deps.logger.warn("封禁失败", { chatId, userId, error: String(error) });
      return false;
    }
  }

  /**
   * 封禁并支持时长：seconds > 0 为临时封禁（到期自动解封），0 表示永久。
   * 用于入群验证超时：踢出 + 封禁。
   */
  async banFor(chatId: number, userId: number, seconds: number): Promise<boolean> {
    if (this.dryRun) {
      this.deps.logger.info("[dry-run] 跳过封禁", { chatId, userId, seconds });
      return true;
    }
    try {
      if (seconds > 0) {
        await this.api.banChatMember(chatId, userId, {
          until_date: Math.floor(Date.now() / 1000) + Math.round(seconds),
        });
      } else {
        await this.api.banChatMember(chatId, userId);
      }
      return true;
    } catch (error) {
      this.deps.logger.warn("封禁失败（检查机器人权限）", { chatId, userId, error: String(error) });
      return false;
    }
  }

  async unban(chatId: number, userId: number): Promise<boolean> {
    try {
      await this.api.unbanChatMember(chatId, userId, { only_if_banned: true });
      return true;
    } catch (error) {
      this.deps.logger.warn("解封失败", { chatId, userId, error: String(error) });
      return false;
    }
  }

  /** 踢人 = 封禁后立即解封 */
  async kick(chatId: number, userId: number): Promise<boolean> {
    if (this.dryRun) {
      this.deps.logger.info("[dry-run] 跳过踢人", { chatId, userId });
      return true;
    }
    const banned = await this.ban(chatId, userId);
    if (!banned) return false;
    await this.unban(chatId, userId);
    return true;
  }

  /** 核心处置流程 */
  async punish(input: PunishInput): Promise<PunishOutcome> {
    const group = this.repo.getGroup(input.chatId);
    const outcome: PunishOutcome = { deleted: false, action: input.action, dryRun: this.dryRun };
    if (!group) return outcome;

    if (input.messageId) {
      outcome.deleted = await this.deleteMessage(input.chatId, input.messageId);
      if (outcome.deleted) this.repo.bumpStats(input.chatId, "deleted");
    }
    if (input.keywordRuleId) this.repo.bumpKeywordHits(input.chatId, input.keywordRuleId);

    let effective: PunishAction = input.action;
    let muteSeconds = input.muteSeconds ?? group.muteSeconds;

    if (effective === "warn") {
      const entry = this.repo.addWarning(input.chatId, input.userId, input.reason);
      outcome.warnCount = entry?.count ?? 0;
      outcome.warnLimit = group.warnLimit;
      if (entry && entry.count >= group.warnLimit) {
        this.repo.resetWarnings(input.chatId, input.userId);
        effective = group.settings.onWarnLimit;
        outcome.escalatedTo = group.settings.onWarnLimit;
        outcome.warnCount = 0;
      }
    }

    if (input.isBot && (effective === "mute" || effective === "kick")) {
      // 机器人不可禁言/踢出，退化为仅删除
      effective = "delete";
    }

    if (effective === "mute") {
      await this.mute(input.chatId, input.userId, muteSeconds);
      outcome.mutedSeconds = muteSeconds;
    } else if (effective === "ban") {
      await this.ban(input.chatId, input.userId);
    } else if (effective === "kick") {
      await this.kick(input.chatId, input.userId);
    }

    if (!input.silent && group.settings.notifyOnPunish) {
      await this.notify(
        input.chatId,
        punishNotice(input.userId, input.userName, input.reason, outcome),
        input.messageId,
      );
    }

    await this.log(punishLog(group, input.userId, input.userName, input.reason, outcome), group);
    this.deps.logger.info("已处置违规", {
      chatId: input.chatId,
      userId: input.userId,
      action: effective,
      reason: input.reason,
      dryRun: this.dryRun,
    });
    return outcome;
  }

  /** 群内发一条自动消失的提示 */
  async notify(chatId: number, html: string, replyTo?: number): Promise<void> {
    if (this.dryRun) {
      this.deps.logger.info("[dry-run] 跳过群内提示", { chatId });
      return;
    }
    await sendAutoDelete(this.api, chatId, html, NOTICE_TTL_SECONDS, replyTo);
  }

  /** 写日志频道 */
  async log(html: string, group?: GroupConfig): Promise<void> {
    const target = group?.logChannelId;
    if (!target) return;
    try {
      await this.api.sendMessage(target, html, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    } catch (error) {
      this.deps.logger.debug("写日志频道失败", { target, error: String(error) });
    }
  }

  /** 手动删除某条消息并计数 */
  async purgeOne(chatId: number, messageId: number): Promise<void> {
    if (await this.deleteMessage(chatId, messageId)) this.repo.bumpStats(chatId, "deleted");
  }

  /** 计划删除（不阻塞） */
  scheduleDelete(chatId: number, messageId: number, seconds: number): void {
    if (this.dryRun) return;
    scheduleDelete(this.api, chatId, messageId, seconds);
  }
}
