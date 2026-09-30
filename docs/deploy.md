# 运行与部署

## 本地运行

需要 Node.js ≥ 24（直接运行 TypeScript，没有构建步骤）。

```bash
npm ci
cp .env.example .env      # 按需修改；密钥不要提交
npm run collect           # 采集一轮
npm run build:web         # 生成 web/dist
npm run preview           # http://localhost:4173
```

`.env` 里会用到：

| 变量 | 说明 |
| --- | --- |
| `SITE_URL` | 站点对外地址（写进数据里的链接）；本地预览用 `http://localhost:4173` |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 可选。任一 OpenAI 兼容接口；不配就自动降级为纯规则模式 |
| `EGRESS_PROXY_URL` | 本机抓海外信源要走代理时设置 |
| `ALLOW_PRIVATE_FETCH` | 仅调试用：本地代理的 fake-IP DNS 会把域名解析到保留地址段，被 SSRF 预检拦截时临时打开。**生产环境一律关闭** |

采集结尾会列出非致命错误（单个信源失败不影响整体），细节看 `data/meta.json` 的 `errors`。

## 部署到 GitHub Pages

工作流是 `.github/workflows/collect.yml`：一个工作流、两个 job——采集并把 `data/` 提交回仓库、构建 `web/dist` 并部署 Pages。触发方式：每小时整点（UTC）定时 + 手动。

首次部署三步：

1. **推送仓库到 GitHub**（公开仓库）。
2. **启用 Pages**：仓库 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。
3. **跑一次工作流**：Actions 页签 → Collect and deploy → Run workflow。跑完在 job 详情页能看到 Pages 地址（`https://<用户名>.github.io/<仓库名>/`）。

之后每个整点自动采集；数据有变化才提交（`git diff --cached --quiet` 判断），没有变化就跳过提交但照样重新部署。

### 可选 Secrets

仓库 Settings → Secrets and variables → Actions：

| Secret | 说明 |
| --- | --- |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 模型接口。不配则纯规则模式，没有任何费用 |
| `EGRESS_PROXY_URL` | 一般不需要；GitHub 的机器抓海外站点通常直连可达 |
| `SITE_URL` | 不用默认地址（如绑定自定义域名）时设置 |

## 常见问题

**Pages 打开 404**
首次部署要等 Collect and deploy 跑完一次；确认 Settings → Pages 的 Source 已选 GitHub Actions。

**采集一轮 0 条、全部信源报"目标指向内网/保留地址"**
几乎都是本地代理的 fake-IP DNS（域名解析到 198.18.0.0/15）触发了 SSRF 预检。本地调试在 `.env` 里临时开 `ALLOW_PRIVATE_FETCH=true`；GitHub Actions 的机器没有这个问题，不要在仓库里开。

**个别信源一直失败**
看 `data/meta.json` 的 `errors` 里的具体原因：超时可能是源站慢或被墙（试 `EGRESS_PROXY_URL`）；404/301 是feed 地址变了；持续失败就先从 `sources.json` 移除，别让它刷屏。

**想改采集频率**
改 `.github/workflows/collect.yml` 里的 cron（注意是 UTC 时间）。信源级的抓取间隔另由 `sources.json` 的 `interval_minutes` 控制，游标未到期会自动跳过。

**模型调用量**
只有打分与写摘要在 collect 任务里发生；没配密钥就是 0 次。调用量大致 = 当轮新增条目数 ×（1~2 次），可在 `data/meta.json` 的 `llmCallsUsed` 观察；觉得贵就提高门槛或减少信源。
