// 站点身份和读者看得到的文案。换主题时，先改这个文件。
// 网页和采集管线都读它；改完推上 GitHub，Pages 重新部署即生效。
// 域名不在这里：部署时用环境变量 SITE_URL 设置（GitHub Actions 自动注入）。

export const SITE = {
  /** 站名：导航、页面标题、RSS 都用它。 */
  name: "Topic Hot",
  /**
   * 行业词：拼进默认说法里，比如“AI 日报”“AI 动态”。
   * 改成“法律”“HR”“黄金”之类，页面上就会变成“法律日报”“法律动态”。
   */
  subject: "AI",
  /** 首页的完整标题（浏览器标签、搜索结果）。 */
  homeTitle: "Topic Hot — AI 行业动态 · 每日精选与日报",
  /** 一句话介绍：搜索引擎、分享卡片、RSS 会用。 */
  description: "自动盯住一批行业信源，打分、摘要、把同一件事的多篇报道归到一起，每小时更新，每天出一份日报。",
  /** 页头的一行小字。 */
  tagline: "值得关注的 AI 动态",
  /** 界面语言（HTML lang、og:locale）。 */
  locale: "zh-CN",
  /** 默认域名，只在没设置 SITE_URL 时使用（GitHub Pages 项目页路径）。 */
  defaultUrl: "https://cyhzzz.github.io/topic-hot",
  /** 对外联系邮箱（选填）：关于页会写。 */
  contactEmail: null as string | null,
  /** 页脚的一行小字（选填）。 */
  footerNote: null as string | null,
  /** 中国大陆网站的 ICP 备案号（选填），填了就显示在页脚。 */
  icp: null as string | null,
  /** 结构化数据里的网站运营者（搜索引擎用）。 */
  organization: {
    name: "Topic Hot",
    /** 创始人（选填）：{ name, url, description }。 */
    founder: null as null | { name: string; url?: string; description?: string },
  },
  /** 抓取信源时报上的名字（User-Agent 里用），不要冒用别的站。 */
  crawlerName: "TopicHotBot",
} as const;

/** 关于页的文案。数字（信源数、收录数）来自 data/meta.json，不用写在这里。 */
export const ABOUT = {
  kicker: `关于 ${SITE.name}`,
  /** 大标题：第一行正常颜色，第二行强调色。 */
  headline: ["AI 圈每天都有新动静，", "值得看的，只有几条。"] as [string, string],
  /** 标题下面的一段话。{sources} 会换成实际的信源数。 */
  lead: `${SITE.name} 替你盯着 {sources} 个信源：抓取、归并、打分、精选，每小时更新一次，每天出一份日报。免费，不用注册。`,
  /** 关于页的四个环节。 */
  steps: {
    collect: "官方博客、媒体和研究机构的订阅源都在看；GitHub Actions 每小时自动采集一轮。",
    store: "抓到的内容按同一件事归到一起，只保留摘要和原文链接，数据以 JSON 形式存在仓库里。",
    select: "按注意力分筛选（有模型用模型打分，没模型自动降级为规则打分），营销稿和重复转发进不来。",
    publish: "每小时发布一次更新，每天生成一份日报，静态部署在 GitHub Pages 上。",
  },
  /** 作者块（选填），null 就不显示。 */
  maker: null as null | {
    name: string;
    greeting: string[];
    link?: { title: string; note: string; url: string };
  },
  /** 页面底部的版权与下架说明。 */
  copyright: `${SITE.name} 是聚合摘要和阅读索引，原文版权归各来源所有。如果你是来源方，希望更正、下架或调整展示方式，可以通过`,
} as const;

/** “AI 日报”这类说法：行业词和名词之间，英文词加空格，中文词不加。 */
export function withSubject(noun: string): string {
  return /[A-Za-z0-9]$/.test(SITE.subject) ? `${SITE.subject} ${noun}` : `${SITE.subject}${noun}`;
}
