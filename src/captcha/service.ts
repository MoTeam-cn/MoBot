import { InlineKeyboard, InputFile } from "grammy";
import type { Api } from "grammy";
import type { User } from "grammy/types";
import type { AppConfig } from "../config";
import type { Logger } from "../logger";
import type { Repository } from "../storage/repository";
import type { ChallengeRecord, GroupConfig } from "../types";
import type { Moderator } from "../core/moderator";
import { randomCode, randomToken } from "./code";
import { renderCaptcha } from "./png";
import { displayName, escapeHtml, userLink } from "../utils/telegram";
import { renderWelcome } from "../utils/welcome";
import { humanizeDuration } from "../utils/time";

export interface CaptchaDeps {
  api?: Api;
  repo: Repository;
  moderator: Moderator;
  logger: Logger;
  config: AppConfig;
}

export interface VerifyResult {
  ok: boolean;
  message: string;
  challenge?: ChallengeRecord;
}

function key(chatId: number, userId: number): string {
  return chatId + ":" + userId;
}

/**
 * 入群验证服务：
 * 入群 → 禁言 → 私聊下发验证（按钮 / 图像验证码 / 网页 JS）
 * 通过 → 解除禁言（可发欢迎语）；超时或错太多次 → 踢出并封禁（可永久）。
 */
export class CaptchaService {
  private apiRef?: Api;
  private timers = new Map<string, NodeJS.Timeout>();
  private stopped = false;

  constructor(private readonly deps: CaptchaDeps) {
    this.apiRef = deps.api;
  }

  attachApi(api: Api): void {
    this.apiRef = api;
  }

  private get api(): Api {
    if (!this.apiRef) throw new Error("CaptchaService 尚未绑定 Api");
    return this.apiRef;
  }

  get publicUrl(): string | undefined {
    return this.deps.repo.profile.publicUrl ?? this.deps.config.publicUrl;
  }

  /** 该用户是否有待完成验证 */
  pendingFor(userId: number): ChallengeRecord | undefined {
    return this.deps.repo.findChallengesByUser(userId)[0];
  }

  /** 开始一次验证 */
  async begin(group: GroupConfig, member: User): Promise<ChallengeRecord | undefined> {
    const config = group.captcha;
    if (!config.enabled || member.is_bot) return undefined;

    const existing = this.deps.repo.getChallenge(group.chatId, member.id);
    if (existing) await this.clearPrompts(existing);

    // 网页模式缺少公网地址时降级为图像验证码
    const mode = config.mode === "web" && !this.publicUrl ? "image" : config.mode;
    const token = randomToken(10);
    const record: ChallengeRecord = {
      token,
      chatId: group.chatId,
      userId: member.id,
      userName: displayName(member),
      mode,
      code: mode === "image" ? randomCode(5) : undefined,
      attempts: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + Math.max(1, config.kickAfterMinutes) * 60_000,
      promptMessageIds: {},
      dmSent: false,
      groupFallback: false,
    };
    this.deps.repo.putChallenge(record);

    // 先禁言，禁言时长覆盖验证窗口
    await this.deps.moderator.mute(group.chatId, member.id, Math.max(60, config.kickAfterMinutes * 60 + 60));

    record.dmSent = await this.sendPrivatePrompt(group, record);
    if (!record.dmSent) await this.sendGroupPrompt(group, record);
    this.deps.repo.putChallenge(record);
    this.arm(record);
    return record;
  }

  /** 按钮 / 网页回调：按 token 验证 */
  async verifyByToken(token: string, byUserId: number): Promise<VerifyResult> {
    const record = this.deps.repo.findChallengeByToken(token);
    if (!record) return { ok: false, message: "验证已失效或已完成" };
    if (byUserId !== record.userId) return { ok: false, message: "这不是你的验证按钮" };
    if (record.expiresAt < Date.now()) {
      await this.expireNow(record, "验证超时");
      return { ok: false, message: "验证已超时" };
    }
    const group = this.deps.repo.getGroup(record.chatId);
    if (!group) {
      this.deps.repo.deleteChallenge(record.chatId, record.userId);
      return { ok: false, message: "该群已不在受管列表" };
    }
    await this.complete(group, record);
    return { ok: true, message: "验证通过，欢迎加入！", challenge: record };
  }

