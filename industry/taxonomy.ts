// 这个行业的分类体系：类别、标签词表、公司（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉模型怎么归类。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 * 第一个 key 固定为 industry（管线日报兜底逻辑按这个 key 找分节），证券行业对应“券商经营”。
 */
export const CATEGORIES = [
  { key: "industry", label: "经营", section: "券商经营", guide: "券商业绩财报、增资融资、并购重组、人事变动、分支机构与牌照、业务线经营数据" },
  { key: "policy", label: "政策", section: "监管政策", guide: "证监会、交易所、行业协会发布的监管新规、政策文件、处罚与合规要求" },
  { key: "market", label: "市场", section: "市场动态", guide: "行情走势、成交与两融、IPO 与再融资、基金发行、资金流向，以及影响券商业务的宏观数据" },
  { key: "acquisition", label: "获客展业", section: "获客展业", guide: "券商获客营销、开户与客户转化、直播与私域运营、投顾展业、财富管理转型的实践与案例" },
  { key: "product", label: "产品", section: "产品与工具", guide: "券商App、交易工具、投顾与基金投顾产品、金融科技与 AI 应用的发布和更新" },
  { key: "opinion", label: "观点", section: "观点分析", guide: "分析师观点、研报解读、行业评论、趋势讨论与访谈" },
] as const;

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["firm_event", "policy_regulation", "market_move", "client_acquisition", "product_release", "opinion_analysis", "tutorial_explainer"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "券商经营", "监管政策", "市场动态", "获客展业", "财富管理", "产品更新", "金融科技", "观点/评论", "教程/实践", "数据/榜单", "海外同业", "非证券/宏观", "其他",
] as const;

/** 可选的主题标签。 */
export const TOPIC_TAGS = [
  "两融", "IPO", "再融资", "并购重组", "基金投顾", "投行业务", "经纪业务", "资管业务", "佣金", "降费让利", "开户", "直播获客", "私域运营", "AI应用", "跨境业务",
] as const;

/** 可选的实体标签（公司、机构、平台）。 */
export const ENTITY_TAGS = ["中信证券", "华泰证券", "国泰海通", "中金公司", "中信建投", "招商证券", "广发证券", "中国银河", "申万宏源", "东方财富", "同花顺"] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  "业绩/财报": "券商经营", 业绩: "券商经营", 财报: "券商经营", "并购/重组": "券商经营", 人事: "券商经营",
  融资: "券商经营", 增资: "券商经营", 牌照: "券商经营", 分支机构: "券商经营", 营业部: "券商经营", 券商: "券商经营",
  政策: "监管政策", 监管: "监管政策", 新规: "监管政策", 处罚: "监管政策", 合规: "监管政策", 证监会: "监管政策",
  行情: "市场动态", 成交: "市场动态", 股市: "市场动态", A股: "市场动态", 牛市: "市场动态", 市场: "市场动态",
  两融余额: "两融", 融资融券: "两融", IPO: "IPO", 首发上市: "IPO", 定增: "再融资", 并购: "并购重组", 重组: "并购重组",
  获客: "获客展业", 展业: "获客展业", 营销: "获客展业", 开户: "开户", 直播: "直播获客", 私域: "私域运营", 客户经理: "获客展业",
  "财富管理": "财富管理", 基金销售: "财富管理", 代销: "财富管理", 投顾: "基金投顾", "买方投顾": "基金投顾",
  产品: "产品更新", 更新: "产品更新", 上线: "产品更新", App: "产品更新",
  数字化: "金融科技", "人工智能": "AI应用", 大模型: "AI应用", AI: "AI应用",
  研报: "观点/评论", 观点: "观点/评论", 评论: "观点/评论", 分析: "观点/评论", 趋势: "观点/评论",
  教程: "教程/实践", 实操: "教程/实践", 案例: "教程/实践", 技巧: "教程/实践", 指南: "教程/实践", 最佳实践: "教程/实践", 实践: "教程/实践",
  排名: "数据/榜单", 榜单: "数据/榜单", 数据: "数据/榜单", 统计: "数据/榜单",
  海外券商: "海外同业", 高盛: "海外同业", "摩根士丹利": "海外同业", 大摩: "海外同业", 美林: "海外同业", 富途: "海外同业", 老虎证券: "海外同业",
  非证券: "非证券/宏观", 宏观: "非证券/宏观", 外汇: "非证券/宏观", "大宗商品": "非证券/宏观", 债市: "非证券/宏观", 房地产: "非证券/宏观",
};

