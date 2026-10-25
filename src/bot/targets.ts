import type { Context } from "grammy";
import { displayName } from "../utils/telegram";

export interface TargetInfo {
  id: number;
  name: string;
  username?: string;
  /** 匿名管理员 / 频道身份发言，无法定位到具体用户 */
  anonymous?: boolean;
}

/**
 * 解析操作目标：优先回复目标 → 文本 @提及 → 参数里的 @username / 数字 ID。
 */
export async function resolveTarget(ctx: Context, arg?: string): Promise<TargetInfo | null> {
  const message = ctx.message;
  const reply = message?.reply_to_message;
  if (reply?.sender_chat) {
    return {
      id: reply.sender_chat.id,
      name: reply.sender_chat.title ?? String(reply.sender_chat.id),
      username: reply.sender_chat.username,
      anonymous: true,
    };
  }
  if (reply?.from) {
    return { id: reply.from.id, name: displayName(reply.from), username: reply.from.username };
  }

  const entities = message?.entities ?? message?.caption_entities ?? [];
  for (const entity of entities) {
    if (entity.type === "text_mention" && entity.user) {
      return { id: entity.user.id, name: displayName(entity.user), username: entity.user.username };
    }
  }

  const raw = (arg ?? "").trim();
  if (!raw) return null;
  return lookupUser(ctx, raw);
}

/** 通过 @username 或数字 ID 查询用户 */
async function lookupUser(ctx: Context, raw: string): Promise<TargetInfo | null> {
  const chatId = ctx.chat?.id;
  if (!/^-?\d+$/.test(raw)) {
    try {
      const chat = await ctx.api.getChat(raw);
      if ("first_name" in chat) {
        return { id: chat.id, name: displayName(chat), username: chat.username };
      }
      const title = "title" in chat ? chat.title : undefined;
      return { id: chat.id, name: title ?? String(chat.id) };
    } catch {
      return null;
    }
  }
  const userId = Number(raw);
  if (!Number.isSafeInteger(userId) || userId === 0) return null;
  if (chatId) {
    try {
      const member = await ctx.api.getChatMember(chatId, userId);
      return { id: member.user.id, name: displayName(member.user), username: member.user.username };
    } catch {
      // 不在群里（例如已退群/被封禁的用户），退回纯 ID
    }
  }
  return { id: userId, name: String(userId) };
}
/** 解析目标，失败时回复提示 */
export async function requireTarget(ctx: Context, arg?: string): Promise<TargetInfo | null> {
  const target = await resolveTarget(ctx, arg);
  if (!target) {
    await ctx.reply("⚠️ 未找到目标用户。请回复对方消息，或使用 @用户名 / 数字 ID。");
    return null;
  }
  if (target.anonymous) {
    await ctx.reply(
      "⚠️ 该消息由**匿名管理员**或**频道身份**发出，Telegram 不允许定位到具体用户，无法对其执行操作。\n如需处理，请让该管理员取消匿名后操作，或直接使用用户 ID。",
    );
    return null;
  }
  return target;
}
