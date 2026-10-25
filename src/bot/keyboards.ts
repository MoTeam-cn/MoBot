import { InlineKeyboard } from "grammy";
import type { GroupConfig, GroupSettings } from "../types";
import { ACTION_LABEL, CAPTCHA_MODE_LABEL, banLabel, mark } from "../utils/labels";

export interface ToggleSetting {
  key: keyof GroupSettings;
  label: string;
}

/** 面板里可点开关的布尔设置（入群验证单独处理） */
export const TOGGLE_SETTINGS: ToggleSetting[] = [
  { key: "keywordFilter", label: "关键词过滤" },
  { key: "antiLink", label: "反链接/广告" },
  { key: "antiForward", label: "反转发" },
  { key: "antiZalgo", label: "反乱码" },
  { key: "welcome", label: "入群欢迎" },
  { key: "deleteServiceMessages", label: "删系统消息" },
  { key: "deleteCommandMessages", label: "删命令消息" },
  { key: "notifyOnPunish", label: "处罚提示" },
];

export const CAPTCHA_KICK_CYCLE = [1, 3, 5, 10, 30, 60];
export const CAPTCHA_BAN_CYCLE = [0, 60, 300, 600, 3600, 86400];

/** 群设置面板（群里 / 私聊里都能用，回调带群 ID） */
export function settingsKeyboard(group: GroupConfig): InlineKeyboard {
  const id = group.chatId;
  const keyboard = new InlineKeyboard();

  TOGGLE_SETTINGS.forEach((item, index) => {
    const value = Boolean(group.settings[item.key]);
    keyboard.text(`${mark(value)} ${item.label}`, `cfg:${id}:t:${item.key}`);
    if (index % 2 === 1) keyboard.row();
  });
  if (TOGGLE_SETTINGS.length % 2 === 1) keyboard.row();

  keyboard.text(`${mark(group.antiflood.enabled)} 反刷屏`, `cfg:${id}:flood`).row();
  keyboard
    .text(`${mark(group.captcha.enabled)} 入群验证`, `cfg:${id}:cap`)
    .text(`方式：${CAPTCHA_MODE_LABEL[group.captcha.mode] ?? group.captcha.mode}`, `cfg:${id}:capmode`)
    .row();
  keyboard
    .text(`超时：${group.captcha.kickAfterMinutes} 分`, `cfg:${id}:capkick`)
    .text(`失败封禁：${banLabel(group.captcha.banSeconds)}`, `cfg:${id}:capban`)
    .row();
  keyboard
    .text(`内置处置：${ACTION_LABEL[group.settings.builtinAction] ?? group.settings.builtinAction}`, `cfg:${id}:builtin`)
    .text(`警告上限：${ACTION_LABEL[group.settings.onWarnLimit] ?? group.settings.onWarnLimit}`, `cfg:${id}:onwarn`)
    .row();
  keyboard.text("🔄 刷新", `cfg:${id}:refresh`).text("✖️ 关闭", `cfg:${id}:close`);
  return keyboard;
}

/** 私聊里的受管群列表 */
export function groupsKeyboard(groups: GroupConfig[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  groups.slice(0, 20).forEach((group, index) => {
    const title = (group.title || String(group.chatId)).slice(0, 24);
    keyboard.text(`${index + 1}. ${title}`, `cfg:${group.chatId}:open`).row();
  });
  return keyboard;
}

/** 私聊主菜单 */
export function privateMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📋 群组", "pm:groups")
    .text("👤 管理员", "pm:admins")
    .row()
    .text("🚫 全局封禁", "pm:bans")
    .text("ℹ️ 帮助", "pm:help");
}

export function captchaVerifyKeyboard(token: string): InlineKeyboard {
  return new InlineKeyboard().text("✅ 我已完成验证", "vfy:" + token);
}
