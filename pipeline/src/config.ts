// 采集管线的运行配置：全部来自环境变量，没有 .env 就走默认值。
// GitHub Actions 里用仓库 Secrets / Variables 注入；本机开发复制 .env.example 成 .env。

import { fileURLToPath } from "node:url";
import { SITE } from "../../industry/site.ts";

function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : null;
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  return !/^(0|false|off|no)$/i.test(value.trim());
}

function int(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  /** 站点对外地址：抓取 UA、RSS 链接里用。 */
  siteUrl: str("SITE_URL", SITE.defaultUrl).replace(/\/+$/, ""),
  /** 数据目录：持久化的 JSON 都写在这里（仓库里的 data/）。 */
  dataDir: fileURLToPath(new URL("../../data/", import.meta.url)),
  /** 安全阀：关掉就不抓信源（调试时用）。 */
  collectEnabled: bool("COLLECT_ENABLED", true),
  /** 安全阀：关掉就强制走规则模式，不调模型。 */
  modelCallsEnabled: bool("MODEL_CALLS_ENABLED", true),
  llm: {
    baseUrl: optional("LLM_BASE_URL"),
    apiKey: optional("LLM_API_KEY"),
    model: str("LLM_MODEL", "deepseek-chat"),
    extraJson: optional("LLM_EXTRA_JSON"),
    jsonMode: bool("LLM_JSON_MODE", true),
    timeoutMs: int("LLM_TIMEOUT_MS", 90_000),
    /** 一次采集运行最多调多少次模型，防止失控烧钱。 */
    maxCallsPerRun: int("LLM_MAX_CALLS_PER_RUN", 400),
  },
  /** 本机抓海外信源走代理时用；GitHub Actions 不需要。 */
  egressProxyUrl: optional("EGRESS_PROXY_URL"),
  /** 只在调试时打开：允许抓内网地址。 */
  allowPrivateNetworkFetch: bool("ALLOW_PRIVATE_FETCH", false),
  fetchTimeoutMs: int("FETCH_TIMEOUT_MS", 20_000),
  maxFeedBytes: int("MAX_FEED_BYTES", 8 * 1024 * 1024),
  /** 条目保留天数（按发布时间），超期在发布步清理。 */
  retentionDays: int("RETENTION_DAYS", 14),
  /** 条目池上限，超出时丢最旧的。 */
  maxItems: int("MAX_ITEMS", 1500),
  /** “一天”的时区：日报按这里的日期分组。 */
  timezone: str("TZ", "Asia/Shanghai"),
} as const;

/** 模型是否可用：baseUrl 和 apiKey 都填了才算。 */
export function llmEnabled(): boolean {
  return config.modelCallsEnabled && !!(config.llm.baseUrl && config.llm.apiKey);
}
