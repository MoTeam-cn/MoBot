import fs from "node:fs/promises";
import path from "node:path";
import type { Update, UserFromGetMe } from "grammy/types";
import type { Bot } from "grammy";
import { createBot } from "../src/bot/bot";
import type { BotDeps } from "../src/bot/deps";
import { AdminCache } from "../src/bot/adminCache";
import { Moderator } from "../src/core/moderator";
import { FloodTracker } from "../src/core/flood";
import { CaptchaService } from "../src/captcha/service";
import { TelegramTransport } from "../src/net/transport";
import { createLogger } from "../src/logger";
import { JsonStore } from "../src/storage/jsonStore";
import { Repository, createEmptyState, migrateState } from "../src/storage/repository";
import type { AppConfig } from "../src/config";
import type { StateFile } from "../src/types";

export const FAKE_BOT = {
  id: 999,
  is_bot: true,
  first_name: "GuardBot",
  username: "guard_test_bot",
  can_join_groups: true,
  can_read_all_group_messages: true,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as unknown as UserFromGetMe;

export const SUPER_ADMIN = 1;
export const GROUP_ID = -1001234567890;

export const logger = createLogger("test", "error");

export interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

export interface MockState {
  adminIds: number[];
  memberStatus: Map<number, string>;
  /** 私聊发送是否失败（模拟用户未 /start 过机器人） */
  dmBlocked: boolean;
  /** getChat 返回的群标题（可含 HTML 特殊字符） */
  chatTitle: string;
}

export interface TestEnv {
  deps: BotDeps;
  bot: Bot<never>;
  calls: ApiCall[];
  repo: Repository;
  mock: MockState;
  dir: string;
}

export function mockResult(method: string, payload: Record<string, unknown>, mock: MockState): unknown {
  switch (method) {
    case "getMe":
      return FAKE_BOT;
    case "getChatAdministrators":
      return mock.adminIds.map((id) => ({
        status: "administrator",
        user: { id, is_bot: false, first_name: "Admin" + id },
        can_be_edited: false,
        is_anonymous: false,
        can_manage_chat: true,
        can_delete_messages: true,
        can_manage_video_chats: true,
        can_restrict_members: true,
        can_promote_members: false,
        can_change_info: true,
        can_invite_users: true,
      }));
    case "getChatMember": {
      const userId = Number(payload.user_id);
      const status = mock.memberStatus.get(userId) ?? "member";
      return { status, user: { id: userId, is_bot: false, first_name: "User" + userId } };
    }
    case "getChat":
      return { id: payload.chat_id, type: "supergroup", title: mock.chatTitle };
    case "sendMessage":
    case "sendPhoto":
      return {
        message_id: 5000,
        date: Math.floor(Date.now() / 1000),
        chat: { id: payload.chat_id, type: "supergroup" },
        text: payload.text ?? payload.caption,
      };
    default:
      return true;
  }
}

export async function createEnv(options: {
  dryRun?: boolean;
  initialize?: boolean;
  dmBlocked?: boolean;
} = {}): Promise<TestEnv> {
  const dir = path.join(process.cwd(), "data", ".test-" + Math.random().toString(36).slice(2));
  await fs.mkdir(dir, { recursive: true });

  const store = new JsonStore<StateFile>({
    filePath: path.join(dir, "state.json"),
    defaults: createEmptyState,
    migrate: migrateState,
    logger,
  });
  await store.load();

  const config: AppConfig = {
    botToken: "123456:TEST-TOKEN",
    dataDir: dir,
    webPort: 0,
    publicUrl: undefined,
    dryRun: options.dryRun ?? false,
    logLevel: "error",
  };
  const repo = new Repository(store, { warnLimit: 3, muteSeconds: 600, welcomeText: "欢迎 {name}" });
  const moderator = new Moderator({ repo, config, logger });
  const captcha = new CaptchaService({ repo, moderator, logger, config });
  const transport = new TelegramTransport(logger);

  const deps: BotDeps = {
    config,
    logger,
    repo,
    moderator,
    captcha,
    transport,
    adminCache: new AdminCache(1000),
    flood: new FloodTracker(),
  };

  if (options.initialize !== false) repo.completeSetup(SUPER_ADMIN);

  const bot = createBot(deps, { botInfo: FAKE_BOT }) as unknown as Bot<never>;
  const calls: ApiCall[] = [];
  const mock: MockState = {
    adminIds: [],
    memberStatus: new Map(),
    dmBlocked: options.dmBlocked ?? false,
    chatTitle: "测试群",
  };

  (bot as unknown as { api: { config: { use: (fn: unknown) => void } } }).api.config.use(
    async (_prev: unknown, method: string, payload: Record<string, unknown>) => {
      calls.push({ method, payload });
      const isPrivateTarget = typeof payload.chat_id === "number" && payload.chat_id > 0;
      if (mock.dmBlocked && isPrivateTarget && (method === "sendMessage" || method === "sendPhoto")) {
        throw new Error("Forbidden: bot can't initiate conversation with a user");
      }
      return { ok: true, result: mockResult(method, payload, mock) };
    },
  );

  return { deps, bot, calls, repo, mock, dir };
}

export async function cleanupEnv(env: TestEnv): Promise<void> {
  env.deps.captcha.stop();
  await env.deps.transport.close().catch(() => undefined);
  await env.repo.flush();
  await fs.rm(env.dir, { recursive: true, force: true });
}

let updateId = 1;

export const ANONYMOUS_BOT_ID = 1087968824;

export function textUpdate(options: {
  chatId?: number;
  userId: number;
  text: string;
  messageId?: number;
  chatType?: "private" | "group" | "supergroup";
  /** 以群组身份（匿名管理员）或频道身份发言 */
  senderChat?: { id: number; type: string; title?: string; username?: string };
  /** 被回复的消息来自匿名管理员/频道 */
  replyToSenderChat?: { id: number; type: string; title?: string };
  replyToUserId?: number;
}): Update {
  const command = options.text.startsWith("/") ? options.text.split(" ")[0] ?? "" : "";
  const chatType = options.chatType ?? "supergroup";
  const message: Record<string, unknown> = {
    message_id: options.messageId ?? 10,
    date: Math.floor(Date.now() / 1000),
    chat:
      chatType === "private"
        ? { id: options.chatId ?? options.userId, type: "private", first_name: "User" }
        : { id: options.chatId ?? GROUP_ID, type: "supergroup", title: "测试群" },
    from: { id: options.userId, is_bot: false, first_name: "Tester" + options.userId, language_code: "zh" },
    text: options.text,
  };
  if (command) message.entities = [{ type: "bot_command", offset: 0, length: command.length }];
  if (options.senderChat) message.sender_chat = options.senderChat;
  if (options.replyToSenderChat || options.replyToUserId) {
    message.reply_to_message = {
      message_id: (options.messageId ?? 10) - 1,
      date: Math.floor(Date.now() / 1000),
      chat: message.chat,
      ...(options.replyToSenderChat
        ? { sender_chat: options.replyToSenderChat, from: { id: ANONYMOUS_BOT_ID, is_bot: true, first_name: "Group" } }
        : { from: { id: options.replyToUserId, is_bot: false, first_name: "User" + options.replyToUserId } }),
      text: "被回复的消息",
    };
  }
  return { update_id: updateId++, message } as unknown as Update;
}

export function joinUpdate(options: {
  chatId?: number;
  userId: number;
  messageId?: number;
  inviterId?: number;
}): Update {
  return {
    update_id: updateId++,
    message: {
      message_id: options.messageId ?? 60,
      date: Math.floor(Date.now() / 1000),
      chat: { id: options.chatId ?? GROUP_ID, type: "supergroup", title: "测试群" },
      from: { id: options.inviterId ?? SUPER_ADMIN, is_bot: false, first_name: "Admin" },
      new_chat_members: [{ id: options.userId, is_bot: false, first_name: "Newbie" + options.userId }],
    },
  } as unknown as Update;
}

export function callbackUpdate(options: {
  userId: number;
  data: string;
  chatId?: number;
  chatType?: "private" | "supergroup";
  messageId?: number;
}): Update {
  const chatType = options.chatType ?? "supergroup";
  return {
    update_id: updateId++,
    callback_query: {
      id: "cb-" + updateId,
      from: { id: options.userId, is_bot: false, first_name: "User" + options.userId },
      chat_instance: "abc",
      data: options.data,
      message: {
        message_id: options.messageId ?? 70,
        date: Math.floor(Date.now() / 1000),
        chat:
          chatType === "private"
            ? { id: options.chatId ?? options.userId, type: "private", first_name: "User" }
            : { id: options.chatId ?? GROUP_ID, type: "supergroup", title: "测试群" },
        text: "面板",
      },
    },
  } as unknown as Update;
}
