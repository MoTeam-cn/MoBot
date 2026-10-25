import type { GroupConfig, PunishOutcome } from "./types";
import { escapeHtml, userLink } from "./utils/telegram";
import { humanizeDuration, formatDateTime } from "./utils/time";
import { ACTION_LABEL, CAPTCHA_MODE_LABEL, banLabel, mark } from "./utils/labels";

export { ACTION_LABEL } from "./utils/labels";

export function actionLabel(outcome: PunishOutcome): string {
  const parts: string[] = [];
  if (outcome.escalatedTo) {
    parts.push("警告达上限 → " + (ACTION_LABEL[outcome.escalatedTo] ?? outcome.escalatedTo));
    if (outcome.mutedSeconds) parts.push(humanizeDuration(outcome.mutedSeconds));
    return parts.join(" ");
  }
  const base = ACTION_LABEL[outcome.action] ?? outcome.action;
  if (outcome.action === "warn") {
    return base + "（" + (outcome.warnCount ?? 0) + "/" + (outcome.warnLimit ?? 0) + "）";
  }
  if (outcome.action === "mute" && outcome.mutedSeconds) {
    return base + " " + humanizeDuration(outcome.mutedSeconds);
  }
  return base;
}

export function punishNotice(userId: number, name: string, reason: string, outcome: PunishOutcome): string {
  return [
    "🧹 " + userLink(userId, name) + " 的消息已被处理",
    "• 原因：" + escapeHtml(reason),
    "• 处置：" + escapeHtml(actionLabel(outcome)),
  ].join("\n");
}

export function punishLog(
  group: GroupConfig,
  userId: number,
  name: string,
  reason: string,
  outcome: PunishOutcome,
): string {
  const lines = [
    "🛡 违规处理 · " + escapeHtml(group.title || String(group.chatId)),
    "• 用户：" + userLink(userId, name) + " (" + userId + ")",
    "• 原因：" + escapeHtml(reason),
    "• 处置：" + escapeHtml(actionLabel(outcome)),
    "• 群组：" + group.chatId,
    "• 时间：" + formatDateTime(Date.now()),
  ];
  if (outcome.dryRun) lines.push("• 模式：试运行（未真正执行）");
  return lines.join("\n");
}

export function toggleMark(value: boolean): string {
  return mark(value);
}

export function settingsText(group: GroupConfig): string {
  const s = group.settings;
  const cap = group.captcha;
  return [
    "⚙️ <b>" + escapeHtml(group.title || String(group.chatId)) + "</b> 群设置",
    "群 ID：<code>" + group.chatId + "</code>",
    "",
    toggleMark(s.keywordFilter) + " 关键词过滤（" + group.keywords.length + " 条规则）",
    toggleMark(s.antiLink) + " 反链接/广告",
    toggleMark(s.antiForward) + " 反转发",
    toggleMark(s.antiZalgo) + " 反乱码刷屏",
    toggleMark(group.antiflood.enabled) +
      " 反刷屏（" +
      group.antiflood.maxMessages +
      " 条/" +
      group.antiflood.windowSeconds +
      " 秒）",
    toggleMark(s.welcome) + " 入群欢迎",
    toggleMark(s.deleteServiceMessages) + " 删除系统消息",
    toggleMark(s.deleteCommandMessages) + " 删除命令消息",
    toggleMark(s.notifyOnPunish) + " 群内处罚提示",
    "",
    "🔐 入群验证：" +
      toggleMark(cap.enabled) +
      " · " +
      (CAPTCHA_MODE_LABEL[cap.mode] ?? cap.mode) +
      " · " +
      cap.kickAfterMinutes +
      " 分钟未验证踢出 · 封禁 " +
      banLabel(cap.banSeconds),
    "内置检测处置：<b>" + (ACTION_LABEL[s.builtinAction] ?? s.builtinAction) + "</b>",
    "警告上限：<b>" + group.warnLimit + "</b> 次 → " + (ACTION_LABEL[s.onWarnLimit] ?? s.onWarnLimit),
    "默认禁言：<b>" + humanizeDuration(group.muteSeconds) + "</b>",
    "日志频道：<code>" + (group.logChannelId ?? "未设置") + "</code>",
  ].join("\n");
}