  /** 图像验证码：私聊或群内回复验证码 */
  async verifyByCode(userId: number, rawCode: string, chatId?: number): Promise<VerifyResult> {
    const candidates = this.deps.repo
      .findChallengesByUser(userId)
      .filter((item) => item.mode === "image" && (!chatId || item.chatId === chatId));
    const record = candidates[0];
    if (!record) return { ok: false, message: "" };
    if (record.expiresAt < Date.now()) {
      await this.expireNow(record, "验证超时");
      return { ok: false, message: "验证已超时" };
    }
    const group = this.deps.repo.getGroup(record.chatId);
    if (!group) {
      this.deps.repo.deleteChallenge(record.chatId, record.userId);
      return { ok: false, message: "" };
    }

    const expected = (record.code ?? "").toUpperCase();
    const input = rawCode.trim().toUpperCase();
    if (input !== expected) {
      record.attempts += 1;
      this.deps.repo.putChallenge(record);
      const left = Math.max(0, group.captcha.maxAttempts - record.attempts);
      if (left <= 0) {
        await this.expireNow(record, "验证码错误次数过多");
        return { ok: false, message: "验证码错误次数过多" };
      }
      return { ok: false, message: "验证码错误，还可以再试 " + left + " 次" };
    }

    await this.complete(group, record);
    return { ok: true, message: "验证通过，欢迎加入！", challenge: record };
  }

  /** 网页验证成功后调用 */
  async verifyByChallenge(record: ChallengeRecord): Promise<VerifyResult> {
    return this.verifyByToken(record.token, record.userId);
  }

  /** 超时 / 失败：踢出并按配置封禁 */
  async expireNow(record: ChallengeRecord, reason = "验证超时"): Promise<void> {
    const group = this.deps.repo.getGroup(record.chatId);
    this.clearTimer(record);
    this.deps.repo.deleteChallenge(record.chatId, record.userId);
    if (!group) return;

    const banSeconds = Math.max(0, group.captcha.banSeconds);
    await this.deps.moderator.banFor(record.chatId, record.userId, banSeconds);
    this.deps.repo.bumpStats(record.chatId, "captchaFailed");
    await this.clearPrompts(record);

    const banText = banSeconds > 0 ? "封禁 " + humanizeDuration(banSeconds) : "永久封禁";
    await this.deps.moderator.notify(
      record.chatId,
      "⏱ " + userLink(record.userId, record.userName) + " " + reason + "，已移出群组并" + banText,
    );
    await this.deps.moderator.log(
      [
        "⏱ 入群验证失败 · " + escapeHtml(group.title),
        "• 用户：" + userLink(record.userId, record.userName) + " (" + record.userId + ")",
        "• 原因：" + reason,
        "• 处置：踢出并" + banText,
      ].join("\n"),
      group,
    );
    try {
      await this.api.sendMessage(
        record.userId,
        "❌ 你在「" + group.title + "」的入群验证未通过（" + reason + "），已被移出并" + banText + "。",
      );
    } catch {
      // 用户可能已拉黑机器人
    }
  }

  /** 重启后恢复未完成的验证（重新挂定时器，过期立即处理） */
  async restore(): Promise<number> {
    const records = this.deps.repo.listChallenges();
    for (const record of records) {
      if (record.expiresAt <= Date.now()) {
        await this.expireNow(record, "验证超时（重启恢复）");
      } else {
        this.arm(record);
      }
    }
    return records.length;
  }

  /** 热更新后重新挂载定时器（不清空未完成验证） */
  async rearm(): Promise<number> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    return this.restore();
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  // ---------- 内部 ----------

