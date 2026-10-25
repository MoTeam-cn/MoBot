export interface ParsedArgs {
  /** 位置参数（已按引号切分） */
  positional: string[];
  /** --flag value 或 --flag=value 形式的选项 */
  flags: Record<string, string>;
  /** 仅出现、无值的开关 */
  switches: Set<string>;
}

/**
 * 解析命令参数：支持 "双引号 词组"、'单引号'、--key=value、--key value、--switch。
 */
export function parseArgs(input: string | undefined): ParsedArgs {
  const text = (input ?? "").trim();
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  const switches = new Set<string>();
  if (!text) return { positional, flags, switches };

  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasContent = false;

  for (const char of text) {
    if (quote) {
      if (char === quote) {
        quote = null;
        tokens.push(current);
        current = "";
        hasContent = false;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasContent = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (hasContent || current) {
        tokens.push(current);
        current = "";
        hasContent = false;
      }
      continue;
    }
    current += char;
    hasContent = true;
  }
  if (hasContent || current) tokens.push(current);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    if (token.startsWith("--")) {
      const body = token.slice(2);
      if (!body) continue;
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags[body.slice(0, eq).toLowerCase()] = body.slice(eq + 1);
        continue;
      }
      const next = tokens[index + 1];
      if (next && !next.startsWith("--")) {
        flags[body.toLowerCase()] = next;
        index += 1;
      } else {
        switches.add(body.toLowerCase());
        flags[body.toLowerCase()] = "true";
      }
      continue;
    }
    positional.push(token);
  }

  return { positional, flags, switches };
}

/** 取出并移除首个位置参数 */
export function shift(positional: string[]): string | undefined {
  return positional.shift();
}
