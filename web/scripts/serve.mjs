// 本地预览静态站：无依赖的极简静态服务器，默认 4173 端口。
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));
const port = Number(process.env.PORT ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    let file = normalize(join(distDir, pathname));
    if (!file.startsWith(distDir)) throw Object.assign(new Error("forbidden"), { code: "EPERM" });
    if (pathname === "/" || !pathname.includes(".")) {
      const target = pathname.endsWith("/") ? join(file, "index.html") : `${file}.html`;
      try {
        await stat(target);
        file = target;
      } catch {
        file = join(distDir, "index.html");
      }
    }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch (error) {
    const forbidden = error?.code === "EPERM";
    res.writeHead(forbidden ? 403 : 404, { "content-type": "text/plain; charset=utf-8" });
    res.end(forbidden ? "Forbidden" : "Not Found");
  }
}).listen(port, () => {
  console.log(`预览地址：http://localhost:${port}`);
});