export function captchaText(group: GroupConfig): string {
  const cap = group.captcha;
  return [
    "🔐 <b>入群验证设置</b> · " + escapeHtml(group.title || String(group.chatId)),
    "• 状态：" + toggleMark(cap.enabled),
    "• 方式：" + (CAPTCHA_MODE_LABEL[cap.mode] ?? cap.mode),
    "• 超时：" + cap.kickAfterMinutes + " 分钟后踢出",
    "• 失败处置：踢出并" + (cap.banSeconds > 0 ? "封禁 " + humanizeDuration(cap.banSeconds) : "永久封禁"),
    "• 允许输错：" + cap.maxAttempts + " 次",
    "• 通过后发欢迎语：" + toggleMark(cap.welcomeAfterVerify),
    "",
    "<b>用法</b>",
    "/captcha on | off",
    "/captcha mode button | image | web",
    "/captcha timeout 5      （分钟）",
    "/captcha ban 600 | permanent",
    "/captcha attempts 3",
    "/captcha welcome on|off",
  ].join("\n");
}

export function statsText(group: GroupConfig): string {
  const top = [...group.keywords]
    .filter((rule) => rule.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 5);
  const lines = [
    "📊 <b>" + escapeHtml(group.title || String(group.chatId)) + "</b> 统计",
    "• 关键词规则：" + group.keywords.length + " 条（启用 " + group.keywords.filter((k) => k.enabled).length + "）",
    "• 累计删除：" + group.stats.deleted,
    "• 关键词命中：" + group.stats.keywordHits,
    "• 警告次数：" + group.stats.warnings,
    "• 入群人次：" + group.stats.joins,
    "• 验证通过：" + group.stats.captchaSolved + " / 失败：" + group.stats.captchaFailed,
    "• 当前被警告用户：" + Object.keys(group.warnings).length,
    "• 信任用户：" + group.trustedUserIds.length,
    "• 最近活跃：" + formatDateTime(group.stats.lastActivityAt),
  ];
  if (top.length) {
    lines.push("", "🔥 命中最多：");
    for (const rule of top) lines.push("  · " + escapeHtml(rule.pattern) + " — " + rule.hits + " 次");
  }
  return lines.join("\n");
}

export function globalStatsText(groups: GroupConfig[], admins: number[], bans: number): string {
  const totals = groups.reduce(
    (acc, group) => {
      acc.deleted += group.stats.deleted;
      acc.hits += group.stats.keywordHits;
      acc.joins += group.stats.joins;
      acc.solved += group.stats.captchaSolved;
      acc.failed += group.stats.captchaFailed;
      acc.keywords += group.keywords.length;
      return acc;
    },
    { deleted: 0, hits: 0, joins: 0, solved: 0, failed: 0, keywords: 0 },
  );
  return [
    "📊 <b>全局统计</b>",
    "• 受管群：" + groups.length + " 个",
    "• 管理员：" + admins.length + " 人",
    "• 关键词规则：" + totals.keywords + " 条",
    "• 累计删除：" + totals.deleted,
    "• 关键词命中：" + totals.hits,
    "• 入群人次：" + totals.joins,
    "• 验证通过 / 失败：" + totals.solved + " / " + totals.failed,
    "• 全局封禁：" + bans + " 人",
  ].join("\n");
}

