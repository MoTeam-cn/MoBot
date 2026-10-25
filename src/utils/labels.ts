import { humanizeDuration } from "./time";

/** 处置动作中文名 */
export const ACTION_LABEL: Record<string, string> = {
  delete: "删除消息",
  warn: "警告",
  mute: "禁言",
  ban: "封禁",
  kick: "踢出",
};

/** 验证方式中文名 */
export const CAPTCHA_MODE_LABEL: Record<string, string> = {
  button: "按钮点击",
  image: "图像验证码",
  web: "网页 JS 验证",
};

export function mark(value: boolean): string {
  return value ? "✅" : "❌";
}

/** 封禁时长文案：0 = 永久 */
export function banLabel(seconds: number): string {
  return seconds <= 0 ? "永久" : humanizeDuration(seconds);
}
