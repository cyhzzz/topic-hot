// 提示词统一从 industry/prompts/ 读：改词不用动代码。

import { readFileSync } from "node:fs";

export function loadPrompt(name: string): string {
  return readFileSync(new URL(`../../industry/prompts/${name}`, import.meta.url), "utf8").trim();
}
