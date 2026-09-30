# 换一个行业

换行业只改 `industry/` 一个目录，`pipeline/` 和 `web/` 不用动。下面按推荐顺序列出每个文件改什么、怎么验证。改完的最后一步都是：跑一轮 `npm run collect`，让改动流进 `data/site.json`，再 `npm run build:web && npm run preview` 人工过一遍页面。

开始之前，先和站点的主人确认四件事（不要替他决定）：

1. 站名叫什么、一句话介绍怎么写；
2. 盯哪些信源（RSS 地址）；
3. 什么消息重要、什么算营销稿和噪声；
4. 分类怎么分、条款与隐私怎么写。

## 1. 站名与文案：`site.ts`

站点身份的唯一来源。`SITE` 是站名、行业词、标题、介绍、标语、联系邮箱、页脚小字；`ABOUT` 是关于页的文案（大标题两行、导语、四个环节、版权说明）。

- `subject` 是行业词（如 `"AI"`、`"法律"`），会拼进"AI 日报"这类说法（`withSubject` 自动处理中英文间距）。
- `ABOUT.lead` 里的 `{sources}` 占位符会在发布时替换成实际信源数。
- `defaultUrl` 改成你的 Pages 地址（`https://<用户名>.github.io/<仓库名>`），或在仓库 Secrets 里配 `SITE_URL`。
- `crawlerName` 是抓信源时报的 User-Agent 名字，改成你自己的，不要冒用别的站。

流向：`site.ts` → 管线组装 → `data/site.json` 的 `site` 字段 → 前端页头、`<title>`、meta description、关于页、页脚全部跟着变。`index.html` 里的静态文字只是 JS 加载前的兜底，顺手改成一致的即可。

## 2. 分类与词表：`taxonomy.ts`

- `CATEGORIES`：页面筛选栏的类别。**key 会出现在网址里，上线后不要再改**；`label` 是显示名，`section` 是日报分节（几个类别可共用一节），`guide` 告诉模型怎么归类。
- `ITEM_TYPES`：内容类型（模型发布 / 产品 / 论文…），评分提示词按类型给不同权重。改了类型要同步改 `prompts/selection-score.md` 的类型表。
- `CATEGORY_TAGS` / `TOPIC_TAGS` / `ENTITY_TAGS`：模型打标签的词表。第一个标签必须是分类标签；近义词归一写在 `TAG_SYNONYMS`。
- `ENTITIES`：公司名录（id、显示名、别名）。`sources.json` 里的 `owner_entity_id` 要引用这里的 id。
- `IDENTITY_LEXICON`：身份词典——摘要里提到的公司必须在原文里也出现，否则丢弃摘要，防止模型张冠李戴。行业没有混淆问题时可以留空数组。
- `PUBLISHER_DOMAINS`：这些域名上的文章，发布方就是对应公司。

## 3. 信源列表：`sources.json`

按数组顺序抓取。常用字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 稳定标识，游标按它存，不要中途改 |
| `name` | 页面上显示的来源名 |
| `kind` | 目前支持 `"rss"` |
| `config.feedUrl` | RSS 地址 |
| `config.backfillLimit` | 首次抓取回溯多少条 |
| `tier` | 信源分级：`T1` 官方一手 / `T1_5` 官方账号、准官方 / `T2` 媒体与个人；分级直接决定精选门槛 |
| `owner_entity_id` | 发布方，引用 `taxonomy.ts` 的 `ENTITIES` id |
| `interval_minutes` | 抓取间隔（分钟）；游标未到期就跳过 |
| `tags` | 来源自身的固定标签 |
| `site_fulltext` | 站点上是否展示全文；默认 `false`，只在来源明确允许时打开 |

挑信源的原则：优先官方一手（门槛低、噪声小），媒体源控制在能看过来的数量。加完源跑一轮 `npm run collect`，看结尾列出的失败信源和 `data/meta.json` 的 `errors`。

## 4. 主题页：`topics.json`

按标签聚合的追踪页定义（公司 / 技术方向 / 内容形态三组）。`tags` 里的 `entity:<id>` 按公司归组，其余按标签词表。换行业时整份重写，`entityId` 同样引用 `ENTITIES` 的 id。

## 5. 精选门槛：`selection.ts`

`thresholds` 是各分级的入选门槛（两次模型打分的平均分）。原则：

- 官方一手（T1）门槛低，媒体与个人（T2）门槛高——示范值 `T1: 60, T1_5: 65, T2: 76`。
- **不要凭感觉改数字。** 校准方法：让站点主人标注一批资料（重要 / 一般 / 噪声），跑 `npm run collect` 看这些资料的平均分落在哪里，把门槛卡在"重要基本入选、噪声基本不入选"的位置；再观察几轮 `data/meta.json` 的 `selectedToday`，精选量长期过多或过少都说明门槛偏了。
- `understandFloor` 控制哪些没入选的资料也用完整的"内容理解"写法，其余用便宜的标题摘要。

## 6. 提示词：`prompts/`

三份提示词，全部换成新行业的语境：

- `content-understanding.md`：内容理解（类型判断、标题摘要、标签、推荐理由）。类型表要与 `taxonomy.ts` 的 `ITEM_TYPES` 一致。
- `selection-score.md`：注意力评分（五个维度加权 + 噪声压制 + 注入防御）。改"什么算重要、什么算噪声"的例子，保留结构与安全边界；改了维度或权重要和 `content-understanding.md`、门槛校准一起联动。
- `report-daily-lead.md`：日报导语的写法。

提示词里所有"AI 行业"的举例都要替换，否则模型会按旧行业打分。

## 7. 条款与隐私：`pages/`

`terms.md` 和 `privacy.md` 是模板。**当前站点不渲染它们**——正式对外前，站点主人需要确认内容并把它们放到合适的位置（比如仓库 README、关于页补充或独立页面）。这是上线前的人工确认项，不要替他定稿。

## 上线前的检查清单

```bash
npm run typecheck          # 类型过
npm run collect            # 信源基本都抓得到，errors 可解释
npm run build:web
npm run preview            # 过一遍：今日 / 事件 / 全部 / 关于
```

- `data/site.json` 的 `site.name`、`about.lead` 是新行业的；
- 日报分节标题与分类对得上；精选比例合理（看 `meta.json` 的 `selectedToday`）；
- 搜索几个公司名，事件聚合卡片张冠李戴的（`IDENTITY_LEXICON` 拦截后会退回原标题）是否可接受。
