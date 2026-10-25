import http from "node:http";
import { createHash } from "node:crypto";
import type { Logger } from "../logger";
import type { ChallengeRecord } from "../types";

/** 客户端必须算出的哈希前缀（十六进制 0 个数） */
const PROOF_PREFIX = "0000";
const MAX_COUNTER = 5_000_000;

export function proofNonce(token: string): string {
  return createHash("sha256").update("captcha:" + token).digest("hex").slice(0, 16);
}

export function proofHash(token: string, counter: number): string {
  return createHash("sha256").update(proofNonce(token) + ":" + counter).digest("hex");
}

export function isValidProof(token: string, counter: number): boolean {
  if (!Number.isInteger(counter) || counter < 0 || counter > MAX_COUNTER) return false;
  return proofHash(token, counter).startsWith(PROOF_PREFIX);
}

/** 服务端/测试用：本地跑一遍求解 */
export function solveProof(token: string, limit = MAX_COUNTER): number | null {
  for (let counter = 0; counter < limit; counter += 1) {
    if (proofHash(token, counter).startsWith(PROOF_PREFIX)) return counter;
  }
  return null;
}

const PAGE = [
  "<!doctype html>",
  '<html lang="zh-CN"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  "<title>人机验证</title>",
  "<style>",
  "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;color:#e2e8f0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}",
  ".card{width:min(92vw,420px);background:#111c33;border:1px solid #22304d;border-radius:16px;padding:28px;box-shadow:0 20px 50px rgba(0,0,0,.4)}",
  "h1{font-size:20px;margin:0 0 8px}",
  "p{color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 18px}",
  "#status{font-size:15px;font-weight:600;color:#38bdf8}",
  ".ok{color:#4ade80!important}.err{color:#f87171!important}",
  "</style></head><body><div class='card'>",
  "<h1>🛡 人机验证</h1>",
  "<p>正在校验浏览器环境，通过后会自动返回 Telegram。</p>",
  "<div id='status'>初始化…</div>",
  "</div><script>",
  "var TOKEN='__TOKEN__', NONCE='__NONCE__';",
  "var statusEl=document.getElementById('status');",
  "function sha256hex(s){",
  "  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function(buf){",
  "    var bytes=new Uint8Array(buf), out='';",
  "    for(var i=0;i<bytes.length;i++){out+=('0'+bytes[i].toString(16)).slice(-2);}",
  "    return out;",
  "  });",
  "}",
  "async function run(){",
  "  if(!window.crypto||!crypto.subtle){statusEl.textContent='浏览器不支持 WebCrypto，请换用手机/桌面版 Telegram 打开';statusEl.className='err';return;}",
  "  var counter=0, found=-1;",
  "  while(counter<800000){",
  "    var hash=await sha256hex(NONCE+':'+counter);",
  "    if(hash.indexOf('0000')===0){found=counter;break;}",
  "    counter++;",
  "    if(counter%2000===0){statusEl.textContent='计算中… '+Math.floor(counter/800000*100)+'%';}",
  "  }",
  "  if(found<0){statusEl.textContent='计算失败，请刷新重试';statusEl.className='err';return;}",
  "  statusEl.textContent='提交结果…';",
  "  try{",
  "    var res=await fetch('/verify/'+TOKEN+'/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({counter:found})});",
  "    var data=await res.json();",
  "    if(data&&data.ok){statusEl.textContent='✅ 验证通过，请回到 Telegram 群组';statusEl.className='ok';}",
  "    else{statusEl.textContent='❌ 验证失败：'+((data&&data.error)||'未知原因');statusEl.className='err';}",
  "  }catch(e){statusEl.textContent='网络错误，请重试';statusEl.className='err';}",
  "}",
  "run();",
  "</script></body></html>",
].join("\n");

function htmlPage(token: string, nonce: string): string {
  return PAGE.split("__TOKEN__").join(token).split("__NONCE__").join(nonce);
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function sendHtml(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

async function readBody(req: http.IncomingMessage, limit = 4096): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface WebVerifyDeps {
  logger: Logger;
  port: number;
  getChallenge: (token: string) => ChallengeRecord | undefined;
  onVerified: (challenge: ChallengeRecord) => Promise<void>;
}

export interface WebVerifyServer {
  port: number;
  close: () => Promise<void>;
}

/** 启动网页 JS 验证服务（PoW：客户端必须真的执行 JS 才能算出 proof） */
export async function startWebVerifyServer(deps: WebVerifyDeps): Promise<WebVerifyServer> {
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const pathname = url.pathname;

        if (pathname === "/healthz") {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("ok");
          return;
        }

        if (pathname === "/" && req.method === "GET") {
          sendHtml(res, 200, "<!doctype html><meta charset='utf-8'><h1>tg-guard-bot 验证服务运行中</h1>");
          return;
        }

        const match = /^\/verify\/([A-Za-z0-9]+)(\/complete)?$/.exec(pathname);
        if (!match) {
          sendJson(res, 404, { ok: false, error: "not found" });
          return;
        }
        const token = match[1] as string;
        const isComplete = Boolean(match[2]);
        const challenge = deps.getChallenge(token);

        if (!isComplete) {
          if (req.method !== "GET") {
            sendJson(res, 405, { ok: false, error: "method not allowed" });
            return;
          }
          if (!challenge || challenge.expiresAt < Date.now()) {
            sendHtml(
              res,
              410,
              "<!doctype html><meta charset='utf-8'><body style='font-family:sans-serif;padding:32px'>链接已失效，请回到 Telegram 重新获取。</body>",
            );
            return;
          }
          sendHtml(res, 200, htmlPage(token, proofNonce(token)));
          return;
        }

        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        if (!challenge || challenge.expiresAt < Date.now()) {
          sendJson(res, 410, { ok: false, error: "验证链接已失效" });
          return;
        }
        const raw = await readBody(req);
        let counter = Number.NaN;
        try {
          const parsed = JSON.parse(raw) as { counter?: number };
          counter = Number(parsed.counter);
        } catch {
          sendJson(res, 400, { ok: false, error: "请求格式错误" });
          return;
        }
        if (!isValidProof(token, counter)) {
          deps.logger.debug("网页验证 proof 无效", { token });
          sendJson(res, 400, { ok: false, error: "校验未通过" });
          return;
        }
        await deps.onVerified(challenge);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        deps.logger.warn("验证服务处理请求异常", { error: String(error) });
        try {
          sendJson(res, 500, { ok: false, error: "internal error" });
        } catch {
          // 响应可能已发出
        }
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(deps.port, () => resolve());
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : deps.port;
  deps.logger.info("网页验证服务已启动", { port });

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
