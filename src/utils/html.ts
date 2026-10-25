/** Telegram HTML 模式允许的标签 */
const ALLOWED_TAG = /<\/?(?:b|i|u|s|code|pre|a|em|strong|ins|del|span|blockquote|tg-spoiler)(?:\s[^>]*)?>/gi;

/**
 * 把 Telegram HTML 文本降级成纯文本：
 * 去掉受支持的标签、还原实体，保证"解析失败后重发"不会再次失败。
 */
export function stripTelegramHtml(input: string): string {
  return input
    .replace(ALLOWED_TAG, "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 是否是"实体解析失败"（未转义的 <、& 等）导致的 400 */
export function isEntityParseError(error: unknown): boolean {
  const description = String((error as { description?: string })?.description ?? (error as Error)?.message ?? "");
  return /can't parse entities|unsupported start tag|unsupported end tag|unmatched end tag/i.test(description);
}
