import { combiningRatio, countCombining } from "./normalize";

/** 常见链接形态：协议头、www.、裸域名、t.me 邀请 */
const URL_PATTERN =
  /(?:https?:\/\/|tg:\/\/|www\.)[^\s]+|(?<![\w@.])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|cn|io|me|cc|tv|xyz|top|vip|club|shop|site|online|app|link|biz|info|pro|dev|fun|icu|work|live|space|store|tech|ru|jp|hk|tw|uk|de|us)(?:\/[^\s]*)?(?![\w@])/iu;

/** Telegram 链接（群邀请、用户名跳转） */
const TELEGRAM_PATTERN = /(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/[a-z0-9_+\-]+/iu;

export interface DetectionResult {
  /** 触发原因，写进提示与日志 */
  reason: string;
  /** 检测器标识 */
  kind: "link" | "forward" | "zalgo" | "flood";
}

export function detectLink(text: string): DetectionResult | undefined {
  if (!text) return undefined;
  if (TELEGRAM_PATTERN.test(text)) return { kind: "link", reason: "发送 Telegram 链接/邀请" };
  const hit = URL_PATTERN.exec(text);
  if (hit) {
    const fragment = hit[0].slice(0, 60);
    return { kind: "link", reason: `发送链接：${fragment}` };
  }
  return undefined;
}

export interface ForwardProbe {
  forward_origin?: unknown;
  forward_from?: unknown;
  forward_from_chat?: unknown;
  forward_sender_name?: unknown;
  forward_date?: number;
}

export function isForwarded(message: ForwardProbe): boolean {
  return Boolean(
    message.forward_origin ||
      message.forward_from ||
      message.forward_from_chat ||
      message.forward_sender_name ||
      message.forward_date,
  );
}

/** 乱码（zalgo）：组合字符过多 */
export function detectZalgo(text: string): DetectionResult | undefined {
  if (!text) return undefined;
  const marks = countCombining(text);
  if (marks >= 8 && combiningRatio(text) > 0.15) {
    return { kind: "zalgo", reason: "发送乱码/刷屏字符" };
  }
  return undefined;
}
