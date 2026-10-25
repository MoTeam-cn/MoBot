import { displayName, escapeHtml, type UserLike } from "./telegram";

/** 渲染欢迎语占位符：{name} {username} {id} {chat} */
export function renderWelcome(template: string, member: UserLike, chatTitle: string): string {
  return template
    .replace(/\{name\}/g, escapeHtml(displayName(member)))
    .replace(/\{username\}/g, member.username ? "@" + member.username : "")
    .replace(/\{id\}/g, String(member.id))
    .replace(/\{chat\}/g, escapeHtml(chatTitle));
}
