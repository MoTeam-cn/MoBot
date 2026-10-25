import type { Bot, Context } from "grammy";
import type { BotDeps } from "../deps";
import type { Guards } from "../guards";
import { registerBasicCommands } from "./basic";
import { registerPrivateCommands } from "./private";
import { registerGroupCommands } from "./groups";
import { registerKeywordCommands } from "./keywords";
import { registerSettingsCommands } from "./settings";
import { registerModerationCommands } from "./moderation";
import { registerCallbacks } from "./callbacks";

export function registerCommands(bot: Bot<Context>, deps: BotDeps, guards: Guards): void {
  registerBasicCommands(bot, deps, guards);
  registerPrivateCommands(bot, deps, guards);
  registerGroupCommands(bot, deps, guards);
  registerKeywordCommands(bot, deps, guards);
  registerSettingsCommands(bot, deps, guards);
  registerModerationCommands(bot, deps, guards);
  registerCallbacks(bot, deps, guards);
}
