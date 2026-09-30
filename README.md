# Topic Hot

自动盯住一批行业信源（当前是 AI），每小时采集一轮：抓取 → 归并同一件事 → 打分精选 → 出日报，部署在 GitHub Pages 上。无需服务器、无需数据库——数据就是仓库里的 JSON。

**在线地址**：<https://cyhzzz.github.io/topic-hot/>

## 特性

- **零服务部署**：GitHub Actions 每小时跑一次采集，把结果提交回仓库并发布到 Pages；没有任何常驻进程。
- **模型可选，自动降级**：配置了 OpenAI 兼容接口就用模型打分与写摘要；没配置则全链路走规则打分，照样能跑。
- **事件聚合**：多条信源报道同一件事时归成一张卡，而不是刷屏。
- **换行业只改一个目录**：站名文案、分类标签、信源、提示词、门槛全部集中在 `industry/`。
- **读者页面纯静态**：页面只读一个 `site.json`，打开页面不触发任何模型调用。

## 本地跑通

需要 Node.js ≥ 24（直接运行 TypeScript，后端没有构建步骤）。

```bash
npm ci
cp .env.example .env        # 按需改；不配 LLM_API_KEY 就走纯规则模式
npm run collect             # 采集一轮，生成 data/*.json
npm run build:web           # 生成 web/dist（拷入 data/site.json）
npm run preview             # 打开 http://localhost:4173
```

本机走代理抓海外信源时，在 `.env` 里设 `EGRESS_PROXY_URL`（见 `.env.example`）。密钥不要提交到 Git，`.env` 已在 `.gitignore` 里。

## 部署到 GitHub Pages

1. 把仓库推到 GitHub（公开仓库，Pages 免费额度足够）。
2. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
3. 打开 **Actions** 页签，手动触发一次 **Collect and deploy**（之后每小时整点自动跑）。

模型密钥（可选）配在仓库 **Settings → Secrets and variables → Actions**：`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`。详细说明与排错见 [docs/deploy.md](docs/deploy.md)。

## 换一个行业

一切行业相关的东西都在 [`industry/`](industry/)：改 [`industry/site.ts`](industry/site.ts) 的站名文案、[`industry/taxonomy.ts`](industry/taxonomy.ts) 的分类标签、[`industry/sources.json`](industry/sources.json) 的信源列表、[`industry/selection.ts`](industry/selection.ts) 的精选门槛、[`industry/prompts/`](industry/prompts/) 的提示词。站名和文案改完推上 GitHub，下一轮采集会把它写进 `data/site.json`，页面自动跟着变。完整步骤见 [docs/customize.md](docs/customize.md)。

## 目录结构

```
industry/          行业配置（换行业只改这里）
  site.ts          站点身份与读者文案（→ data/site.json → 前端）
  taxonomy.ts      分类、标签词表、公司名录、身份词典
  sources.json     信源列表（tier 分级、抓取间隔）
  topics.json      主题页定义
  selection.ts     精选门槛（多少分入选）
  prompts/         三份提示词：内容理解、评分、日报导语
  pages/           条款与隐私模板（未渲染，上线前自行确认）
pipeline/          采集管线（Node + TS，无框架）
  src/steps/       fetch → triage → summarize → group → report → publish
  src/lib/         rss / http-fetch / text / llm / day / ids / url
web/               静态站点（无框架 SPA，读 data/site.json）
data/              采集结果（JSON 就是数据库，随仓库提交）
  site.json        站点唯一读取的数据文件
  reports/         每日日报
.github/workflows/collect.yml   每小时采集 + Pages 部署
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run collect` | 采集一轮：抓取 → 打分 → 归组 → 日报 → 写 `data/` |
| `npm run typecheck` | 类型检查（pipeline + industry） |
| `npm run build:web` | 生成 `web/dist`（只拷入 `data/site.json`） |
| `npm run preview` | 本地预览静态站（4173 端口） |

## License

MIT（见 [LICENSE](LICENSE)）。本项目派生自 AIHOT，见 [NOTICE](NOTICE)；未使用 AIHOT 的名称与 Logo。
