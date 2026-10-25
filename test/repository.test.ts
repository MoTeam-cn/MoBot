import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { JsonStore } from "../src/storage/jsonStore";
import { Repository, createEmptyState, migrateState } from "../src/storage/repository";
import { createLogger } from "../src/logger";
import type { StateFile } from "../src/types";

const logger = createLogger("test", "error");
const tempDirs: string[] = [];

async function makeRepo() {
  const dir = path.join(process.cwd(), "data", ".test-repo-" + Math.random().toString(36).slice(2));
  await fs.mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const store = new JsonStore<StateFile>({
    filePath: path.join(dir, "state.json"),
    defaults: createEmptyState,
    migrate: migrateState,
    logger,
  });
  await store.load();
  return { repo: new Repository(store, { warnLimit: 3, muteSeconds: 600, welcomeText: "hi" }), store, dir };
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe("Repository", () => {
  it("注册群组并持久化", async () => {
    const { repo, store, dir } = await makeRepo();
    repo.ensureGroup(-1001, "测试群", 1);
    expect(repo.hasGroup(-1001)).toBe(true);
    await store.flush();

    const reloaded = new JsonStore<StateFile>({
      filePath: path.join(dir, "state.json"),
      defaults: createEmptyState,
      migrate: migrateState,
      logger,
    });
    await reloaded.load();
    const repo2 = new Repository(reloaded, { warnLimit: 3, muteSeconds: 600, welcomeText: "hi" });
    expect(repo2.getGroup(-1001)?.title).toBe("测试群");
  });

  it("重复注册不重复创建", async () => {
    const { repo } = await makeRepo();
    const first = repo.ensureGroup(-1002, "群A", 1);
    const second = repo.ensureGroup(-1002, "群A改名", 1);
    expect(repo.listGroups()).toHaveLength(1);
    expect(second.addedAt).toBe(first.addedAt);
    expect(second.title).toBe("群A改名");
  });

  it("关键词增删与命中计数", async () => {
    const { repo } = await makeRepo();
    repo.ensureGroup(-1003, "群B");
    const rule = repo.addKeyword(-1003, { pattern: "广告", action: "mute", muteSeconds: 60 });
    expect(rule).toBeDefined();
    expect(repo.getGroup(-1003)?.keywords).toHaveLength(1);

    repo.bumpKeywordHits(-1003, rule!.id);
    expect(repo.getGroup(-1003)?.keywords[0]?.hits).toBe(1);

    expect(repo.findKeyword(-1003, "1")?.id).toBe(rule!.id);
    expect(repo.findKeyword(-1003, "广告")?.id).toBe(rule!.id);

    expect(repo.removeKeyword(-1003, "广告")?.id).toBe(rule!.id);
    expect(repo.getGroup(-1003)?.keywords).toHaveLength(0);
  });

  it("警告累计与清除", async () => {
    const { repo } = await makeRepo();
    repo.ensureGroup(-1004, "群C");
    expect(repo.addWarning(-1004, 7, "刷屏")?.count).toBe(1);
    expect(repo.addWarning(-1004, 7, "刷屏")?.count).toBe(2);
    expect(repo.getWarning(-1004, 7)?.count).toBe(2);
    expect(repo.getGroup(-1004)?.stats.warnings).toBe(2);
    expect(repo.resetWarnings(-1004, 7)).toBe(2);
    expect(repo.getWarning(-1004, 7)).toBeUndefined();
  });

  it("信任名单", async () => {
    const { repo } = await makeRepo();
    repo.ensureGroup(-1005, "群D");
    expect(repo.addTrusted(-1005, 42)).toBe(true);
    expect(repo.isTrusted(-1005, 42)).toBe(true);
    expect(repo.addTrusted(-1005, 42)).toBe(false);
    expect(repo.removeTrusted(-1005, 42)).toBe(true);
    expect(repo.isTrusted(-1005, 42)).toBe(false);
  });

  it("全局封禁", async () => {
    const { repo } = await makeRepo();
    expect(repo.addGlobalBan(99, 1, "广告机器人")).toBe(true);
    expect(repo.isGloballyBanned(99)).toBe(true);
    expect(repo.listGlobalBans()).toEqual([99]);
    expect(repo.removeGlobalBan(99)).toBe(true);
    expect(repo.isGloballyBanned(99)).toBe(false);
  });

  it("统计自增", async () => {
    const { repo } = await makeRepo();
    repo.ensureGroup(-1006, "群E");
    repo.bumpStats(-1006, "deleted");
    repo.bumpStats(-1006, "deleted", 2);
    expect(repo.getGroup(-1006)?.stats.deleted).toBe(3);
    expect(repo.getGroup(-1006)?.stats.lastActivityAt).toBeGreaterThan(0);
  });
});

describe("机器人档案与验证记录", () => {
  it("初始化与角色", async () => {
    const { repo } = await makeRepo();
    expect(repo.isInitialized()).toBe(false);
    repo.setSetupToken("TOKEN123");
    expect(repo.consumeSetupToken("token123")).toBe(true);
    expect(repo.consumeSetupToken("other")).toBe(false);

    repo.completeSetup(10);
    expect(repo.isInitialized()).toBe(true);
    expect(repo.isSuperAdmin(10)).toBe(true);
    expect(repo.profile.setupToken).toBeUndefined();

    expect(repo.addAdmin(11)).toBe(true);
    expect(repo.isBotAdmin(11)).toBe(true);
    expect(repo.isSuperAdmin(11)).toBe(false);
    expect(repo.removeAdmin(11)).toBe(true);
    expect(repo.isBotAdmin(11)).toBe(false);
  });

  it("publicUrl 设置与清除", async () => {
    const { repo } = await makeRepo();
    repo.setPublicUrl("https://example.com/");
    expect(repo.profile.publicUrl).toBe("https://example.com");
    repo.setPublicUrl(undefined);
    expect(repo.profile.publicUrl).toBeUndefined();
  });

  it("验证记录读写与 token 查找", async () => {
    const { repo } = await makeRepo();
    repo.ensureGroup(-1010, "群V");
    const record = {
      token: "tok123",
      chatId: -1010,
      userId: 88,
      userName: "x",
      mode: "button" as const,
      attempts: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      promptMessageIds: {},
      dmSent: true,
      groupFallback: false,
    };
    repo.putChallenge(record);
    expect(repo.getChallenge(-1010, 88)?.token).toBe("tok123");
    expect(repo.findChallengeByToken("tok123")?.userId).toBe(88);
    expect(repo.findChallengesByUser(88)).toHaveLength(1);
    repo.deleteChallenge(-1010, 88);
    expect(repo.findChallengeByToken("tok123")).toBeUndefined();
  });

  it("v1 数据结构可迁移（settings.captcha → captcha.enabled）", async () => {
    const { repo, store, dir } = await makeRepo();
    void repo;
    void store;
    void dir;
    const legacy = {
      version: 1,
      groups: {
        "-1020": {
          chatId: -1020,
          title: "老群",
          settings: { keywordFilter: true, captcha: true },
          keywords: [],
          stats: {},
        },
      },
      globalBans: {},
    };
    const migrated = migrateState(legacy, createEmptyState());
    expect(migrated.version).toBe(2);
    expect(migrated.groups["-1020"]?.captcha.enabled).toBe(true);
    expect((migrated.groups["-1020"]?.settings as unknown as Record<string, unknown>).captcha).toBeUndefined();
    expect(migrated.profile.superAdmins).toEqual([]);
    expect(migrated.challenges).toEqual({});
  });
});
