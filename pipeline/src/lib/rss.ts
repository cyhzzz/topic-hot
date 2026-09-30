// RSS/Atom/RDF 信源的抓取与解析：条件请求（304 直接跳过）、teaser 检测、统一候选结构。
// 输出候选不挂 sourceId/via，由 fetch 步骤落地时补上。

import { XMLParser } from "fast-xml-parser";
import { config } from "../config.ts";
import { shortHash } from "./ids.ts";
import { decodeBody, guardedFetch } from "./http-fetch.ts";
import { collapseWhitespace, guessLanguage, stripTags, truncate } from "./text.ts";
import { identityKeyForUrl, normalizeUrl } from "./url.ts";
import type { BodyStatus, Candidate, FeedValidator, MediaItem, SourceRow } from "./types.ts";

/** 纯文本短于这个数、或带这些“去原文看”痕迹的，视为导语而不是全文。 */
const TEASER_BELOW = 1200;
const TEASER_MARKS = /继续阅读|阅读全文|查看全文|阅读更多|展开全文|Read more|Read the rest|Continue reading/iu;
const EXCERPT_LENGTH = 500;

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  removeNSPrefix: true,
  // 这四个节点可能是 XHTML，保留原始字符串，交给 stripTags 处理。
  stopNodes: ["*.encoded", "*.content", "*.summary", "*.description"],
});

function isObj(value: unknown): value is XmlNode {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** 取节点的文本值：字符串直接用，带属性的对象取 #text。 */
function strOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isObj(value)) {
    const text = value["#text"];
    if (typeof text === "string") return text;
  }
  return undefined;
}

function pickText(entry: XmlNode, keys: string[]): string | undefined {
  for (const key of keys) {
    const text = strOf(entry[key]);
    if (text && text.trim()) return text;
  }
  return undefined;
}

/** stopNodes 拿到的原始串可能还带 CDATA 包裹，先剥掉。 */
function unwrap(raw: string): string {
  return raw.replace(/<!\[CDATA\[/gu, "").replace(/\]\]>/gu, "").trim();
}

function parseDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** Atom 的 <link> 可能有多条：优先 alternate，其次无 rel 的，最后任意一条。 */
function atomLink(entry: XmlNode): string | undefined {
  const links = asArray(entry.link).filter(isObj);
  if (links.length === 0) return undefined;
  const alternate = links.find((link) => link["@_rel"] === "alternate") ?? links.find((link) => !link["@_rel"]) ?? links[0];
  return strOf(alternate["@_href"]);
}

function isTeaser(text: string): boolean {
  return text.length < TEASER_BELOW || TEASER_MARKS.test(text);
}

function imagesFrom(entry: XmlNode, html: string | undefined): MediaItem[] {
  const items: MediaItem[] = [];
  const push = (url: string | undefined) => {
    if (!url || !/^https?:/iu.test(url)) return;
    if (!items.some((media) => media.url === url)) items.push({ url });
  };
  for (const enclosure of asArray(entry.enclosure).filter(isObj)) {
    const type = strOf(enclosure["@_type"]) ?? "";
    if (!type || type.startsWith("image/")) push(strOf(enclosure["@_url"]));
  }
  // removeNSPrefix 之后 media:content 和 Atom content 同名；带 @_url 的是媒体对象，字符串是正文。
  for (const media of asArray(entry.content).filter(isObj)) push(strOf(media["@_url"]));
  for (const thumbnail of asArray(entry.thumbnail).filter(isObj)) push(strOf(thumbnail["@_url"]));
  push(html ? /<img[^>]+src=["']([^"'\s]+)["']/iu.exec(html)?.[1] : undefined);
  return items.slice(0, 4);
}

type BodyParts = {
  excerpt?: string;
  bodyHtml?: string;
  bodyText?: string;
  bodyStatus: BodyStatus;
  /** 不管是否保留正文，都拿条目里的 HTML 提一遍封面图。 */
  rawHtml?: string;
};

/** 从 feed 条目里拆出摘要与正文：摘要始终有就截短；正文只在信源允许全读时保留。 */
function bodyParts(source: SourceRow, entry: XmlNode): BodyParts {
  const leadSource = pickText(entry, ["description", "summary"]);
  const fullSource = pickText(entry, ["encoded", "content"]);
  const leadHtml = leadSource ? unwrap(leadSource) : "";
  const leadText = collapseWhitespace(stripTags(leadHtml));
  const fullHtml = fullSource ? unwrap(fullSource) : "";

  if (source.site_fulltext && fullHtml) {
    const text = collapseWhitespace(stripTags(fullHtml));
    if (text) {
      return {
        excerpt: truncate(leadText || text, EXCERPT_LENGTH),
        bodyHtml: fullHtml,
        bodyText: text,
        bodyStatus: isTeaser(text) ? "pending" : "ok",
        rawHtml: fullHtml || leadHtml,
      };
    }
  }
  if (leadText) return { excerpt: truncate(leadText, EXCERPT_LENGTH), bodyStatus: "unconfirmed", rawHtml: leadHtml };
  if (fullHtml) {
    const text = collapseWhitespace(stripTags(fullHtml));
    if (text) return { excerpt: truncate(text, EXCERPT_LENGTH), bodyStatus: "unconfirmed", rawHtml: fullHtml };
  }
  return { bodyStatus: "none" };
}

