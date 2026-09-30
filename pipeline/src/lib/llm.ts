// OpenAI 兼容的 /chat/completions 客户端：只做 JSON 输出的对话调用。
// 没配 LLM_BASE_URL / LLM_API_KEY 时整条管线自动降级为规则模式，不会走到这里。

import { config, llmEnabled } from "../config.ts";
import { guardedFetch } from "./http-fetch.ts";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

let callsUsed = 0;

export function llmCallsUsed(): number {
  return callsUsed;
}

function joinUrl(base: string, path: string): URL {
  return new URL(path, base.endsWith("/") ? base : `${base}/`);
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /HTTP 429|HTTP 5\d\d|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|UND_ERR|terminated/iu.test(error.message);
}

/**
 * 请求 JSON 输出并解析。429/5xx/网络错误重试两次（1s/2s 退避）；
 * 达到单次运行调用上限后抛错，由调用方决定降级。
 */
export async function chatJson<T = unknown>(messages: ChatMessage[], opts: { jsonMode?: boolean; temperature?: number; maxTokens?: number } = {}): Promise<T> {
  if (!llmEnabled()) throw new Error("LLM 未启用：缺 LLM_BASE_URL 或 LLM_API_KEY");
  if (callsUsed >= config.llm.maxCallsPerRun) throw new Error(`LLM 调用已达单次运行上限（${config.llm.maxCallsPerRun} 次）`);
  callsUsed += 1;

  const payload: Record<string, unknown> = {
    model: config.llm.model,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 2000,
  };
  if ((opts.jsonMode ?? true) && config.llm.jsonMode) payload.response_format = { type: "json_object" };
  if (config.llm.extraJson) {
    try {
      Object.assign(payload, JSON.parse(config.llm.extraJson) as Record<string, unknown>);
    } catch {
      throw new Error("LLM_EXTRA_JSON 不是合法 JSON");
    }
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await guardedFetch(joinUrl(config.llm.baseUrl!, "chat/completions"), {
        method: "POST",
        headers: { authorization: `Bearer ${config.llm.apiKey!}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
        timeoutMs: config.llm.timeoutMs,
      });
      if (res.status !== 200) throw new Error(`LLM HTTP ${res.status}：${Buffer.from(res.bytes.subarray(0, 300)).toString("utf8")}`);
      const body = JSON.parse(Buffer.from(res.bytes).toString("utf8")) as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content;
      if (!content || content.trim() === "") throw new Error("LLM 返回内容为空");
      return extractJson<T>(content);
    } catch (error) {
      lastError = error;
      if (attempt === 3 || !isRetryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * 从模型输出里抠出 JSON：剥代码围栏 → 截取最外层花括号 →
 * 仍失败时把字符串里的裸换行/制表符转义后重试一次。
 */
export function extractJson<T = unknown>(text: string): T {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  const body = fenced?.[1] ?? trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? body.slice(start, end + 1) : body;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return JSON.parse(escapeControlCharsInStrings(candidate)) as T;
  }
}

function escapeControlCharsInStrings(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of input) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && (ch === "\n" || ch === "\r" || ch === "\t")) {
      out += ch === "\t" ? "\\t" : ch === "\r" ? "\\r" : "\\n";
      continue;
    }
    out += ch;
  }
  return out;
}
