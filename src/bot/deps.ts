import type { Bot } from "grammy";
import type { AppConfig } from "../config";
import type { Logger } from "../logger";
import type { Moderator } from "../core/moderator";
import type { FloodTracker } from "../core/flood";
import type { CaptchaService } from "../captcha/service";
import type { TelegramTransport } from "../net/transport";
import type { Repository } from "../storage/repository";
import type { AdminCache } from "./adminCache";

export interface BotDeps {
  config: AppConfig;
  logger: Logger;
  repo: Repository;
  moderator: Moderator;
  captcha: CaptchaService;
  transport: TelegramTransport;
  adminCache: AdminCache;
  flood: FloodTracker;
  bot?: Bot;
}
