/** 命中规则后的处置动作 */
export type PunishAction = "delete" | "warn" | "mute" | "ban" | "kick";

/** 关键词匹配模式 */
export type KeywordMode = "contains" | "whole" | "regex";

/** 入群验证方式 */
export type CaptchaMode = "button" | "image" | "web";

export interface KeywordRule {
  id: string;
  /** 关键词 / 正则原文 */
  pattern: string;
  mode: KeywordMode;
  action: PunishAction;
  /** mute 动作使用的禁言秒数，缺省用群配置 */
  muteSeconds?: number;
  note?: string;
  enabled: boolean;
  createdAt: number;
  createdBy?: number;
  /** 命中次数 */
  hits: number;
}

export interface GroupSettings {
  /** 关键词过滤总开关 */
  keywordFilter: boolean;
  /** 反链接/广告 */
  antiLink: boolean;
  /** 反转发 */
  antiForward: boolean;
  /** 反乱码（大量组合字符） */
  antiZalgo: boolean;
  /** 入群欢迎语 */
  welcome: boolean;
  /** 删除入群/退群/改名等系统消息 */
  deleteServiceMessages: boolean;
  /** 自动删除群内命令消息 */
  deleteCommandMessages: boolean;
  /** 处罚后是否在群里提示（提示会自动删除） */
  notifyOnPunish: boolean;
  /** 内置检测（链接/转发/乱码）的处置动作 */
  builtinAction: PunishAction;
  /** 警告达到上限后的动作 */
  onWarnLimit: "mute" | "ban" | "kick";
}

export interface AntiFloodConfig {
  enabled: boolean;
  /** 窗口内最大消息数 */
  maxMessages: number;
  /** 统计窗口（秒） */
  windowSeconds: number;
  /** 触发后禁言秒数 */
  muteSeconds: number;
}

export interface WelcomeConfig {
  text: string;
  /** 欢迎语自动删除秒数，0 = 不删 */
  autoDeleteSeconds: number;
}

/** 入群验证配置 */
export interface CaptchaConfig {
  enabled: boolean;
  /** 验证方式：按钮 / 图像验证码 / 网页 JS 验证 */
  mode: CaptchaMode;
  /** 多少分钟后未验证自动踢出 */
  kickAfterMinutes: number;
  /** 踢出时封禁秒数，0 = 永久封禁 */
  banSeconds: number;
  /** 允许输错的次数 */
  maxAttempts: number;
  /** 验证通过后是否发欢迎语 */
  welcomeAfterVerify: boolean;
}

/** 一次待完成的验证 */
export interface ChallengeRecord {
  token: string;
  chatId: number;
  userId: number;
  userName: string;
  mode: CaptchaMode;
  /** 图像验证码答案 */
  code?: string;
  attempts: number;
  createdAt: number;
  expiresAt: number;
  /** 已经发出、需要事后清理的消息 */
  promptMessageIds: { chat?: number; dm?: number };
  /** 是否成功私聊到用户 */
  dmSent: boolean;
  /** 私聊失败时是否已在群里给出按钮兜底 */
  groupFallback: boolean;
}

export interface GroupStats {
  deleted: number;
  keywordHits: number;
  warnings: number;
  joins: number;
  captchaSolved: number;
  captchaFailed: number;
  lastActivityAt: number;
}

export interface WarningEntry {
  userId: number;
  count: number;
  updatedAt: number;
  lastReason?: string;
}

export interface GroupConfig {
  chatId: number;
  title: string;
  username?: string;
  addedAt: number;
  addedBy?: number;
  settings: GroupSettings;
  captcha: CaptchaConfig;
  keywords: KeywordRule[];
  trustedUserIds: number[];
  warnings: Record<string, WarningEntry>;
  antiflood: AntiFloodConfig;
  welcome: WelcomeConfig;
  /** 警告上限 */
  warnLimit: number;
  /** 默认禁言秒数 */
  muteSeconds: number;
  /** 本群日志频道，缺省回落到全局配置 */
  logChannelId?: number;
  stats: GroupStats;
}

export interface GlobalBanEntry {
  userId: number;
  reason?: string;
  at: number;
  by?: number;
}

/** 机器人级配置（初始化后由超管在私聊里维护，不再依赖配置文件） */
export interface BotProfile {
  /** 超级管理员：可管理一切 */
  superAdmins: number[];
  /** 普通管理员：可管理各群，但不能增删群/管理员、不能全局封禁 */
  admins: number[];
  /** 首次启动生成的初始化 token（控制台输出），用掉即失效 */
  setupToken?: string;
  setupTokenCreatedAt?: number;
  /** 初始化完成时间 */
  initializedAt?: number;
  /** 网页验证用的公网地址，例如 https://bot.example.com */
  publicUrl?: string;
  /** Telegram API 代理：http://host:port / https:// / socks5://，缺省回落到环境变量 */
  proxyUrl?: string;
}

export interface StateFile {
  version: number;
  profile: BotProfile;
  groups: Record<string, GroupConfig>;
  globalBans: Record<string, GlobalBanEntry>;
  /** 未完成的入群验证，重启后恢复定时器 */
  challenges: Record<string, ChallengeRecord>;
}

/** 处置结果，供提示/日志使用 */
export interface PunishOutcome {
  deleted: boolean;
  action: PunishAction;
  /** 若警告升级为禁言/封禁，记录升级后的动作 */
  escalatedTo?: "mute" | "ban" | "kick";
  warnCount?: number;
  warnLimit?: number;
  mutedSeconds?: number;
  dryRun: boolean;
}
