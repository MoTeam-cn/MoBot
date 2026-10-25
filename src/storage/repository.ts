import { randomUUID } from "node:crypto";
import type { JsonStore } from "./jsonStore";
import type {
  BotProfile,
  CaptchaConfig,
  CaptchaMode,
  ChallengeRecord,
  GroupConfig,
  GroupStats,
  KeywordMode,
  KeywordRule,
  PunishAction,
  StateFile,
  WarningEntry,
} from "../types";

export const STATE_VERSION = 2;

export interface RepositoryOptions {
  warnLimit: number;
  muteSeconds: number;
  welcomeText: string;
}

export const DEFAULT_WELCOME_TEXT =
  "👋 欢迎 {name} 加入 {chat}！\n请先阅读群规，勿发广告与无关链接。";

export function createEmptyProfile(): BotProfile {
  return { superAdmins: [], admins: [] };
}

export function createEmptyState(): StateFile {
  return { version: STATE_VERSION, profile: createEmptyProfile(), groups: {}, globalBans: {}, challenges: {} };
}

function emptyStats(): GroupStats {
  return {
    deleted: 0,
    keywordHits: 0,
    warnings: 0,
    joins: 0,
    captchaSolved: 0,
    captchaFailed: 0,
    lastActivityAt: 0,
  };
}

export function defaultCaptchaConfig(): CaptchaConfig {
  return {
    enabled: false,
    mode: "button",
    kickAfterMinutes: 5,
    banSeconds: 600,
    maxAttempts: 3,
    welcomeAfterVerify: true,
  };
}

export function createGroupConfig(
  chatId: number,
  title: string,
  options: RepositoryOptions,
  addedBy?: number,
): GroupConfig {
  return {
    chatId,
    title,
    addedAt: Date.now(),
    addedBy,
    settings: {
      keywordFilter: true,
      antiLink: true,
      antiForward: false,
      antiZalgo: true,
      welcome: true,
      deleteServiceMessages: false,
      deleteCommandMessages: false,
      notifyOnPunish: true,
      builtinAction: "delete",
      onWarnLimit: "mute",
    },
    captcha: defaultCaptchaConfig(),
    keywords: [],
    trustedUserIds: [],
    warnings: {},
    antiflood: { enabled: true, maxMessages: 6, windowSeconds: 10, muteSeconds: 300 },
    welcome: { text: options.welcomeText || DEFAULT_WELCOME_TEXT, autoDeleteSeconds: 60 },
    warnLimit: options.warnLimit,
    muteSeconds: options.muteSeconds,
    stats: emptyStats(),
  };
}

/** 默认模板，用于迁移时补齐缺失字段 */
function configTemplate(): GroupConfig {
  return createGroupConfig(0, "", { warnLimit: 3, muteSeconds: 600, welcomeText: DEFAULT_WELCOME_TEXT });
}

/**
 * 迁移旧版本数据：
 * - v1 → v2：settings.captcha（布尔）迁移为 captcha.enabled，补齐 profile / challenges
 */
