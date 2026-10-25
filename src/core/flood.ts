/**
 * 简易滑动窗口刷屏统计：内存实现，重启后清零。
 */
export class FloodTracker {
  private buckets = new Map<string, number[]>();

  private static key(chatId: number, userId: number): string {
    return `${chatId}:${userId}`;
  }

  /** 记录一条消息，返回窗口内的消息条数 */
  hit(chatId: number, userId: number, windowSeconds: number, now = Date.now()): number {
    const key = FloodTracker.key(chatId, userId);
    const windowMs = Math.max(1, windowSeconds) * 1000;
    const list = (this.buckets.get(key) ?? []).filter((ts) => now - ts <= windowMs);
    list.push(now);
    this.buckets.set(key, list);
    return list.length;
  }

  reset(chatId: number, userId: number): void {
    this.buckets.delete(FloodTracker.key(chatId, userId));
  }

  /** 清理过期桶，避免长期运行内存膨胀 */
  prune(windowSeconds: number, now = Date.now()): number {
    const windowMs = Math.max(1, windowSeconds) * 1000;
    let removed = 0;
    for (const [key, list] of this.buckets) {
      const alive = list.filter((ts) => now - ts <= windowMs);
      if (alive.length === 0) {
        this.buckets.delete(key);
        removed += 1;
      } else if (alive.length !== list.length) {
        this.buckets.set(key, alive);
      }
    }
    return removed;
  }

  get size(): number {
    return this.buckets.size;
  }
}
