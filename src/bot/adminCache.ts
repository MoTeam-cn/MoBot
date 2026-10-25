import type { Api } from "grammy";

/**
 * 群管理员缓存：避免每条消息都调用 getChatAdministrators（Telegram 限流很严）。
 */
export class AdminCache {
  private cache = new Map<number, { ids: Set<number>; expiresAt: number }>();

  constructor(private readonly ttlMs = 60_000) {}

  async get(api: Api, chatId: number): Promise<Set<number>> {
    const cached = this.cache.get(chatId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.ids;
    try {
      const admins = await api.getChatAdministrators(chatId);
      const ids = new Set<number>();
      for (const member of admins) {
        if (member.user && !member.user.is_bot) ids.add(member.user.id);
      }
      this.cache.set(chatId, { ids, expiresAt: now + this.ttlMs });
      return ids;
    } catch {
      // 取不到时退回旧缓存（可能为空），避免每条消息都打接口
      const fallback = cached?.ids ?? new Set<number>();
      this.cache.set(chatId, { ids: fallback, expiresAt: now + 10_000 });
      return fallback;
    }
  }

  invalidate(chatId: number): void {
    this.cache.delete(chatId);
  }

  clear(): void {
    this.cache.clear();
  }
}
