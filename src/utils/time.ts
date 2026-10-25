const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  sec: 1,
  m: 60,
  min: 60,
  h: 3600,
  d: 86400,
  w: 604800,
};

/**
 * 解析时长："30s" "10m" "2h" "1d" "1h30m" "90"（纯数字按分钟）
 * 返回秒数，非法返回 null。
 */
export function parseDuration(input: string | undefined): number | null {
  const raw = (input ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const minutes = Number(raw);
    return minutes > 0 ? minutes * 60 : null;
  }
  const matches = raw.matchAll(/(\d+)\s*(s|sec|m|min|h|d|w)/g);
  let total = 0;
  let consumed = "";
  for (const match of matches) {
    const amount = Number(match[1]);
    const unit = match[2] ?? "m";
    const factor = UNIT_SECONDS[unit];
    if (!factor || !Number.isFinite(amount)) return null;
    total += amount * factor;
    consumed += match[0];
  }
  if (total <= 0) return null;
  if (consumed.replace(/\s+/g, "") !== raw.replace(/\s+/g, "")) return null;
  return total;
}

export function humanizeDuration(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  if (value === 0) return "0 秒";
  const parts: string[] = [];
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  if (days) parts.push(`${days} 天`);
  if (hours) parts.push(`${hours} 小时`);
  if (minutes) parts.push(`${minutes} 分`);
  if (secs && !days && !hours) parts.push(`${secs} 秒`);
  return parts.join(" ") || `${value} 秒`;
}

export function formatDateTime(timestamp: number): string {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function secondsSince(timestamp: number): number {
  return Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
}
