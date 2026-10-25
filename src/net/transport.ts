import net from "node:net";
import tls from "node:tls";
import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";
import type { Dispatcher } from "undici";
import type { Logger } from "../logger";
import { maskProxy, parseProxy, type ProxyConfig } from "./proxy";

export type FetchLike = (input: string, init?: Record<string, unknown>) => Promise<unknown>;

interface ConnectorOptions {
  hostname?: string;
  host?: string;
  port?: string | number;
  protocol?: string;
  servername?: string;
}

type ConnectorCallback = (error: Error | null, socket?: net.Socket | tls.TLSSocket | null) => void;

/**
 * 自实现 SOCKS5 连接器（undici Agent 的 connect 钩子）：
 * 握手 → （可选）用户名密码认证 → CONNECT → 按需包 TLS。
 * 域名统一交给代理端解析（socks5h 语义）。
 */
export function createSocks5Connector(proxy: ProxyConfig) {
  return (options: ConnectorOptions, callback: ConnectorCallback): void => {
    const targetHost = options.hostname ?? options.host ?? "";
    const targetPort = Number(options.port ?? (options.protocol === "https:" ? 443 : 80));
    if (!targetHost) {
      callback(new Error("SOCKS5 目标地址为空"));
      return;
    }

    const socket = net.connect({ host: proxy.host, port: proxy.port });
    socket.setNoDelay(true);
    socket.setTimeout(20_000);

    let stage: "greeting" | "auth" | "request" | "done" = "greeting";
    let buffer = Buffer.alloc(0);
    let settled = false;

    const finish = (error: Error | null, finalSocket?: net.Socket | tls.TLSSocket) => {
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      if (error) {
        socket.destroy();
        callback(error);
        return;
      }
      callback(null, finalSocket ?? socket);
    };

    const sendRequest = () => {
      const isIpv4 = net.isIPv4(targetHost);
      let addrPart: Buffer;
      if (isIpv4) {
        addrPart = Buffer.from([0x01, ...targetHost.split(".").map(Number)]);
      } else {
        const name = Buffer.from(targetHost, "utf8");
        addrPart = Buffer.concat([Buffer.from([0x03, name.length]), name]);
      }
      const portBuffer = Buffer.alloc(2);
      portBuffer.writeUInt16BE(targetPort, 0);
      socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), addrPart, portBuffer]));
    };

    socket.once("error", (error) => finish(error));
    socket.once("timeout", () => finish(new Error("SOCKS5 代理连接超时")));

    socket.once("connect", () => {
      const methods = proxy.username ? [0x00, 0x02] : [0x00];
      socket.write(Buffer.from([0x05, methods.length, ...methods]));
    });

    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (stage === "greeting") {
        if (buffer.length < 2) return;
        const version = buffer[0];
        const method = buffer[1];
        buffer = buffer.subarray(2);
        if (version !== 0x05) {
          finish(new Error("SOCKS5 版本不匹配"));
          return;
        }
        if (method === 0xff) {
          finish(new Error("SOCKS5 代理拒绝所有认证方式"));
          return;
        }
        if (method === 0x02) {
          stage = "auth";
          const user = Buffer.from(proxy.username ?? "", "utf8");
          const pass = Buffer.from(proxy.password ?? "", "utf8");
          socket.write(
            Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]),
          );
          return;
        }
        stage = "request";
        sendRequest();
        return;
      }

      if (stage === "auth") {
        if (buffer.length < 2) return;
        const status = buffer[1];
        buffer = buffer.subarray(2);
        if (status !== 0x00) {
          finish(new Error("SOCKS5 用户名密码认证失败"));
          return;
        }
        stage = "request";
        sendRequest();
        return;
      }

      if (stage === "request") {
        if (buffer.length < 4) return;
        const reply = buffer[1];
        const atyp = buffer[3];
        let need = 4;
        if (atyp === 0x01) need += 4 + 2;
        else if (atyp === 0x04) need += 16 + 2;
        else if (atyp === 0x03) {
          if (buffer.length < 5) return;
          need += 1 + buffer[4] + 2;
        } else {
          finish(new Error("SOCKS5 响应地址类型无效"));
          return;
        }
        if (buffer.length < need) return;
        if (reply !== 0x00) {
          finish(new Error("SOCKS5 CONNECT 失败，代码 " + reply));
          return;
        }
        stage = "done";
        socket.removeAllListeners("data");
        if (options.protocol === "https:") {
          const secure = tls.connect({ socket, servername: options.servername ?? targetHost });
          secure.once("secureConnect", () => finish(null, secure));
          secure.once("error", (error) => finish(error));
        } else {
          finish(null, socket);
        }
      }
    });
  };
}

