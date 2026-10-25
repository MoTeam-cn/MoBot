import type { Transformer } from "grammy";
import type { Logger } from "../logger";
import { isEntityParseError, stripTelegramHtml } from "../utils/html";

/**
 * 兜底转换器：一旦 Telegram 报 "can't parse entities"（消息里有未转义的 < 或 &），
 * 自动把这条消息降级成纯文本重发，避免用户"发了命令却毫无反应"。
 * 只重试一次，且只在 payload 带 text/caption 时生效。
 */
export function createHtmlFallbackTransformer(logger: Logger): Transformer {
  return async (prev, method, payload, signal) => {
    try {
      return await prev(method, payload, signal);
    } catch (error) {
      if (!isEntityParseError(error)) throw error;
      const record = { ...(payload as Record<string, unknown>) };
      let downgraded = false;
      if (typeof record.text === "string") {
        record.text = stripTelegramHtml(record.text);
        downgraded = true;
      }
      if (typeof record.caption === "string") {
        record.caption = stripTelegramHtml(record.caption);
        downgraded = true;
      }
      if (!downgraded) throw error;
      delete record.parse_mode;
      logger.warn("HTML 解析失败，已降级为纯文本重发", {
        method,
        description: (error as { description?: string }).description,
      });
      return await prev(method, record as never, signal);
    }
  };
}
