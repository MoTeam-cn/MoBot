import { config as loadDotenv } from "dotenv";
import path from "node:path";

/**
 * 只保留启动必需项：机器人 token 与少量运行参数。
 * 超管、管理员、群配置、验证设置等全部存在数据库里，通过私聊命令初始化。
 */
export interface AppConfig {
  botToken: string;
  dataDir: string;
  /** 网页验证 HTTP 服务端口 */
  webPort: number;
  /** 网页验证公网地址（也可在私聊 /config publicUrl 里设置，DB 优先） */
  publicUrl?: string;
  /** Telegram API 代理（http/https/socks5），数据库 /proxy 设置优先 */
  proxyUrl?: string;
  /** 试运行：不真正执行删除/禁言/封禁 */
  dryRun: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

function parseOptionalId(raw: string | undefined, field: string): number | undefined {
  const value = (raw ?? "").trim();
  if (!value) return undefined;
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num === 0) {
    throw new ConfigError(`${field} 必须是合法整数，当前值："${value}"`);
  }
  return num;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  loadDotenv();

  const botToken = (env.BOT_TOKEN ?? "").trim();
  if (!botToken) {
    throw new ConfigError("缺少 BOT_TOKEN：请在 .env 或环境变量里填入 @BotFather 给的 token");
  }
  if (!/^\d+:[\w-]+$/.test(botToken)) {
    throw new ConfigError("BOT_TOKEN 格式不正确，应形如 123456789:AAxxxx");
  }

  const level = (env.LOG_LEVEL ?? "info").trim().toLowerCase();
  const logLevel: AppConfig["logLevel"] =
    level === "debug" || level === "warn" || level === "error" || level === "info" ? level : "info";

  const publicUrlRaw = (env.PUBLIC_URL ?? "").trim();
  const proxyRaw = (
    env.TG_PROXY ?? env.ALL_PROXY ?? env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy ?? ""
  ).trim();

  return {
    botToken,
    dataDir: path.resolve((env.DATA_DIR ?? "./data").trim() || "./data"),
    webPort: parseOptionalId(env.WEB_PORT, "WEB_PORT") ?? 8080,
    publicUrl: publicUrlRaw ? publicUrlRaw.replace(/\/+$/, "") : undefined,
    proxyUrl: proxyRaw || undefined,
    dryRun: (env.DRY_RUN ?? "").trim().toLowerCase() === "true",
    logLevel,
  };
}
