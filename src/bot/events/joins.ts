import type { Bot, Context } from "grammy";
import type { User } from "grammy/types";
import type { BotDeps } from "../deps";
import type { GroupConfig } from "../../types";
import { renderWelcome } from "../../utils/welcome";
import { displayName, userLink } from "../../utils/telegram";

/** 发送入群欢迎语（验证模式下由验证通过后触发） */
export async function sendWelcome(ctx: Context, deps: BotDeps, group: GroupConfig, member: User): Promise<void> {
  const html = renderWelcome(group.welcome.text, member, group.title);
  try {
    const sent = await ctx.api.sendMessage(group.chatId, html, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    if (group.welcome.autoDeleteSeconds > 0) {
      deps.moderator.scheduleDelete(group.chatId, sent.message_id, group.welcome.autoDeleteSeconds);
    }
  } catch (error) {
    deps.logger.debug("发送欢迎语失败", { chatId: group.chatId, error: String(error) });
  }
}

/** 判断新成员本身是否已是群管理员 */
async function isGroupAdminMember(ctx: Context, chatId: number, userId: number): Promise<boolean> {
  try {
    const member = await ctx.api.getChatMember(chatId, userId);
    return member.status === "administrator" || member.status === "creator";
  } catch {
    return false;
  }
}

/** 入群 / 退群 / 系统消息处理 */
export function registerJoinHandlers(bot: Bot<Context>, deps: BotDeps): void {
  bot.on("message:new_chat_members", async (ctx) => {
    const chat = ctx.chat;
    if (chat.type === "private") return;
    const group = deps.repo.getGroup(chat.id);
    if (!group) return;

    const members = ctx.message.new_chat_members ?? [];
    for (const member of members) {
      if (member.id === ctx.me.id) continue;
      if (member.is_bot) continue;

      deps.repo.bumpStats(chat.id, "joins");

      if (deps.repo.isGloballyBanned(member.id)) {
        await deps.moderator.ban(chat.id, member.id);
        await deps.moderator.log(
          "🚫 全局封禁用户尝试入群：" + userLink(member.id, displayName(member)) + " (" + member.id + ")，已封禁",
          group,
        );
        continue;
      }

      // 群管理员与信任用户不参与验证
      const exempt = await isGroupAdminMember(ctx, chat.id, member.id) || deps.repo.isTrusted(chat.id, member.id);

      // 开启验证：先禁言 + 私聊验证；通过后才发欢迎语
      const challenge = exempt ? undefined : await deps.captcha.begin(group, member);
      if (!challenge && group.settings.welcome) {
        await sendWelcome(ctx, deps, group, member);
      }
    }

    if (group.settings.deleteServiceMessages) {
      await deps.moderator.deleteMessage(chat.id, ctx.message.message_id);
    }
  });

  const serviceEvents = [
    "message:left_chat_member",
    "message:new_chat_title",
    "message:new_chat_photo",
    "message:pinned_message",
  ] as const;

  for (const event of serviceEvents) {
    bot.on(event, async (ctx) => {
      const chat = ctx.chat;
      if (chat.type === "private") return;
      const group = deps.repo.getGroup(chat.id);
      if (!group || !group.settings.deleteServiceMessages) return;
      await deps.moderator.deleteMessage(chat.id, ctx.message.message_id);
    });
  }
}
