import { randomBytes, randomInt } from "node:crypto";

/** 去掉易混淆字符（0/O、1/I）的字母数字表 */
export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function randomCode(length = 5, alphabet = CODE_ALPHABET): string {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += alphabet[randomInt(0, alphabet.length)];
  }
  return out;
}

/** 验证令牌：URL 安全，24 位十六进制 */
export function randomToken(bytes = 12): string {
  return randomBytes(bytes).toString("hex");
}

/** 初始化 token：8 位大写，控制台输出，便于手动输入 */
export function randomSetupToken(): string {
  return randomCode(8);
}