export function migrateState(raw: unknown, defaults: StateFile): StateFile {
  if (!raw || typeof raw !== "object") return defaults;
  const input = raw as Partial<StateFile> & { groups?: Record<string, unknown> };
  const template = configTemplate();

  const profileInput = (input.profile ?? {}) as Partial<BotProfile>;
  const profile: BotProfile = {
    superAdmins: Array.isArray(profileInput.superAdmins) ? profileInput.superAdmins.map(Number).filter(Boolean) : [],
    admins: Array.isArray(profileInput.admins) ? profileInput.admins.map(Number).filter(Boolean) : [],
    setupToken: profileInput.setupToken,
    setupTokenCreatedAt: profileInput.setupTokenCreatedAt,
    initializedAt: profileInput.initializedAt,
    publicUrl: profileInput.publicUrl,
  };

  const state: StateFile = {
    version: STATE_VERSION,
    profile,
    groups: {},
    globalBans: input.globalBans && typeof input.globalBans === "object" ? { ...input.globalBans } : {},
    challenges: input.challenges && typeof input.challenges === "object" ? { ...input.challenges } : {},
  };

  const groups = input.groups && typeof input.groups === "object" ? input.groups : {};
  for (const [key, value] of Object.entries(groups)) {
    if (!value || typeof value !== "object") continue;
    const group = value as Partial<GroupConfig> & { settings?: Record<string, unknown> };
    const legacyCaptcha = Boolean(group.settings && group.settings.captcha);
    const settings = { ...template.settings, ...(group.settings ?? {}) } as Record<string, unknown>;
    delete settings.captcha;
    state.groups[key] = {
      ...template,
      ...group,
      chatId: typeof group.chatId === "number" ? group.chatId : Number(key),
      title: group.title ?? "",
      settings: settings as unknown as GroupConfig["settings"],
      captcha: { ...template.captcha, ...(group.captcha ?? {}), enabled: group.captcha?.enabled ?? legacyCaptcha },
      keywords: Array.isArray(group.keywords) ? group.keywords : [],
      trustedUserIds: Array.isArray(group.trustedUserIds) ? group.trustedUserIds : [],
      warnings: group.warnings && typeof group.warnings === "object" ? group.warnings : {},
      antiflood: { ...template.antiflood, ...group.antiflood },
      welcome: { ...template.welcome, ...group.welcome },
      stats: { ...emptyStats(), ...group.stats },
    } as GroupConfig;
  }
  return state;
}

export class Repository {
  constructor(
    private readonly store: JsonStore<StateFile>,
    private readonly options: RepositoryOptions,
  ) {}

  get state(): StateFile {
    return this.store.value;
  }

  // ---------- 机器人档案 / 角色 ----------

  get profile(): BotProfile {
    return this.state.profile;
  }

  /** 是否已完成初始化（存在超管） */
  isInitialized(): boolean {
    return this.profile.superAdmins.length > 0;
  }

  isSuperAdmin(userId: number | undefined): boolean {
    if (!userId) return false;
    return this.profile.superAdmins.includes(userId);
  }

  /** 普通管理员（含超管） */
  isBotAdmin(userId: number | undefined): boolean {
    if (!userId) return false;
    return this.isSuperAdmin(userId) || this.profile.admins.includes(userId);
  }

  setSetupToken(token: string): void {
    this.profile.setupToken = token;
    this.profile.setupTokenCreatedAt = Date.now();
    this.persist();
  }

  clearSetupToken(): void {
    delete this.profile.setupToken;
    delete this.profile.setupTokenCreatedAt;
    this.persist();
  }

  /** 校验初始化 token（用掉即失效） */
  consumeSetupToken(token: string): boolean {
    const expected = this.profile.setupToken;
    if (!expected) return false;
    if (expected.trim().toLowerCase() !== token.trim().toLowerCase()) return false;
    return true;
  }

  /** 把用户设为超管并完成初始化 */
  completeSetup(userId: number): void {
    if (!this.profile.superAdmins.includes(userId)) this.profile.superAdmins.push(userId);
    this.profile.initializedAt = Date.now();
    delete this.profile.setupToken;
    delete this.profile.setupTokenCreatedAt;
    this.persist();
  }

  addSuperAdmin(userId: number): boolean {
    if (this.profile.superAdmins.includes(userId)) return false;
    this.profile.superAdmins.push(userId);
    this.profile.admins = this.profile.admins.filter((id) => id !== userId);
    this.persist();
    return true;
  }

  removeSuperAdmin(userId: number): boolean {
    const before = this.profile.superAdmins.length;
    this.profile.superAdmins = this.profile.superAdmins.filter((id) => id !== userId);
    this.persist();
    return this.profile.superAdmins.length !== before;
  }

  addAdmin(userId: number): boolean {
    if (this.isBotAdmin(userId)) return false;
    this.profile.admins.push(userId);
    this.persist();
    return true;
  }

  removeAdmin(userId: number): boolean {
    const before = this.profile.admins.length;
    this.profile.admins = this.profile.admins.filter((id) => id !== userId);
    this.persist();
    return this.profile.admins.length !== before;
  }