/**
 * grammY 在 Node 端用的是 node-fetch + abort-controller 垫片：
 * 它传进来的 signal 不是原生 AbortSignal，undici 会直接报错；
 * 另外还会带 agent / compress 这类 node-fetch 专属字段。
 * 这里统一归一化，保证 undici 能接受。
 */
function normalizeSignal(foreign: unknown): AbortSignal | undefined {
  if (!foreign) return undefined;
  if (foreign instanceof AbortSignal) return foreign;
  const source = foreign as {
    aborted?: boolean;
    addEventListener?: (type: string, listener: () => void, options?: { once?: boolean }) => void;
  };
  const controller = new AbortController();
  if (source.aborted) {
    controller.abort();
    return controller.signal;
  }
  if (typeof source.addEventListener === "function") {
    source.addEventListener("abort", () => controller.abort(), { once: true });
    return controller.signal;
  }
  return undefined;
}

/** 去掉 undici 不认识的字段，并把 signal 换成原生 AbortSignal */
export function sanitizeFetchInit(init?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!init) return undefined;
  const { agent: _agent, compress: _compress, signal, ...rest } = init;
  const normalized = normalizeSignal(signal);
  return normalized ? { ...rest, signal: normalized } : rest;
}

/**
 * Telegram API 传输层：支持 http / https / socks5 代理，并支持**运行时热切换**。
 * 关闭代理时走 undici 默认直连。
 */
export class TelegramTransport {
  private dispatcher?: Dispatcher;
  private proxyConfig: ProxyConfig | null = null;
  private readonly retired: Dispatcher[] = [];

  constructor(private readonly logger: Logger, initialProxy?: string | null) {
    if (initialProxy) this.setProxy(initialProxy);
  }

  get proxy(): ProxyConfig | null {
    return this.proxyConfig;
  }

  get isProxied(): boolean {
    return Boolean(this.dispatcher);
  }

  /** 切换代理（传空 / off 表示直连）。立即生效，无需重启。 */
  setProxy(raw?: string | null): ProxyConfig | null {
    const previous = this.dispatcher;
    if (previous) {
      this.retired.push(previous);
      void previous.close().catch(() => undefined);
      this.dispatcher = undefined;
    }
    this.proxyConfig = null;

    const next = parseProxy(raw ?? undefined);
    if (!next) {
      if (raw && String(raw).trim() && String(raw).trim().toLowerCase() !== "off") {
        this.logger.warn("代理地址无法解析，已回退直连", { raw: String(raw) });
      } else {
        this.logger.info("Telegram 传输：直连");
      }
      return null;
    }

    try {
      this.dispatcher =
        next.kind === "socks5"
          ? new Agent({ connect: createSocks5Connector(next) as never, connections: 16 })
          : new ProxyAgent({ uri: next.uri, connections: 16 });
      this.proxyConfig = next;
      this.logger.info("Telegram 传输：已启用代理", { proxy: maskProxy(next) });
      return next;
    } catch (error) {
      this.logger.error("创建代理失败，已回退直连", { proxy: maskProxy(next), error: String(error) });
      return null;
    }
  }

  /** grammY 用的 fetch：每次调用读取当前 dispatcher，因此支持热切换 */
  readonly fetch = async (input: string, init?: Record<string, unknown>): Promise<unknown> => {
    const normalized = sanitizeFetchInit(init) ?? {};
    const dispatcher = this.dispatcher;
    if (!dispatcher) return undiciFetch(input, normalized as never);
    return undiciFetch(input, { ...normalized, dispatcher } as never);
  };

  async close(): Promise<void> {
    const all = [...this.retired, ...(this.dispatcher ? [this.dispatcher] : [])];
    this.retired.length = 0;
    this.dispatcher = undefined;
    this.proxyConfig = null;
    for (const dispatcher of all) {
      await dispatcher.close().catch(() => undefined);
    }
  }
}
