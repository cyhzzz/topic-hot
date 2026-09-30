# 给 Agent 的说明

这是一个行业热点网站的框架：GitHub Actions 每小时采集信源、用模型（可选）筛选和写作、归组事件、出日报，静态部署在 GitHub Pages 上。数据就是仓库里的 JSON，没有服务器和数据库。默认配置是一个 AI 行业的示例站。先读 README，再按任务读 `docs/` 里对应的文档。

## 最常见的任务：改成另一个行业

按 `docs/customize.md` 的顺序做。行业相关的一切都在 `industry/`：站名文案（`site.ts`）、分类标签（`taxonomy.ts`）、主题（`topics.json`）、示范信源（`sources.json`）、提示词（`prompts/`）、门槛（`selection.ts`）、条款页模板（`pages/`）。通常不需要改 `pipeline/` 和 `web/`。

这些事要问使用者本人，不要替他决定：站名；要盯哪些信源；什么消息重要、什么是噪声；分类怎么分；条款和隐私说明的内容（`industry/pages/` 是模板，当前页面不渲染它们，正式使用前需要他本人确认放置方式）。

改评分门槛时保留原有结构（内容类型、五维加权、噪声压制、安全边界），替换的是"什么算重要""什么算噪声"的例子。门槛要用使用者标注的样本重新校准（`docs/customize.md`），不要凭感觉改数字。

## 站点身份的流向

站名、标语、关于页文案的唯一来源是 `industry/site.ts`。管线发布时把它组装进 `data/site.json` 的 `site` 字段，前端（`web/public/assets/app.js` 的 `applyIdentity`）据此渲染页头、标题和关于页。**不要在前端写死任何行业文案**；同理也不要在 `pipeline/` 里写死文案。改 `site.ts` 后跑一轮 `npm run collect` 让它流进 `site.json`。

## 运行与检查

- Node.js 24 直接运行 TypeScript，后端没有构建步骤。npm workspaces：`pipeline`、`web`、`industry`。
- 本地运行与 GitHub Pages 部署见 `docs/deploy.md`。
- 改完至少跑：
  ```bash
  npm run typecheck
  npm run collect          # 需要网络；失败的信源会以非致命错误列出
  npm run build:web
  npm run preview          # 打开 http://localhost:4173 人工检查
  ```
- `data/` 里的 JSON 是真实采集结果，也充当站点的演示数据；调试时可以整目录删掉重采。

## 要守住的规则

- 读者打开页面不触发模型调用：页面是纯静态的，模型只在 `npm run collect` 的任务里被调用。
- 前端唯一的数据源是 `data/site.json`（构建时拷进 `web/dist/data/`）。条目池、游标、运行元数据是内部文件，不得发布到 dist。
- 付费请求（模型调用）集中在 `pipeline/src/lib/llm.ts`，带重试与用量计数；新增模型调用走它，不要绕开。
- 开发和调试时保持外部访问的可控性：`ALLOW_PRIVATE_FETCH` 只在本地代理导致误拦时临时打开（`.env`，不入库），生产环境一律关闭。
- 信源默认只展示摘要和原文链接（`site_fulltext` 关）；只有来源明确允许时才打开全文。
- 采集报错不中断任务：单个信源失败记入 `meta.json` 的 `errors`，其余信源照常处理。
- `data/` 随仓库提交（Actions 会自动 commit）；不要提交 `.env`、密钥和 `web/dist/`。
- 分类 key（`taxonomy.ts` 的 `CATEGORIES[].key`）出现在网址里，上线后不要再改；标签词表和公司名录可以随时增减。
- 不要使用 AIHOT 的名字和 Logo（见 NOTICE）。

## 写代码

匹配周围代码的写法、命名和注释密度。选能清楚解决问题的简单方案，只定义正在使用的抽象。验证改动涉及的重要行为，不为简单的样式改动写测试。
