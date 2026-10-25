import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { maskProxy, parseProxy, proxyLabel } from "../src/net/proxy";
import { Bot, InputFile } from "grammy";
import { TelegramTransport, sanitizeFetchInit } from "../src/net/transport";
import { createLogger } from "../src/logger";
import { GROUP_ID, SUPER_ADMIN, cleanupEnv, createEnv, textUpdate, type TestEnv } from "./helpers";

const logger = createLogger("test", "error");
const closers: (() => Promise<void>)[] = [];
const envs: TestEnv[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
  for (const item of envs.splice(0)) await cleanupEnv(item);
});

function track(close: () => Promise<void>) {
  closers.push(close);
}

describe("代理地址解析", () => {
  it("支持 http / https / socks5 / socks5h 与裸 host:port", () => {
    expect(parseProxy("http://127.0.0.1:10808")).toMatchObject({
      kind: "http",
      host: "127.0.0.1",
      port: 10808,
      url: "http://127.0.0.1:10808",
    });
    expect(parseProxy("127.0.0.1:10808")).toMatchObject({ kind: "http", port: 10808 });
    expect(parseProxy("https://proxy.example.com")).toMatchObject({ kind: "https", port: 443 });
    expect(parseProxy("socks5://127.0.0.1:1080")).toMatchObject({ kind: "socks5", port: 1080 });
    expect(parseProxy("socks5h://127.0.0.1")).toMatchObject({ kind: "socks5", port: 1080 });
  });

  it("解析账号密码并隐藏", () => {
    const parsed = parseProxy("socks5://user:p%40ss@10.0.0.1:1080");
    expect(parsed).toMatchObject({ username: "user", password: "p@ss" });
    expect(parsed?.uri).toBe("socks5://user:p@ss@10.0.0.1:1080");
    expect(maskProxy(parsed)).toBe("socks5://user:***@10.0.0.1:1080");
    expect(maskProxy(parseProxy("http://127.0.0.1:10808"))).toBe("http://127.0.0.1:10808");
  });

  it("off / 空 / 非法值视为直连", () => {
    expect(parseProxy(undefined)).toBeNull();
    expect(parseProxy("")).toBeNull();
    expect(parseProxy("off")).toBeNull();
    expect(parseProxy("ftp://host:21")).toBeNull();
    expect(parseProxy("http://:8080")).toBeNull();
    expect(proxyLabel(null)).toContain("直连");
  });
});

