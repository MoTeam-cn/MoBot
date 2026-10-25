import path from "node:path";
import { ConfigError, loadConfig } from "./config";
import { createLogger } from "./logger";
import { JsonStore } from "./storage/jsonStore";
import { DEFAULT_WELCOME_TEXT, Repository, createEmptyState, migrateState } from "./storage/repository";
import { Moderator } from "./core/moderator";
import { FloodTracker } from "./core/flood";
import { CaptchaService } from "./captcha/service";
import { randomSetupToken } from "./captcha/code";
import { startWebVerifyServer, type WebVerifyServer } from "./captcha/webServer";
import { AdminCache } from "./bot/adminCache";
import { TelegramTransport } from "./net/transport";
import { proxyLabel } from "./net/proxy";
import { ALLOWED_UPDATES, createBot } from "./bot/bot";
import { pushCommandMenus } from "./bot/menus";
import type { BotDeps } from "./bot/deps";
import type { StateFile } from "./types";

function printSetupBanner(token: string, botUsername: string): void {
  const line = "═".repeat(58);
  console.log("");
  console.log(line);
  console.log("  首次启动 · 初始化引导（只需做一次）");
  console.log(line);
  console.log("  1) 打开 Telegram，私聊机器人：" + (botUsername ? "@" + botUsername : "（见下方用户名）"));
  console.log("  2) 发送下面这条命令：");
  console.log("");
  console.log("        /setup " + token);
  console.log("");
  console.log("  第一个完成 /setup 的用户将成为【超级管理员】，可管理一切。");
  console.log("  token 只用于初始化，用掉即失效；重启会重新提示同一个 token。");
  console.log(line);
  console.log("");
}

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error("❌ 配置错误：" + error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const logger = createLogger("app", config.logLevel);
  logger.info("正在启动群管机器人", { dataDir: config.dataDir, dryRun: config.dryRun });

  const store = new JsonStore<StateFile>({
    filePath: path.join(config.dataDir, "state.json"),
    defaults: createEmptyState,
    migrate: migrateState,
    logger,
  });
  await store.load();

  const repo = new Repository(store, {
    warnLimit: 3,
    muteSeconds: 600,
    welcomeText: DEFAULT_WELCOME_TEXT,
  });

  const moderator = new Moderator({ repo, config, logger });
  const captcha = new CaptchaService({ repo, moderator, logger, config });

  // 代理：数据库（/proxy）优先，其次环境变量 TG_PROXY
  const transport = new TelegramTransport(logger, repo.profile.proxyUrl ?? config.proxyUrl);
  logger.info("Telegram 传输层就绪", { proxy: proxyLabel(transport.proxy) });

  const deps: BotDeps = {
    config,
    logger,
    repo,
    moderator,
    captcha,
    transport,
    adminCache: new AdminCache(),
    flood: new FloodTracker(),
  };

  const bot = createBot(deps);
  try {
    await bot.init();
  } catch (error) {
    const description = String((error as { description?: string }).description ?? (error as Error).message ?? error);
    logger.error("登录失败：无法通过 Telegram API 校验 token", {
      error: description,
      proxy: proxyLabel(transport.proxy),
    });
    if (/401|Unauthorized/i.test(description)) {
      console.error("❌ BOT_TOKEN 无效（401 Unauthorized）。请检查 .env 里的 token。");
    } else if (/ENOTFOUND|ECONNREFUSED|fetch failed|ETIMEDOUT/i.test(description)) {
      console.error("❌ 无法连接 api.telegram.org，请检查网络或代理（/proxy、TG_PROXY）。");
    }
    await transport.close().catch(() => undefined);
    process.exitCode = 1;
    return;
  }
  logger.info("已登录 @" + bot.botInfo.username + "（" + bot.botInfo.id + "）");

  // 命令菜单（私聊 / 群 / 群管理员）
  await pushCommandMenus(bot.api, logger);

  // 初始化 token
  if (!repo.isInitialized()) {
    let token = repo.profile.setupToken;
    if (!token) {
      token = randomSetupToken();
      repo.setSetupToken(token);
      await repo.flush();
    }
    printSetupBanner(token, bot.botInfo.username);
    logger.warn("机器人尚未初始化：等待超管私聊发送 /setup <token>");
  } else {
    const profile = repo.profile;
    logger.info("已初始化", {
      superAdmins: profile.superAdmins,
      admins: profile.admins.length,
      groups: repo.listGroups().length,
    });
  }

  // 网页验证服务
  let web: WebVerifyServer | undefined;
  const publicUrl = repo.profile.publicUrl ?? config.publicUrl;
  if (publicUrl) {
    try {
      web = await startWebVerifyServer({
        logger,
        port: config.webPort,
        getChallenge: (token) => repo.findChallengeByToken(token),
        onVerified: async (challenge) => {
          await captcha.verifyByChallenge(challenge);
        },
      });
      logger.info("网页验证地址", { publicUrl });
    } catch (error) {
      logger.error("网页验证服务启动失败，将自动降级为图像验证码", { error: String(error) });
    }
  } else {
    logger.info("未配置 publicUrl：网页验证模式会自动降级为图像验证码（可用 /config publicUrl 设置）");
  }

  // 恢复未完成的入群验证
  const restored = await captcha.restore();
  if (restored > 0) logger.info("已恢复未完成的入群验证", { count: restored });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info("收到 " + signal + "，正在退出…");
    captcha.stop();
    if (web) await web.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    try {
      await bot.stop();
    } catch {
      // 忽略
    }
    await repo.flush();
    logger.info("已保存数据，退出完成");
  };

  // 热加载：修改 state.json 后 kill -HUP（Windows 可用 /reload 命令）
  const hotReload = async () => {
    try {
      await repo.reload();
      transport.setProxy(repo.profile.proxyUrl ?? config.proxyUrl);
      const restored = await captcha.rearm();
      await pushCommandMenus(bot.api, logger);
      logger.info("热加载完成", { groups: repo.listGroups().length, challenges: restored });
    } catch (error) {
      logger.error("热加载失败", { error: String(error) });
    }
  };
  process.on("SIGHUP", () => void hotReload());

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    logger.error("未处理的 Promise 拒绝", { error: reason instanceof Error ? reason.stack : String(reason) });
  });

  logger.info("开始接收更新", { groups: repo.listGroups().length });
  await bot.start({ allowed_updates: [...ALLOWED_UPDATES] });
}

void main().catch((error: unknown) => {
  console.error("❌ 启动失败：", error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