  setProxyUrl(url: string | undefined): void {
    if (url) this.profile.proxyUrl = url;
    else delete this.profile.proxyUrl;
    this.persist();
  }

  /** 从磁盘热加载（外部编辑 state.json 后生效） */
  async reload(): Promise<void> {
    await this.store.reload();
  }

  setPublicUrl(url: string | undefined): void {
    if (url) this.profile.publicUrl = url.replace(/\/+$/, "");
    else delete this.profile.publicUrl;
    this.persist();
  }

  // ---------- 群组 ----------

  listGroups(): GroupConfig[] {
    return Object.values(this.state.groups).sort((a, b) => a.addedAt - b.addedAt);
  }

  getGroup(chatId: number | string): GroupConfig | undefined {
    return this.state.groups[String(chatId)];
  }

  hasGroup(chatId: number | string): boolean {
    return Boolean(this.getGroup(chatId));
  }

  ensureGroup(chatId: number, title: string, addedBy?: number): GroupConfig {
    const existing = this.getGroup(chatId);
    if (existing) {
      if (title && existing.title !== title) {
        existing.title = title;
        this.persist();
      }
      return existing;
    }
    const group = createGroupConfig(chatId, title, this.options, addedBy);
    this.state.groups[String(chatId)] = group;
    this.persist();
    return group;
  }

  removeGroup(chatId: number | string): boolean {
    const key = String(chatId);
    if (!this.state.groups[key]) return false;
    delete this.state.groups[key];
    this.persist();
    return true;
  }

  updateGroup(chatId: number | string, mutate: (group: GroupConfig) => void): GroupConfig | undefined {
    const group = this.getGroup(chatId);
    if (!group) return undefined;
    mutate(group);
    this.persist();
    return group;
  }

  // ---------- 入群验证 ----------

  private static challengeKey(chatId: number, userId: number): string {
    return `${chatId}:${userId}`;
  }

  getChallenge(chatId: number, userId: number): ChallengeRecord | undefined {
    return this.state.challenges[Repository.challengeKey(chatId, userId)];
  }

  putChallenge(record: ChallengeRecord): void {
    this.state.challenges[Repository.challengeKey(record.chatId, record.userId)] = record;
    this.persist();
  }

  deleteChallenge(chatId: number, userId: number): void {
    delete this.state.challenges[Repository.challengeKey(chatId, userId)];
    this.persist();
  }

  listChallenges(): ChallengeRecord[] {
    return Object.values(this.state.challenges);
  }

  findChallengeByToken(token: string): ChallengeRecord | undefined {
    return this.listChallenges().find((item) => item.token === token);
  }

  findChallengesByUser(userId: number): ChallengeRecord[] {
    return this.listChallenges().filter((item) => item.userId === userId);
  }

  // ---------- 关键词 ----------

  addKeyword(
    chatId: number | string,
    input: {
      pattern: string;
      mode?: KeywordMode;
      action?: PunishAction;
      muteSeconds?: number;
      note?: string;
      createdBy?: number;
    },
  ): KeywordRule | undefined {
    return this.updateGroup(chatId, (group) => {
      const rule: KeywordRule = {
        id: randomUUID().slice(0, 8),
        pattern: input.pattern,
        mode: input.mode ?? "contains",
        action: input.action ?? "delete",
        muteSeconds: input.muteSeconds,
        note: input.note,
        enabled: true,
        createdAt: Date.now(),
        createdBy: input.createdBy,
        hits: 0,
      };
      group.keywords.push(rule);
    })?.keywords.at(-1);
  }

  /** 按 1 起的序号或关键词原文查找规则 */
  findKeyword(chatId: number | string, selector: string): KeywordRule | undefined {
    const group = this.getGroup(chatId);
    if (!group) return undefined;
    const index = Number(selector);
    if (Number.isInteger(index) && index >= 1 && index <= group.keywords.length) {
      return group.keywords[index - 1];
    }
    const needle = selector.trim().toLowerCase();
    return group.keywords.find((rule) => rule.pattern.toLowerCase() === needle);
  }

