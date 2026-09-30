// 把 web/public 拷到 web/dist，再把仓库根的 data/site.json 拷进 dist/data。
// 站点只读 site.json；条目池、游标等内部数据不对外发布。
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const dist = new URL("../dist/", import.meta.url);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(new URL("../public/", import.meta.url), dist, { recursive: true });

const siteJson = new URL("../../data/site.json", import.meta.url);
if (existsSync(siteJson)) {
  mkdirSync(new URL("./data/", dist), { recursive: true });
  cpSync(siteJson, new URL("./data/site.json", dist));
}

console.log("web/dist 已生成");
