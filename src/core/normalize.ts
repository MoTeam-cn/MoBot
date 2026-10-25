/** 零宽 / 方向控制等不可见字符 */
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g;

/** 组合用变音符号（zalgo 主要来源） */
const COMBINING = /[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g;

/**
 * 归一化：NFKC（全角转半角、兼容字符折叠）+ 去不可见字符 + 合并空白 + 小写。
 * 用于关键词 contains / whole 匹配，可抵抗 "广 告"、"Ｖ Ｘ"、"广\u200B告" 这类变形。
 */
export function normalizeText(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/[\t\r\n\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 归一化并去掉所有标点、符号与空白，用于"挤压"式包含匹配 */
export function squeezeText(input: string): string {
  return normalizeText(input).replace(/[^\p{L}\p{N}]+/gu, "");
}

/** 统计组合字符数量，用于 zalgo 检测 */
export function countCombining(input: string): number {
  return (input.match(COMBINING) ?? []).length;
}

/** 组合字符占比 */
export function combiningRatio(input: string): number {
  if (!input) return 0;
  const marks = countCombining(input);
  if (!marks) return 0;
  const chars = Array.from(input).length || 1;
  return marks / chars;
}
