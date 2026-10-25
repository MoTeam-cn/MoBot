import { normalizeText, squeezeText } from "./normalize";
import type { KeywordRule } from "../types";

export interface CompiledRule {
  rule: KeywordRule;
  /** 归一化后的 pattern */
  normalized: string;
  /** 挤压后的 pattern（去掉标点空白） */
  squeezed: string;
  regex?: RegExp;
}

export interface MatchResult {
  rule: KeywordRule;
  /** 命中的片段（用于日志/提示） */
  fragment: string;
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 校验规则是否可用，返回错误信息（null 表示通过） */
export function validatePattern(pattern: string, mode: KeywordRule["mode"]): string | null {
  const trimmed = pattern.trim();
  if (!trimmed) return "关键词不能为空";
  if (trimmed.length > 200) return "关键词过长（上限 200 字符）";
  if (mode === "regex") {
    try {
      new RegExp(trimmed, "iu");
    } catch (error) {
      return `正则无效：${(error as Error).message}`;
    }
    return null;
  }
  if (mode !== "contains" && mode !== "whole") return "未知的匹配模式";
  if (squeezeText(trimmed).length === 0) return "关键词至少要包含一个文字或数字";
  return null;
}

export function compileRule(rule: KeywordRule): CompiledRule | null {
  if (!rule.enabled) return null;
  const normalized = normalizeText(rule.pattern);
  const squeezed = squeezeText(rule.pattern);
  if (!normalized) return null;
  const compiled: CompiledRule = { rule, normalized, squeezed };
  if (rule.mode === "regex") {
    try {
      compiled.regex = new RegExp(rule.pattern, "iu");
    } catch {
      return null;
    }
  }
  return compiled;
}

export function compileRules(rules: readonly KeywordRule[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];
  for (const rule of rules) {
    const item = compileRule(rule);
    if (item) compiled.push(item);
  }
  return compiled;
}

/**
 * 整词匹配的正则：前后不能紧邻 ASCII 字母/数字/下划线。
 * 中日韩没有空格分词，所以中文关键词允许被汉字包围（「广告」能命中「看广告」），
 * 但不会命中「adsl」这类英文词内片段。
 */
function wholeWordRegex(normalizedPattern: string): RegExp {
  return new RegExp(String.raw`(?<![0-9A-Za-z_])${escapeRegExp(normalizedPattern)}(?![0-9A-Za-z_])`, "iu");
}

function fragmentOf(text: string, needle: string, fallback: string): string {
  const index = text.indexOf(needle);
  if (index < 0 || !needle) return fallback;
  const from = Math.max(0, index - 10);
  const to = Math.min(text.length, index + needle.length + 10);
  return text.slice(from, to).trim();
}

/**
 * 在文本中查找首个命中的关键词规则。
 * contains 模式同时比对"归一化文本"和"去符号文本"，可命中「广 告」「广-告」「ＶＸ」等变体。
 */
export function findKeywordMatch(text: string, rules: readonly CompiledRule[]): MatchResult | undefined {
  if (!text) return undefined;
  const normalized = normalizeText(text);
  if (!normalized) return undefined;
  const squeezed = squeezeText(text);

  for (const compiled of rules) {
    const { rule } = compiled;
    if (rule.mode === "regex") {
      if (!compiled.regex) continue;
      compiled.regex.lastIndex = 0;
      const hit = compiled.regex.exec(normalized) ?? compiled.regex.exec(text);
      if (hit) {
        return { rule, fragment: fragmentOf(normalized, hit[0], hit[0]) };
      }
      continue;
    }
    if (rule.mode === "whole") {
      const regex = wholeWordRegex(compiled.normalized);
      const hit = regex.exec(normalized);
      if (hit) return { rule, fragment: fragmentOf(normalized, hit[0], hit[0]) };
      continue;
    }
    // contains
    if (compiled.normalized && normalized.includes(compiled.normalized)) {
      return { rule, fragment: fragmentOf(normalized, compiled.normalized, compiled.normalized) };
    }
    if (compiled.squeezed && squeezed.includes(compiled.squeezed)) {
      return { rule, fragment: fragmentOf(squeezed, compiled.squeezed, compiled.squeezed) };
    }
  }
  return undefined;
}
