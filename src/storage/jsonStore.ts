import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "../logger";

export interface JsonStoreOptions<T> {
  filePath: string;
  defaults: () => T;
  logger: Logger;
  /** 旧数据迁移：拿到磁盘上的原始 JSON，返回迁移后的结构 */
  migrate?: (raw: unknown, defaults: T) => T;
  /** 变更后延迟落盘毫秒数 */
  debounceMs?: number;
}

/**
 * 极简 JSON 持久化：内存中读写 + 防抖原子落盘。
 * 群配置量级很小，无需引入数据库依赖。
 */
export class JsonStore<T> {
  private data: T;
  private timer: NodeJS.Timeout | null = null;
  private chain: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly options: JsonStoreOptions<T>) {
    this.data = options.defaults();
  }

  get value(): T {
    return this.data;
  }

  get filePath(): string {
    return this.options.filePath;
  }

  async load(): Promise<T> {
    const { filePath, defaults, migrate, logger } = this.options;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.data = defaults();
        await this.writeNow();
        logger.info("已创建初始数据文件", { filePath });
        return this.data;
      }
      throw error;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      this.data = migrate ? migrate(parsed, defaults()) : (parsed as T);
      logger.info("已加载数据文件", { filePath });
    } catch (error) {
      const backup = `${filePath}.corrupt-${Date.now()}`;
      await fs.rename(filePath, backup).catch(() => undefined);
      this.data = defaults();
      logger.error("数据文件损坏，已备份并重置", { filePath, backup, error: String(error) });
      await this.writeNow();
    }
    return this.data;
  }

  /** 从磁盘重新加载（热更新：外部编辑 / 备份还原后无需重启） */
  async reload(): Promise<T> {
    const { filePath, defaults, migrate, logger } = this.options;
    const raw = await fs.readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    this.data = migrate ? migrate(parsed, defaults()) : (parsed as T);
    logger.info("已从磁盘热加载数据", { filePath });
    return this.data;
  }

  /** 标记变更，防抖落盘 */
  markDirty(): void {
    if (this.closed) return;
    if (this.timer) return;
    const delay = this.options.debounceMs ?? 300;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.save();
    }, delay);
    this.timer.unref?.();
  }

  /** 立即落盘（排队执行，避免并发写坏文件） */
  async save(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.chain = this.chain.then(() => this.writeNow()).catch((error: unknown) => {
      this.options.logger.error("写入数据文件失败", error);
    });
    return this.chain;
  }

  async flush(): Promise<void> {
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.save();
  }

  private async writeNow(): Promise<void> {
    const { filePath, logger } = this.options;
    const tmp = `${filePath}.tmp`;
    const payload = `${JSON.stringify(this.data, null, 2)}\n`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(tmp, payload, "utf8");
    await fs.rename(tmp, filePath);
    logger.debug("数据已落盘", { filePath, bytes: payload.length });
  }
}