  private arm(record: ChallengeRecord): void {
    if (this.stopped) return;
    this.clearTimer(record);
    const delay = Math.max(0, record.expiresAt - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(key(record.chatId, record.userId));
      void this.expireNow(record, "验证超时");
    }, delay);
    timer.unref?.();
    this.timers.set(key(record.chatId, record.userId), timer);
  }

  private clearTimer(record: ChallengeRecord): void {
    const existing = this.timers.get(key(record.chatId, record.userId));
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(key(record.chatId, record.userId));
    }
  }

  private async sendPrivatePrompt(group: GroupConfig, record: ChallengeRecord): Promise<boolean> {
    const minutes = group.captcha.kickAfterMinutes;
    const title = group.title || String(group.chatId);
    try {
      if (record.mode === "image" && record.code) {
        const png = renderCaptcha(record.code);
        const sent = await this.api.sendPhoto(record.userId, new InputFile(png, "captcha.png"), {
          caption:
            "🔐 请在 " +
            minutes +
            " 分钟内回复图中的验证码（" +
            record.code.length +
            " 位字母/数字）\n群组：" +
            title,
        });
        record.promptMessageIds.dm = sent.message_id;
        return true;
      }

      if (record.mode === "web") {
        const url = (this.publicUrl ?? "") + "/verify/" + record.token;
        const sent = await this.api.sendMessage(
          record.userId,
          "🔐 请点击下方按钮完成人机验证，链接 " + minutes + " 分钟内有效。\n群组：" + title,
          { reply_markup: new InlineKeyboard().url("🌐 打开验证页面", url) },
        );
        record.promptMessageIds.dm = sent.message_id;
        return true;
      }

      const sent = await this.api.sendMessage(
        record.userId,
        "🔐 请点击下方按钮完成入群验证（" + minutes + " 分钟内有效）。\n群组：" + title,
        { reply_markup: new InlineKeyboard().text("✅ 我已完成验证", "vfy:" + record.token) },
      );
      record.promptMessageIds.dm = sent.message_id;
      return true;
    } catch (error) {
      this.deps.logger.debug("私聊下发验证失败，改用群内按钮", {
        userId: record.userId,
        error: String(error),
      });
      return false;
    }
  }

  private async sendGroupPrompt(group: GroupConfig, record: ChallengeRecord): Promise<void> {
    const minutes = group.captcha.kickAfterMinutes;
    const hint =
      record.mode === "image"
        ? "也可以私聊我，输入图像验证码。"
        : record.mode === "web"
          ? "也可以私聊我，打开网页验证。"
          : "也可以私聊我完成验证。";
    try {
      const sent = await this.api.sendMessage(
        group.chatId,
        userLink(record.userId, record.userName) +
          " 欢迎入群，请先完成人机验证：点击下方按钮，" +
          hint +
          "\n⏳ " +
          minutes +
          " 分钟内未验证将被移出群组。",
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text("✅ 点击完成验证", "vfy:" + record.token),
          link_preview_options: { is_disabled: true },
        },
      );
      record.promptMessageIds.chat = sent.message_id;
      record.groupFallback = true;
    } catch (error) {
      this.deps.logger.warn("群内验证提示发送失败", { chatId: group.chatId, error: String(error) });
    }
  }

  private async complete(group: GroupConfig, record: ChallengeRecord): Promise<void> {
    this.clearTimer(record);
    this.deps.repo.deleteChallenge(record.chatId, record.userId);
    await this.deps.moderator.unmute(record.chatId, record.userId);
    this.deps.repo.bumpStats(record.chatId, "captchaSolved");
    await this.clearPrompts(record);

    await this.deps.moderator.notify(
      record.chatId,
      "✅ " + userLink(record.userId, record.userName) + " 已通过人机验证，欢迎！",
    );

    if (group.captcha.welcomeAfterVerify && group.settings.welcome) {
      const member = { id: record.userId, first_name: record.userName, username: undefined };
      const html = renderWelcome(group.welcome.text, member, group.title);
      try {
        const sent = await this.api.sendMessage(group.chatId, html, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
        if (group.welcome.autoDeleteSeconds > 0) {
          this.deps.moderator.scheduleDelete(group.chatId, sent.message_id, group.welcome.autoDeleteSeconds);
        }
      } catch (error) {
        this.deps.logger.debug("发送欢迎语失败", { chatId: group.chatId, error: String(error) });
      }
    }

    await this.deps.moderator.log(
      [
        "✅ 入群验证通过 · " + escapeHtml(group.title),
        "• 用户：" + userLink(record.userId, record.userName) + " (" + record.userId + ")",
        "• 方式：" + record.mode,
      ].join("\n"),
      group,
    );

    try {
      await this.api.sendMessage(record.userId, "✅ 验证通过，你已可以正常发言。欢迎加入「" + group.title + "」！");
    } catch {
      // 忽略
    }
  }

  /** 清理验证提示消息（群内 + 私聊） */
  private async clearPrompts(record: ChallengeRecord): Promise<void> {
    if (record.promptMessageIds.chat) {
      await this.deps.moderator.deleteMessage(record.chatId, record.promptMessageIds.chat);
    }
    if (record.promptMessageIds.dm) {
      try {
        await this.api.deleteMessage(record.userId, record.promptMessageIds.dm);
      } catch {
        // 私聊消息可能已被删除
      }
    }
  }
}