function candidateFrom(source: SourceRow, entry: XmlNode, now: number): Candidate | null {
  const rawLink = atomLink(entry) ?? strOf(entry.link);
  if (!rawLink || !/^https?:/iu.test(rawLink.trim())) return null;
  const url = normalizeUrl(rawLink.trim());
  if (!url) return null;
  const title = collapseWhitespace(stripTags(strOf(entry.title) ?? ""));
  if (!title) return null;

  const parts = bodyParts(source, entry);
  const author = strOf(entry.creator) ?? strOf((isObj(entry.author) ? entry.author.name : entry.author) as unknown) ?? undefined;
  const publishedAt = parseDate(strOf(entry.pubDate) ?? strOf(entry.published) ?? strOf(entry.date));
  const backfill = publishedAt ? now - Date.parse(publishedAt) > 48 * 60 * 60 * 1000 : true;
  const guid = strOf(entry.guid);

  return {
    url,
    title,
    identityKey: identityKeyForUrl(url),
    author,
    language: guessLanguage(`${title} ${parts.excerpt ?? ""}`),
    publishedAt,
    sourceUpdatedAt: parseDate(strOf(entry.updated)),
    excerpt: parts.excerpt,
    bodyHtml: parts.bodyHtml,
    bodyText: parts.bodyText,
    bodyStatus: parts.bodyStatus,
    media: imagesFrom(entry, parts.rawHtml),
    raw: guid ? { guid } : undefined,
    discoveredAt: new Date(now).toISOString(),
    backfill,
  };
}

type FeedDoc = { rss?: unknown; RDF?: unknown; feed?: unknown };

export type RssFetchResult = {
  candidates: Candidate[];
  validator: FeedValidator;
  /** 命中 304，feed 自上次以来没有变化。 */
  notModified: boolean;
  feedTitle?: string;
};

/**
 * 抓取并解析一个 feed。validator 传上次返回的协商缓存凭据即可走条件请求；
 * feedUrl 变了会自动作废旧凭据。force 为真时跳过缓存直接拉全量。
 */
export async function fetchRss(source: SourceRow, validator: FeedValidator = {}, opts: { force?: boolean } = {}): Promise<RssFetchResult> {
  const feedUrl = source.config.feedUrl;
  const configHash = shortHash(feedUrl, 16);
  const cached = validator.configHash === configHash ? validator : {};
  const headers: Record<string, string> = {
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  };
  if (!opts.force) {
    if (cached.etag) headers["if-none-match"] = cached.etag;
    if (cached.lastModified) headers["if-modified-since"] = cached.lastModified;
  }

  const response = await guardedFetch(feedUrl, {
    headers,
    maxBytes: config.maxFeedBytes,
    timeoutMs: config.fetchTimeoutMs,
  });

  const nextValidator: FeedValidator = {
    etag: response.headers.etag ?? cached.etag,
    lastModified: response.headers["last-modified"] ?? cached.lastModified,
    configHash,
  };
  if (response.status === 304) return { candidates: [], validator: nextValidator, notModified: true };
  if (response.status >= 400) throw new Error(`HTTP ${response.status}：${feedUrl}`);

  const doc = parser.parse(decodeBody(response)) as FeedDoc;
  const channel = isObj(doc.rss) && isObj((doc.rss as XmlNode).channel) ? ((doc.rss as XmlNode).channel as XmlNode)
    : isObj(doc.RDF) ? (doc.RDF as XmlNode)
    : isObj(doc.feed) ? (doc.feed as XmlNode)
    : {};
  const entries = [...asArray(channel.item), ...asArray(channel.entry)].filter(isObj);
  const feedTitle = collapseWhitespace(stripTags(strOf(channel.title) ?? "")) || undefined;

  const now = Date.now();
  const limit = source.config.backfillLimit ?? 8;
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const candidate = candidateFrom(source, entry, now);
    if (!candidate || seen.has(candidate.identityKey!)) continue;
    seen.add(candidate.identityKey!);
    candidates.push(candidate);
    if (candidates.length >= limit) break;
  }
  return { candidates, validator: nextValidator, notModified: false, feedTitle };
}
