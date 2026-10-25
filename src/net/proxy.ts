/** 支持的代理类型 */
export type ProxyKind = "http" | "https" | "socks5";

export interface ProxyConfig {
  /** 规范化后的地址（不含账号密码），用于展示 */
  url: string;
  /** 带账号密码的完整地址，用于建立连接 */
  uri: string;
  kind: ProxyKind;
  host: string;
  port: number;
  username?: string;
  password?: string;
  /** 域名是否交给代理端解析（socks5h 语义，本项目 SOCKS5 统一远端解析） */
  remoteDns: boolean;
}

const DEFAULT_PORTS: Record<ProxyKind, number> = { http: 80, https: 443, socks5: 1080 };

/** 把用户输入补全成带协议的形式：127.0.0.1:10808 → http://127.0.0.1:10808 */
export function normalizeProxyInput(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  return "http://" + value;
}

function kindOf(protocol: string): ProxyKind | null {
  switch (protocol.replace(":", "").toLowerCase()) {
    case "http":
      return "http";
    case "https":
      return "https";
    case "socks":
    case "socks5":
    case "socks5h":
      return "socks5";
    default:
      return null;
  }
}

/** 解析代理地址；空值或非法值返回 null */
export function parseProxy(raw: string | undefined | null): ProxyConfig | null {
  const value = (raw ?? "").trim();
  if (!value || value.toLowerCase() === "off" || value.toLowerCase() === "none" || value === "0") return null;

  const normalized = normalizeProxyInput(value);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  const kind = kindOf(parsed.protocol);
  if (!kind) return null;
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!host) return null;

  const port = parsed.port ? Number(parsed.port) : DEFAULT_PORTS[kind];
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;

  const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  const auth = username ? username + (password ? ":" + password : "") + "@" : "";

  return {
    url: kind + "://" + host + ":" + port,
    uri: kind + "://" + auth + host + ":" + port,
    kind,
    host,
    port,
    username,
    password,
    remoteDns: true,
  };
}

/** 展示用：隐藏密码 */
export function maskProxy(config: ProxyConfig | null | undefined): string {
  if (!config) return "直连";
  if (!config.username) return config.url;
  return config.kind + "://" + config.username + ":***@" + config.host + ":" + config.port;
}

export function proxyLabel(config: ProxyConfig | null | undefined): string {
  if (!config) return "直连（未使用代理）";
  return maskProxy(config);
}
