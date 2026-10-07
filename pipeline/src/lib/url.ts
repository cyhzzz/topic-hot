// URL 归一化（去追踪参数、统一写法）与 SSRF 防护（URL 预检 + 连接时盯住 DNS 解析结果）。

import { lookup } from "node:dns";
import type { LookupAddress, LookupAllOptions, LookupOptions } from "node:dns";

// ── 归一化 ──────────────────────────────────────────────────────────────────────────────

/** 命中这些前缀或完整名的 query 参数在归一化时剥掉。 */
const TRACKING_PARAM_PREFIXES = [
  "utm_", "mtm_", "spm", "vd_source", "share_", "sns_", "ref_", "mc_", "yclid", "gclid", "fbclid", "igsh", "si_",
];
const TRACKING_PARAM_NAMES = new Set([
  "from", "ref", "source", "fr", "fr2", "shareid", "share_token", "tdsourcetag", "nsu", "s", "pf",
]);

const TWEET_URL = /^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d+)/iu;

/** 推文链接返回 `x:{tweetId}`（同一推文的各端写法归一），否则 null。 */
export function tweetIdFromUrl(url: string): string | null {
  const match = TWEET_URL.exec(url);
  return match ? `x:${match[1]}` : null;
}

/** 统一写法：小写域名、去默认端口、去锚点与追踪参数、query 按名排序、去尾部斜杠。 */
export function normalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return input.trim();
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return url.toString();
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";

  const kept: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAM_NAMES.has(lower)) continue;
    if (TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix))) continue;
    kept.push([key, value]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);

  let out = url.toString();
  if (out.endsWith("?")) out = out.slice(0, -1);
  if (out.endsWith("/") && url.pathname !== "/") out = out.slice(0, -1);
  return out;
}

/** 同一内容的多端写法归到同一个键：推文用推文 ID，其余用归一化 URL。 */
export function identityKeyForUrl(url: string): string {
  return tweetIdFromUrl(url) ?? `url:${normalizeUrl(url)}`;
}

// ── SSRF 防护 ───────────────────────────────────────────────────────────────────────────

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!/^\d{1,3}$/.test(part) || !Number.isInteger(n) || n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

const v4 = (address: string) => ipv4ToInt(address)!;
const IPV4_MAX = 0xffffffff;

/** 不允许直连的 IPv4 段：本机、内网、链路本地、保留段与组播。 */
const IPV4_BLOCKED: ReadonlyArray<readonly [base: number, prefix: number]> = [
  [v4("0.0.0.0"), 8], [v4("10.0.0.0"), 8], [v4("100.64.0.0"), 10], [v4("127.0.0.0"), 8],
  [v4("169.254.0.0"), 16], [v4("172.16.0.0"), 12], [v4("192.0.0.0"), 24], [v4("192.0.2.0"), 24],
  [v4("192.88.99.0"), 24], [v4("192.168.0.0"), 16], [v4("198.18.0.0"), 15], [v4("198.51.100.0"), 24],
  [v4("203.0.113.0"), 24], [v4("224.0.0.0"), 4], [v4("240.0.0.0"), 4],
];

function isBlockedIpv4Number(value: bigint): boolean {
  return isBlockedIpv4Range(Number(value & BigInt(IPV4_MAX)));
}

function isBlockedIpv4Range(value: number): boolean {
  return IPV4_BLOCKED.some(([base, prefix]) => {
    const mask = prefix === 0 ? 0 : (IPV4_MAX << (32 - prefix)) >>> 0;
    return (value & mask) === (base & mask);
  });
}

