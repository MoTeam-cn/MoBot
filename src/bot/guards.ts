import type { Context, MiddlewareFn } from "grammy";
import type { BotDeps } from "./deps";
import { isChatAdmin, isPrivilegedSender } from "../utils/telegram";

export function isGroupContext(ctx: Context): boolean {
  const type = ctx.chat?.type;
  return type === "group" || type === "supergroup";
}

export function isPrivateContext(ctx: Context): boolean {
  return ctx.chat?.type === "private";
}

export function createGuards(deps: BotDeps) {
  /** 超级管理员：管理一切 */
  const isSuperAdmin = (ctx: Context): boolean => deps.repo.isSuperAdmin(ctx.from?.id);
  /** 普通管理员（含超管）：管理各群 */
  const isBotAdmin = (ctx: Context): boolean => deps.repo.isBotAdmin(ctx.from?.id);

  const privateOnly: MiddlewareFn<Context> = async (ctx, next) => {
    if (!isPrivateContext(ctx)) {
      await ctx.reply("⚠️ 该命令只能在私聊里使用。");
      return;
    }
    return next();
  };

  const groupOnly: MiddlewareFn<Context> = async (ctx, next) => {
    if (!isGroupContext(ctx)) {
      await ctx.reply("⚠️ 该命令只能在群组内使用。");
      return;
    }
    return next();
  };

  /** 仅"已登记"的受管群可用 */
  const managedGroup: MiddlewareFn<Context> = async (ctx, next) => {
    if (!isGroupContext(ctx) || !ctx.chat) {
      await ctx.reply("⚠️ 该命令只能在群组内使用。");
      return;
    }
    if (!deps.repo.hasGroup(ctx.chat.id)) {
      await ctx.reply(
        "⚠️ 本群尚未加入受管列表。\n请管理员在群里发送 /id 获取群 ID，再由超管私聊我执行 /addgroup <群ID>。",
      );
      return;
    }
    return next();
  };

  /** 群管理员，或机器人管理员（超管/普通管理员） */
  const groupAdmin: MiddlewareFn<Context> = async (ctx, next) => {
    if (!isGroupContext(ctx) || !ctx.chat || !ctx.from) {
      await ctx.reply("⚠️ 该命令只能在群组内使用。");
      return;
    }
    if (isBotAdmin(ctx)) return next();
    // 匿名管理员（以群组身份发言）与频道身份：Telegram 只允许管理员这样发，直接放行
    if (isPrivilegedSender(ctx.message)) return next();
    const ok = await isChatAdmin(ctx.api, ctx.chat.id, ctx.from.id);
    if (!ok) {
      await ctx.reply("🚫 只有群管理员或机器人管理员可以使用该命令。");
      return;
    }
    return next();
  };

  /** 仅机器人管理员（超管 + 普通管理员） */
  const botAdminOnly: MiddlewareFn<Context> = async (ctx, next) => {
    if (isBotAdmin(ctx)) return next();
    await ctx.reply("🚫 该命令仅限机器人管理员使用。");
  };

  /** 仅超级管理员 */
  const superAdminOnly: MiddlewareFn<Context> = async (ctx, next) => {
    if (isSuperAdmin(ctx)) return next();
    await ctx.reply("🚫 该命令仅限超级管理员使用。");
  };

  return { isSuperAdmin, isBotAdmin, privateOnly, groupOnly, managedGroup, groupAdmin, botAdminOnly, superAdminOnly };
}

export type Guards = ReturnType<typeof createGuards>;
