export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const LEVEL_LABEL: Record<LogLevel, string> = { debug: "DEBUG", info: "INFO ", warn: "WARN ", error: "ERROR" };

const NO_COLOR = Boolean(process.env.NO_COLOR);
const COLOR: Record<LogLevel, string> = {
  debug: "\u001b[90m",
  info: "\u001b[36m",
  warn: "\u001b[33m",
  error: "\u001b[31m",
};

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  child(scope: string): Logger;
}

function timestamp(): string {
  const now = new Date();
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(
      now.getMinutes(),
    )}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`
  );
}

function formatMeta(meta: unknown): string {
  if (meta === undefined) return "";
  if (meta instanceof Error) return ` ${meta.stack ?? meta.message}`;
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ` ${String(meta)}`;
  }
}

export function createLogger(scope = "app", minLevel: LogLevel = "info"): Logger {
  const threshold = LEVEL_WEIGHT[minLevel];

  const emit = (level: LogLevel, message: string, meta?: unknown) => {
    if (LEVEL_WEIGHT[level] < threshold) return;
    const head = `${timestamp()} ${LEVEL_LABEL[level]} [${scope}]`;
    const line = `${head} ${message}${formatMeta(meta)}`;
    const text = NO_COLOR ? line : `${COLOR[level]}${line}\u001b[0m`;
    if (level === "error") console.error(text);
    else if (level === "warn") console.warn(text);
    else console.log(text);
  };

  return {
    debug: (message, meta) => emit("debug", message, meta),
    info: (message, meta) => emit("info", message, meta),
    warn: (message, meta) => emit("warn", message, meta),
    error: (message, meta) => emit("error", message, meta),
    child: (childScope) => createLogger(`${scope}:${childScope}`, minLevel),
  };
}

export const rootLogger = createLogger("bot");