/** 把 IPv6 展开成 8 组 16 位数；解析失败返回 null。 */
function ipv6Groups(address: string): bigint[] | null {
  const raw = address.toLowerCase();
  if (!raw.includes(":")) return null;
  const [head, tail] = raw.split("::", 2);
  const toGroups = (part: string): bigint[] | null => {
    if (part === "") return [];
    const groups: bigint[] = [];
    for (const piece of part.split(":")) {
      // 内嵌 IPv4（如 ::ffff:1.2.3.4）：转成两组
      if (piece.includes(".")) {
        const value = ipv4ToInt(piece);
        if (value === null) return null;
        groups.push(BigInt(value >>> 16), BigInt(value & 0xffff));
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/u.test(piece)) return null;
      groups.push(BigInt(Number.parseInt(piece, 16)));
    }
    return groups;
  };
  const headGroups = toGroups(head ?? "");
  if (headGroups === null) return null;
  if (!raw.includes("::")) return headGroups.length === 8 ? headGroups : null;
  const tailGroups = toGroups(tail ?? "");
  if (tailGroups === null) return null;
  const fill = 8 - headGroups.length - tailGroups.length;
  if (fill < 0 || (raw.split("::").length > 2)) return null;
  return [...headGroups, ...Array.from({ length: fill }, () => 0n), ...tailGroups];
}

function isBlockedIpv6(address: string): boolean {
  const groups = ipv6Groups(address);
  if (!groups || groups.length !== 8) return false;
  const first = groups[0]!;
  if (groups.every((g) => g === 0n)) return true; // ::
  if (groups.every((g, i) => (i === 7 ? g === 1n : g === 0n))) return true; // ::1
  // IPv4 映射段（::ffff:0:0/96，前 5 组全零）与 NAT64（64:ff9b::/96，中间 4 组全零）：看末尾 32 位
  const trailing32 = (groups[6]! << 16n) | groups[7]!;
  if (groups.slice(0, 5).every((g) => g === 0n) && groups[5] === 0xffffn) return isBlockedIpv4Number(trailing32);
  if (groups[0] === 0x64n && groups[1] === 0xff9bn && groups.slice(2, 6).every((g) => g === 0n)) return isBlockedIpv4Number(trailing32);
  // Teredo（2001::/32）：废弃的过渡隧道段，整体不放行
  if (groups[0] === 0x2001n && groups[1] === 0n) return true;
  // 6to4（2002::/16）：内嵌 IPv4 在第 1、2 组
  if (first === 0x2002n) return isBlockedIpv4Number((groups[1]! << 16n) | groups[2]!);
  if (first === 0x100n && groups.slice(1, 4).every((g) => g === 0n)) return true; // 100::/64 discard-only
  if (first >= 0xfc00n && first <= 0xfdffn) return true; // fc00::/7 唯一本地
  if (first >= 0xfe80n && first <= 0xfebfn) return true; // fe80::/10 链路本地
  return false;
}

// 域名本身不是地址：这里只拦字面量 IP，域名交给连接时的 DNS 守卫（guardedLookup）。
// 不能用 `?? -1` 之类的哨兵值：-1 的补码恰好落进 240.0.0.0/4 的掩码，会把所有域名误判成保留地址。
export function isBlockedAddress(address: string): boolean {
  if (address.includes(":")) return isBlockedIpv6(address);
  const value = ipv4ToInt(address);
  return value !== null && isBlockedIpv4Range(value);
}

/** 连接时的 DNS 守卫：解析结果里出现内网地址就整体拒绝（undici Agent 的 connect.lookup 直接用）。 */
export function guardedLookup(
  hostname: string,
  options: LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  const lookupOptions: LookupAllOptions = { ...options, all: true };
  lookup(hostname, lookupOptions, (err, addresses) => {
    if (err) return callback(err, "");
    const blocked = addresses.find((item) => isBlockedAddress(item.address));
    if (blocked) {
      const error: NodeJS.ErrnoException = new Error(`域名解析到内网地址，已拦截：${hostname} → ${blocked.address}`);
      error.code = "EBLOCKEDADDRESS";
      return callback(error, "");
    }
    callback(null, addresses);
  });
}

/** URL 预检：只放行 http(s) 且目标不是字面量内网地址；allowPrivate 只给本机调试用。 */
export function assertPublicUrl(input: string, allowPrivate = false): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`URL 无法解析：${input}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`不支持的协议：${url.protocol}`);
  if (allowPrivate) return url;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (isBlockedAddress(host)) throw new Error(`目标指向内网/保留地址，已拦截：${host}`);
  return url;
}
