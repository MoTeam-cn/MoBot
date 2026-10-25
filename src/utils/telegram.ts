import type { Api } from "grammy";
import type { ChatPermissions } from "grammy/types";

/** 全禁言（只保留读权限） */
export const MUTED_PERMISSIONS: ChatPermissions = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_invite_users: false,
};

/** 解除禁言（恢复发言相关权限，管理类权限不动） */
export const UNMUTED_PERMISSIONS: ChatPermissions = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
  can_invite_users: true,
};

export function escapeHtml(input: string): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface UserLike {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export function displayName(user: UserLike | undefined | null): string {
  if (!user) return "未知用户";
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (user.username) return `@${user.username}`;
  return `用户 ${user.id}`;
}

/** 生成可点击的 @ 提及（HTML 模式） */
export function userLink(userId: number, name: string): string {
  return `<a href="tg://user?id=${userId}">${escapeHtml(name)}</a>`;
}

export function userTag(user: UserLike): string {
  return userLink(user.id, displayName(user));
}

/** Telegram 里"匿名管理员"发言时的固定机器人 ID */
export const GROUP_ANONYMOUS_BOT_ID = 1087968824;

export interface SenderProbe {
  chat?: { id: number; type: string; title?: string };
  sender_chat?: { id: number; title?: string; username?: string };
  from?: UserLike;
}

/** 匿名管理员：以群组身份发言（sender_chat 就是本群） */
export function isAnonymousGroupPost(message: SenderProbe | undefined): boolean {
  if (!message?.sender_chat || !message.chat) return false;
  return message.sender_chat.id === message.chat.id;
}

/** 频道身份发言：sender_chat 是关联频道 */
export function isChannelSender(message: SenderProbe | undefined): boolean {
  if (!message?.sender_chat || !message.chat) return false;
  return message.sender_chat.id !== message.chat.id;
}

/** 匿名管理员或频道身份 —— 这两种情况 Telegram 只允许管理员使用 */
export function isPrivilegedSender(message: SenderProbe | undefined): boolean {
  return isAnonymousGroupPost(message) || isChannelSender(message);
}

/** 展示用名字：匿名管理员显示群名，频道身份显示频道名 */
export function senderLabel(message: SenderProbe | undefined): string {
  if (!message) return "未知发送者";
  if (message.sender_chat) return message.sender_chat.title ?? String(message.sender_chat.id);
  return displayName(message.from);
}

export async function isChatAdmin(api: Api, chatId: number, userId: number): Promise<boolean> {
  try {
    const member = await api.getChatMember(chatId, userId);
    return member.status === "administrator" || member.status === "creator";
  } catch {
    return false;
  }
}

export async function isChatOwner(api: Api, chatId: number, userId: number): Promise<boolean> {
  try {
    const member = await api.getChatMember(chatId, userId);
    return member.status === "creator";
  } catch {
    return false;
  }
}

/** 延迟删除消息（失败静默） */
export function scheduleDelete(api: Api, chatId: number, messageId: number, seconds: number): void {
  if (seconds <= 0) return;
  const timer = setTimeout(() => {
    void api.deleteMessage(chatId, messageId).catch(() => undefined);
  }, seconds * 1000);
  timer.unref?.();
}

/** 发送一条会自动消失的提示，返回消息 ID */
export async function sendAutoDelete(
  api: Api,
  chatId: number,
  html: string,
  seconds: number,
  replyTo?: number,
): Promise<number | undefined> {
  try {
    const sent = await api.sendMessage(chatId, html, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    });
    if (seconds > 0) scheduleDelete(api, chatId, sent.message_id, seconds);
    return sent.message_id;
  } catch {
    return undefined;
  }
}

/** 消息跳转链接（supergroup 用 c/，普通 group 直接拼接） */
export function messageLink(chatId: number, messageId: number, isSupergroup = true): string {
  if (String(chatId).startsWith("-100") && isSupergroup) {
    return `https://t.me/c/${String(chatId).slice(4)}/${messageId}`;
  }
  return `https://t.me/c/${String(chatId).replace(/^-/, "")}/${messageId}`;
}