/** 模型漏了分类标签时，按内容类型补一个。 */
export const CATEGORY_BY_ITEM_TYPE: Readonly<Record<string, string>> = {
  firm_event: "券商经营", policy_regulation: "监管政策", market_move: "市场动态", client_acquisition: "获客展业",
  product_release: "产品更新", opinion_analysis: "观点/评论", tutorial_explainer: "教程/实践",
};

// ── 公司与主体 ──────────────────────────────────────────────────────────────────────────

/** 公司主题：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[] }> = {
  citic: { name: "中信证券", displayTag: null, aliases: ["中信证券", "中信"] },
  huatai: { name: "华泰证券", displayTag: null, aliases: ["华泰证券", "华泰", "涨乐财富通"] },
  gtht: { name: "国泰海通", displayTag: null, aliases: ["国泰海通", "国泰君安", "海通证券"] },
  cicc: { name: "中金公司", displayTag: null, aliases: ["中金公司", "中金", "CICC"] },
  csc: { name: "中信建投", displayTag: null, aliases: ["中信建投", "建投"] },
  cms: { name: "招商证券", displayTag: null, aliases: ["招商证券"] },
  gf: { name: "广发证券", displayTag: null, aliases: ["广发证券"] },
  galaxy: { name: "中国银河", displayTag: null, aliases: ["中国银河", "银河证券"] },
  swhy: { name: "申万宏源", displayTag: null, aliases: ["申万宏源", "申万"] },
  em: { name: "东方财富", displayTag: null, aliases: ["东方财富", "东财", "天天基金"] },
  ths: { name: "同花顺", displayTag: null, aliases: ["同花顺"] },
};

/**
 * 身份词典：摘要和标题里出现的公司，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 * 行业没有这个问题时可以留空数组。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "citic", name: "中信证券", patterns: [/中信证券|\bCITIC\s?Securities/i] },
  { id: "huatai", name: "华泰证券", patterns: [/华泰证券|\bHuatai\b|涨乐财富通|\bHTSC\b/i] },
  { id: "gtht", name: "国泰海通", patterns: [/国泰海通|国泰君安|海通证券|\bHaitong\b|\bGTJA\b/i] },
  { id: "cicc", name: "中金公司", patterns: [/中金公司|中金(?!所|在线)|\bCICC\b/i] },
  { id: "csc", name: "中信建投", patterns: [/中信建投|建投证券|\bCSC\s?(?:Financial|Research)\b/i] },
  { id: "cms", name: "招商证券", patterns: [/招商证券|\bChina\s?Merchants\s?Securities/i] },
  { id: "gf", name: "广发证券", patterns: [/广发证券|\bGF\s?Securities/i] },
  { id: "galaxy", name: "中国银河", patterns: [/银河证券|中国银河|\bChina\s?Galaxy/i] },
  { id: "swhy", name: "申万宏源", patterns: [/申万宏源|申万(?:研究|行业|评级)|\bSWS\b/i] },
  { id: "em", name: "东方财富", patterns: [/东方财富|东财|天天基金|\bEast\s?Money/i] },
  { id: "ths", name: "同花顺", patterns: [/同花顺|\biFinD\b/i] },
];

/** 这些域名上的文章，发布方就是对应的公司（托管平台如 GitHub、arXiv 不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "citic", domains: ["citics.com"] },
  { entityId: "huatai", domains: ["htsc.com.cn"] },
  { entityId: "gtht", domains: ["gtht.com", "gtja.com", "htsec.com"] },
  { entityId: "cicc", domains: ["cicc.com"] },
  { entityId: "csc", domains: ["csc108.com"] },
  { entityId: "cms", domains: ["newone.com.cn"] },
  { entityId: "gf", domains: ["gf.com.cn"] },
  { entityId: "galaxy", domains: ["chinastock.com.cn"] },
  { entityId: "swhy", domains: ["sw2000.com", "swsresearch.com"] },
  { entityId: "em", domains: ["eastmoney.com"] },
  { entityId: "ths", domains: ["10jqka.com.cn"] },
];

/** 原文里的这些写法也算提到了对应公司。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [];