  removeKeyword(chatId: number | string, selector: string): KeywordRule | undefined {
    const group = this.getGroup(chatId);
    if (!group) return undefined;
    const rule = this.findKeyword(chatId, selector);
    if (!rule) return undefined;
    group.keywords = group.keywords.filter((item) => item.id !== rule.id);
    this.persist();
    return rule;
  }

  clearKeywords(chatId: number | string): number {
    let removed = 0;
    this.updateGroup(chatId, (group) => {
      removed = group.keywords.length;
      group.keywords = [];
    });
    return removed;
  }

  bumpKeywordHits(chatId: number | string, ruleId: string): void {
    this.updateGroup(chatId, (group) => {
      const rule = group.keywords.find((item) => item.id === ruleId);
      if (rule) rule.hits += 1;
    });
  }

  // ---------- 信任名单 ----------

  isTrusted(chatId: number | string, userId: number): boolean {
    return this.getGroup(chatId)?.trustedUserIds.includes(userId) ?? false;
  }

  addTrusted(chatId: number | string, userId: number): boolean {
    let added = false;
    this.updateGroup(chatId, (group) => {
      if (!group.trustedUserIds.includes(userId)) {
        group.trustedUserIds.push(userId);
        added = true;
      }
    });
    return added;
  }

  removeTrusted(chatId: number | string, userId: number): boolean {
    let removed = false;
    this.updateGroup(chatId, (group) => {
      const before = group.trustedUserIds.length;
      group.trustedUserIds = group.trustedUserIds.filter((id) => id !== userId);
      removed = group.trustedUserIds.length !== before;
    });
    return removed;
  }

  // ---------- 警告 ----------

  addWarning(chatId: number | string, userId: number, reason?: string): WarningEntry | undefined {
    const group = this.getGroup(chatId);
    if (!group) return undefined;
    const key = String(userId);
    const current = group.warnings[key] ?? { userId, count: 0, updatedAt: 0 };
    const entry: WarningEntry = {
      userId,
      count: current.count + 1,
      updatedAt: Date.now(),
      lastReason: reason ?? current.lastReason,
    };
    group.warnings[key] = entry;
    group.stats.warnings += 1;
    this.persist();
    return entry;
  }

  getWarning(chatId: number | string, userId: number): WarningEntry | undefined {
    return this.getGroup(chatId)?.warnings[String(userId)];
  }

  resetWarnings(chatId: number | string, userId: number): number {
    let count = 0;
    this.updateGroup(chatId, (group) => {
      const key = String(userId);
      count = group.warnings[key]?.count ?? 0;
      delete group.warnings[key];
    });
    return count;
  }

  resetAllWarnings(chatId: number | string): number {
    let count = 0;
    this.updateGroup(chatId, (group) => {
      count = Object.keys(group.warnings).length;
      group.warnings = {};
    });
    return count;
  }

  // ---------- 统计 ----------

  bumpStats(chatId: number | string, key: keyof GroupStats, by = 1): void {
    this.updateGroup(chatId, (group) => {
      const current = group.stats[key];
      group.stats[key] = (typeof current === "number" ? current : 0) + by;
      group.stats.lastActivityAt = Date.now();
    });
  }

  // ---------- 全局封禁 ----------

  isGloballyBanned(userId: number): boolean {
    return Boolean(this.state.globalBans[String(userId)]);
  }

  addGlobalBan(userId: number, by?: number, reason?: string): boolean {
    const key = String(userId);
    if (this.state.globalBans[key]) return false;
    this.state.globalBans[key] = { userId, at: Date.now(), by, reason };
    this.persist();
    return true;
  }

  removeGlobalBan(userId: number): boolean {
    const key = String(userId);
    if (!this.state.globalBans[key]) return false;
    delete this.state.globalBans[key];
    this.persist();
    return true;
  }

  listGlobalBans(): number[] {
    return Object.keys(this.state.globalBans).map(Number);
  }

  persist(): void {
    this.store.markDirty();
  }

  async flush(): Promise<void> {
    await this.store.flush();
  }
}

export type { CaptchaMode };
