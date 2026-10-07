// 出网请求的唯一入口：SSRF 预检、逐跳重校验、总超时预算、大小上限、可选代理、字符集嗅探。

import { Agent, ProxyAgent, request } from "undici";
import type { Dispatcher } from "undici";
import { config } from "../config.ts";
import { assertPublicUrl, guardedLookup } from "./url.ts";

export const DEFAULT_UA = `TopicHotBot/1.0 (+${config.siteUrl}/about)`;

export type EgressRoute = "egress" | "direct";

export type GuardedResponse = {
  status: number;
  headers: Record<string, string>;
  bytes: Uint8Array;
  finalUrl: string;
};

export type GuardedFetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  route?: EgressRoute;
};

let directAgent: Agent | undefined;
let proxyAgent: ProxyAgent | undefined;

/** 字面量 IP、.local、.cn 不走代理（代理隧道反而可能连不通内网/国内站点）。 */
function proxied(url: URL): boolean {
  if (!config.egressProxyUrl) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return false;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".cn")) return false;
  return true;
}

function directDispatcher(): Dispatcher {
  directAgent ??= new Agent({ connect: { timeout: 15_000, lookup: guardedLookup } });
  return directAgent;
}

function dispatcherFor(url: URL): Dispatcher {
  if (proxied(url)) proxyAgent ??= new ProxyAgent(config.egressProxyUrl!);
  return proxied(url) ? proxyAgent! : directDispatcher();
}

/**
 * 抓取一个 URL。重定向手动跟：每一跳都重新做 SSRF 预检并重选出口，
 * 整条跳转链共享一个超时预算。返回原始字节，由调用方按需解码。
 */
export async function guardedFetch(input: string | URL, opts: GuardedFetchOptions = {}): Promise<GuardedResponse> {
  const timeoutMs = opts.timeoutMs ?? config.fetchTimeoutMs;
  const maxBytes = opts.maxBytes ?? config.maxFeedBytes;
  const maxRedirects = opts.maxRedirects ?? 5;
  const deadline = Date.now() + timeoutMs;
  let url = assertPublicUrl(input.toString(), config.allowPrivateNetworkFetch);
  let method = opts.method ?? "GET";

  for (let redirect = 0; ; redirect++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`抓取超时（预算 ${timeoutMs}ms）：${input}`);
    const response = await request(url, {
      method,
      headers: {
        "user-agent": DEFAULT_UA,
        accept: "*/*",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
        ...opts.headers,
      },
      body: opts.body,
      dispatcher: opts.route === "direct" ? directDispatcher() : dispatcherFor(url),
      signal: AbortSignal.timeout(remaining),
    });

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(response.headers)) {
      const name = key.toLowerCase();
      if (typeof value === "string") headers[name] = value;
      else if (Array.isArray(value)) headers[name] = value.join(", ");
    }

    if (response.statusCode >= 300 && response.statusCode < 400 && headers.location) {
      // 丢弃这一跳的响应体。undici 在 destroy 时会往流上抛 error 事件，不接住会以未捕获异常终止整个采集进程。
      response.body.on("error", () => {});
      response.body.destroy();
      if (redirect >= maxRedirects) throw new Error(`重定向次数超过上限 ${maxRedirects}：${input}`);
      url = assertPublicUrl(new URL(headers.location, url).toString(), config.allowPrivateNetworkFetch);
      if (response.statusCode === 303 || (method === "POST" && response.statusCode !== 307 && response.statusCode !== 308)) method = "GET";
      continue;
    }

    const bytes = await readBody(response.body, maxBytes);
    return { status: response.statusCode, headers, bytes, finalUrl: url.toString() };
  }
}

async function readBody(body: Awaited<ReturnType<typeof request>>["body"], maxBytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const part = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    total += part.byteLength;
    if (total > maxBytes) throw new Error(`响应体超过大小上限（${maxBytes} 字节）`);
    chunks.push(part);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** 解码响应体：先看 Content-Type，再嗅探前 2KB 的 meta 声明，兜底 UTF-8。 */
export function decodeBody(res: Pick<GuardedResponse, "headers" | "bytes">): string {
  const contentType = res.headers["content-type"] ?? "";
  let charset = /charset=["']?([\w-]+)/iu.exec(contentType)?.[1]?.toLowerCase();
  if (!charset) {
    const head = Buffer.from(res.bytes.subarray(0, 2048)).toString("latin1");
    charset = /<meta[^>]+charset=["']?([\w-]+)/iu.exec(head)?.[1]?.toLowerCase() ?? "utf-8";
  }
  if (charset === "gb2312" || charset === "gbk") charset = "gb18030";
  if (charset === "iso-8859-1" || charset === "latin1") charset = "windows-1252";
  try {
    return new TextDecoder(charset, { fatal: false }).decode(res.bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(res.bytes);
  }
}