export const HELP_PRIVATE = [
  "🤖 <b>私聊控制台</b>",
  "",
  "<b>初始化</b>",
  "/setup &lt;token&gt; — 首次初始化，控制台会打印 token",
  "/init — 重新推送命令菜单",
  "",
  "<b>群组</b>",
  "/groups — 群列表（点按钮直接改该群设置）",
  "/addgroup &lt;群ID&gt; — 添加受管群",
  "/delgroup &lt;群ID&gt; — 移除受管群",
  "",
  "<b>管理员（仅超管）</b>",
  "/admins — 管理员列表",
  "/addadmin &lt;ID&gt; — 添加普通管理员",
  "/deladmin &lt;ID&gt; — 移除普通管理员",
  "",
  "<b>全局封禁（仅超管）</b>",
  "/gban &lt;用户&gt; [原因] — 全群封禁",
  "/ungban &lt;用户&gt; — 解除",
  "/glist — 名单",
  "",
  "<b>其他</b>",
  "/config — 查看机器人配置",
  "/config publicUrl &lt;https://...&gt; — 设置网页验证地址",
  "/proxy &lt;url|off&gt; — 切换 http/https/socks5 代理（热生效）",
  "/reload — 从磁盘热加载数据（无需重启）",
  "/stats — 全局统计",
  "/menu — 快捷菜单",
  "/id — 查看 ID",
  "",
  "群内命令（需在群里发）：/settings /captcha /addword /warn /mute …",
].join("\n");

export const HELP_GROUP = [
  "🤖 <b>群管命令</b>",
  "",
  "<b>关键词</b>",
  "/addword &lt;关键词&gt; [--mode contains|whole|regex] [--action delete|warn|mute|ban] [--mute 10m]",
  "/delword &lt;关键词|序号&gt; · /words [页码] · /clearwords · /testword &lt;文本&gt;",
  "",
  "<b>设置</b>",
  "/settings — 设置面板（按钮开关）",
  "/captcha — 入群验证设置",
  "/set &lt;项&gt; &lt;值&gt; — 例如 /set warnLimit 3、/set welcome.text 欢迎 {name}",
  "",
  "<b>成员管理</b>",
  "/warn · /warns · /unwarn · /resetwarns",
  "/mute &lt;时长&gt; · /unmute · /kick · /ban · /unban",
  "/trust · /untrust · /trusted · /report",
  "/purge &lt;数量&gt; · /pin · /unpin",
  "",
  "<b>其他</b>",
  "/stats · /id · /help",
  "",
  "💡 关键词支持防变形：「广 告」「ＶＸ」「广\u200b告」都能命中。",
].join("\n");

export function startText(initialized: boolean, isSuperAdmin: boolean, isAdmin: boolean): string {
  if (!initialized) {
    return [
      "👋 我是群管机器人，当前<b>尚未初始化</b>。",
      "",
      "请在服务器控制台查看本次启动打印的初始化 token，然后发送：",
      "<code>/setup 你的token</code>",
      "",
      "第一个完成 /setup 的用户将成为<b>超级管理员</b>，可管理一切。",
    ].join("\n");
  }
  const role = isSuperAdmin ? "超级管理员" : isAdmin ? "普通管理员" : "普通用户";
  return [
    "👋 我是群管机器人，当前身份：" + role,
    "",
    "• 关键词过滤：命中即撤回，可警告/禁言/封禁",
    "• 入群验证：禁言 + 私聊验证（按钮 / 图像验证码 / 网页 JS）",
    "• 群管理：反链接、反刷屏、警告系统、信任名单、日志频道",
    "",
    isSuperAdmin || isAdmin ? "发送 /help 查看命令，/menu 打开快捷菜单。" : "把机器人拉进群并设为管理员，然后由管理员执行 /addgroup。",
  ].join("\n");
}

export function menuText(groups: number, admins: number, bans: number, superAdmin: boolean): string {
  return [
    "🤖 <b>控制台</b>",
    "• 受管群：" + groups + " 个",
    "• 管理员：" + admins + " 人",
    "• 全局封禁：" + bans + " 人",
    "",
    superAdmin ? "你是超级管理员，可管理一切。" : "你是普通管理员，可管理各群设置与成员。",
  ].join("\n");
}