/** 本地 HTTP 代理（支持绝对 URI 与 CONNECT） */
async function startHttpProxy(): Promise<{ port: number; close: () => Promise<void>; hits: () => number }> {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    const target = new URL(req.url ?? "", "http://localhost");
    const upstream = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: req.method,
        headers: req.headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end("bad gateway");
    });
    req.pipe(upstream);
  });
  server.on("connect", (req, clientSocket, head) => {
    hits += 1;
    const [host, port] = (req.url ?? "").split(":");
    const upstream = net.connect(Number(port ?? 443), host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    hits: () => hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** 本地 HTTP 目标服务 */
async function startTarget(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, via: "target" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** 本地 SOCKS5 服务（无认证） */
async function startSocks5(): Promise<{ port: number; close: () => Promise<void>; hits: () => number }> {
  let hits = 0;
  const server = net.createServer((client) => {
    let buffer = Buffer.alloc(0);
    let stage: "greeting" | "request" = "greeting";
    client.on("error", () => undefined);
    client.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === "greeting") {
        if (buffer.length < 2) return;
        const methods = buffer[1];
        if (buffer.length < 2 + methods) return;
        buffer = buffer.subarray(2 + methods);
        client.write(Buffer.from([0x05, 0x00]));
        stage = "request";
        return;
      }
      if (buffer.length < 5) return;
      const atyp = buffer[3];
      let offset = 4;
      let host = "";
      if (atyp === 0x01) {
        if (buffer.length < 10) return;
        host = Array.from(buffer.subarray(4, 8)).join(".");
        offset = 8;
      } else if (atyp === 0x03) {
        const length = buffer[4] as number;
        if (buffer.length < 5 + length + 2) return;
        host = buffer.subarray(5, 5 + length).toString("utf8");
        offset = 5 + length;
      } else {
        client.destroy();
        return;
      }
      const port = buffer.readUInt16BE(offset);
      hits += 1;
      // 解析完成：停止监听，避免后续业务数据被当成第二个 CONNECT 请求
      client.removeAllListeners("data");
      buffer = Buffer.alloc(0);
      const upstream = net.connect(port, host, () => {
        client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on("error", () => client.destroy());
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    hits: () => hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("传输层代理", () => {
  it("HTTP 代理转发请求，并支持运行时切回直连", async () => {
    const proxy = await startHttpProxy();
    const target = await startTarget();
    track(proxy.close);
    track(target.close);

    const transport = new TelegramTransport(logger);
    transport.setProxy("http://127.0.0.1:" + proxy.port);
    expect(transport.isProxied).toBe(true);

    const viaProxy = (await transport.fetch("http://127.0.0.1:" + target.port + "/ping")) as Response;
    expect(viaProxy.status).toBe(200);
    expect(await viaProxy.json()).toMatchObject({ ok: true });
    expect(proxy.hits()).toBeGreaterThan(0);

    // 热切换：直连（不经代理）
    transport.setProxy(undefined);
    expect(transport.isProxied).toBe(false);
    const before = proxy.hits();
    const direct = (await transport.fetch("http://127.0.0.1:" + target.port + "/ping")) as Response;
    expect(direct.status).toBe(200);
    expect(proxy.hits()).toBe(before);

    // 再切回代理，仍可用
    transport.setProxy("127.0.0.1:" + proxy.port);
    const again = (await transport.fetch("http://127.0.0.1:" + target.port + "/ping")) as Response;
    expect(again.status).toBe(200);
    expect(proxy.hits()).toBeGreaterThan(before);

    await transport.close();
  });

  it("SOCKS5 代理转发请求", async () => {
    const socks = await startSocks5();
    const target = await startTarget();
    track(socks.close);
    track(target.close);

    const transport = new TelegramTransport(logger);
    transport.setProxy("socks5://127.0.0.1:" + socks.port);
    expect(transport.proxy?.kind).toBe("socks5");

    const res = (await transport.fetch("http://127.0.0.1:" + target.port + "/socks")) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ via: "target" });
    expect(socks.hits()).toBeGreaterThan(0);

    await transport.close();
  });

  it("非法代理地址回退直连", async () => {
    const transport = new TelegramTransport(logger);
    expect(transport.setProxy("ftp://bad:1")).toBeNull();
    expect(transport.isProxied).toBe(false);
    await transport.close();
  });
});

describe("代理与热加载命令", () => {
  async function env(): Promise<TestEnv> {
    const created = await createEnv();
    envs.push(created);
    return created;
  }

  function privateCmd(userId: number, text: string) {
    return textUpdate({ userId, chatType: "private", chatId: userId, text });
  }

  it("/proxy 设置代理并写入数据库，非超管被拒", async () => {
    const e = await env();
    e.repo.addAdmin(60);

    await e.bot.handleUpdate(privateCmd(60, "/proxy http://127.0.0.1:10808"));
    expect(e.repo.profile.proxyUrl).toBeUndefined();

    await e.bot.handleUpdate(privateCmd(SUPER_ADMIN, "/proxy http://127.0.0.1:10808"));
    expect(e.repo.profile.proxyUrl).toBe("http://127.0.0.1:10808");
    expect(e.deps.transport.proxy?.port).toBe(10808);

    await e.bot.handleUpdate(privateCmd(SUPER_ADMIN, "/proxy off"));
    expect(e.repo.profile.proxyUrl).toBeUndefined();
    expect(e.deps.transport.isProxied).toBe(false);
  });

  it("/proxy 拒绝无法解析的地址", async () => {
    const e = await env();
    await e.bot.handleUpdate(privateCmd(SUPER_ADMIN, "/proxy ftp://nope"));
    expect(e.repo.profile.proxyUrl).toBeUndefined();
    const reply = e.calls.filter((call) => call.method === "sendMessage").at(-1);
    expect(String(reply?.payload.text)).toContain("无法解析");
  });

  it("/reload 从磁盘热加载外部修改", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    await e.repo.flush();

    // 模拟外部编辑 state.json：新增一个群
    const file = path.join(e.dir, "state.json");
    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    raw.groups["-1008888888888"] = {
      ...raw.groups[String(GROUP_ID)],
      chatId: -1008888888888,
      title: "外部新增群",
    };
    await fs.writeFile(file, JSON.stringify(raw, null, 2), "utf8");
    expect(e.repo.hasGroup(-1008888888888)).toBe(false);

    await e.bot.handleUpdate(privateCmd(SUPER_ADMIN, "/reload"));

    expect(e.repo.hasGroup(-1008888888888)).toBe(true);
    expect(e.repo.getGroup(-1008888888888)?.title).toBe("外部新增群");
  });
});

// 需要在文件顶部用到的 fs / path
import fs from "node:fs/promises";
import path from "node:path";

describe("grammY 兼容与图片上传", () => {
  it("归一化 node-fetch 风格 init（非原生 signal / agent / compress）", () => {
    const foreign = new EventTarget() as unknown as { aborted: boolean; addEventListener: EventTarget["addEventListener"] };
    (foreign as { aborted: boolean }).aborted = false;

    const sanitized = sanitizeFetchInit({
      agent: { fake: true },
      compress: false,
      signal: foreign,
      method: "POST",
      body: "x",
    });

    expect(sanitized).toBeDefined();
    expect(sanitized?.agent).toBeUndefined();
    expect(sanitized?.compress).toBeUndefined();
    expect(sanitized?.signal).toBeInstanceOf(AbortSignal);
    expect(sanitized?.signal?.aborted).toBe(false);

    // 外部 signal 触发时，桥接的原生 signal 同步 abort
    foreign.dispatchEvent(new Event("abort"));
    expect(sanitized?.signal?.aborted).toBe(true);
  });

  it("原生 AbortSignal 原样保留", () => {
    const controller = new AbortController();
    const sanitized = sanitizeFetchInit({ signal: controller.signal });
    expect(sanitized?.signal).toBe(controller.signal);
  });

  it("经代理上传 multipart（图像验证码同路径）", async () => {
    const received: { size: number; contentType: string; hasFilename: boolean }[] = [];
    const apiServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        received.push({
          size: body.length,
          contentType: String(req.headers["content-type"] ?? ""),
          hasFilename: body.includes(Buffer.from("filename=captcha.png")),
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, result: { message_id: 77, date: 1, chat: { id: 1, type: "private" } } }));
      });
    });
    await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
    const apiPort = (apiServer.address() as AddressInfo).port;
    track(() => new Promise<void>((resolve) => apiServer.close(() => resolve())));

    const proxy = await startHttpProxy();
    track(proxy.close);

    const transport = new TelegramTransport(logger);
    transport.setProxy("http://127.0.0.1:" + proxy.port);
    track(() => transport.close());

    const bot = new Bot("123456789:FAKE-TOKEN", {
      client: {
        apiRoot: "http://127.0.0.1:" + apiPort,
        fetch: transport.fetch as unknown as typeof fetch,
      },
    });

    const sent = await bot.api.sendPhoto(123, new InputFile(Buffer.from("fake-png-bytes"), "captcha.png"), {
      caption: "验证码",
    });
    expect(sent.message_id).toBe(77);
    expect(received).toHaveLength(1);
    expect(received[0]?.contentType).toContain("multipart/form-data");
    expect(received[0]?.hasFilename).toBe(true);
    expect(received[0]?.size).toBeGreaterThan(100);
    expect(proxy.hits()).toBeGreaterThan(0);
  });
});
