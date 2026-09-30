// 文本处理：清洗、截断、转义、语言猜测。

const GRAPHEMES = new Intl.Segmenter("und", { granularity: "grapheme" });

const NAMED_ENTITIES: Record<string, string> = {
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/gu, " ").trim();
}

/** 按字素截断（中文 emoji 都算一个字），超出补省略号。 */
export function truncate(input: string, max: number): string {
  const segments = [...GRAPHEMES.segment(input)];
  if (segments.length <= max) return input;
  return segments.slice(0, Math.max(0, max - 1)).map((segment) => segment.segment).join("") + "…";
}

export function stripTags(html: string): string {
  let text = html;
  // 两轮处理：有些信源把 HTML 转义后塞进 description，实体解码会露出新标签，需再剥一次。
  for (let round = 0; round < 2; round++) {
    text = text
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
      .replace(/<!--[\s\S]*?-->/gu, " ")
      .replace(/<[^>]+>/gu, " ")
      .replace(/&nbsp;/giu, " ")
      .replace(/&amp;/giu, "&")
      .replace(/&lt;/giu, "<")
      .replace(/&gt;/giu, ">")
      .replace(/&quot;/giu, "\"")
      .replace(/&#39;|&apos;/giu, "'")
      .replace(/&(mdash|ndash|hellip|lsquo|rsquo|ldquo|rdquo);/giu, (_, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? _)
      .replace(/&#(\d+);/gu, (_, code: string) => safeCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => safeCodePoint(Number.parseInt(code, 16)));
  }
  return text;
}

function safeCodePoint(code: number): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

export function escapeXml(input: string): string {
  return input.replace(/[&<>"']/gu, (ch) => `&#${ch.codePointAt(0)};`);
}

export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/gu, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      default: return "&#39;";
    }
  });
}

export function cjkRatio(input: string): number {
  const chars = [...input];
  if (chars.length === 0) return 0;
  const cjk = chars.filter((ch) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(ch)).length;
  return cjk / chars.length;
}

export function guessLanguage(input: string): "zh" | "en" | "other" {
  const sample = input.slice(0, 2000);
  if (cjkRatio(sample) >= 0.12) return "zh";
  if (/[a-z]/iu.test(sample)) return "en";
  return "other";
}
