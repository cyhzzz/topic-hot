// Topic Hot 前端：无框架单页应用，唯一数据源是 ./data/site.json（由采集管线生成、构建时拷入）。
// hash 路由：#/ 今日（最新日报）、#/report/{day} 某天日报、#/events 事件聚合、#/all 全部条目、#/about 关于。

const view = document.getElementById("view");
const nav = document.getElementById("nav");

const state = {
  data: null,
  loadError: null,
  all: { category: "", query: "", sort: "score" },
};

const CATEGORY_FALLBACK = [{ key: "other", label: "其他", section: "其他" }];

async function loadData() {
  try {
    const res = await fetch("./data/site.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch (error) {
    state.loadError = error instanceof Error ? error.message : String(error);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function categoryLabel(key) {
  const list = state.data?.categories ?? CATEGORY_FALLBACK;
  return list.find((category) => category.key === key)?.label ?? "其他";
}

function fmtTime(iso) {
  const time = Date.parse(iso ?? "");
  if (!Number.isFinite(time)) return "";
  return new Date(time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function chip(text, ghost = false) {
  return `<span class="chip${ghost ? " chip-ghost" : ""}">${escapeHtml(text)}</span>`;
}

function itemTags(item) {
  const parts = [];
  for (const tag of (item.tags ?? []).slice(1)) parts.push(`<span class="tag">#${escapeHtml(tag)}</span>`);
  for (const tag of item.entityTags ?? []) parts.push(`<span class="tag">@${escapeHtml(tag)}</span>`);
  return parts.join("");
}

function itemCard(item) {
  const summary = item.summary ? `<p class="item-summary">${escapeHtml(item.summary)}</p>` : "";
  return `
    <article class="card">
      <div class="item-top">${chip(categoryLabel(item.category))}${item.score ? `<span class="score">${escapeHtml(item.score)}</span>` : ""}</div>
      <h3 class="item-title"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3>
      ${summary}
      <div class="item-meta">
        <span>${escapeHtml(item.sourceName)}</span>
        ${item.publishedAt ? `<span>${escapeHtml(fmtTime(item.publishedAt))}</span>` : ""}
        ${itemTags(item)}
      </div>
    </article>`;
}

// ── 视图：今日 / 日报 ────────────────────────────────────────────────────────────────────

function reportHtml(report, isLatest) {
  const lead = report.lead
    ? `
    <section class="lead-card">
      <h2>${escapeHtml(report.lead.title)}</h2>
      <p>${escapeHtml(report.lead.paragraph)}</p>
      ${report.lead.highlights.length > 0 ? `<ul>${report.lead.highlights.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : ""}
    </section>`
    : "";
  const sections = report.sections
    .map(
      (section) => `
    <section class="section">
      <h3 class="section-title">${escapeHtml(section.title)}<span class="section-count">${section.items.length}</span></h3>
      <div class="cards">${section.items.map(itemCard).join("")}</div>
    </section>`,
    )
    .join("");
  const empty = report.sections.length === 0 ? `<div class="state">这一天没有精选内容。</div>` : "";
  return `
    ${lead}
    ${sections}
    ${empty}
    <p class="day-meta">
      ${isLatest ? "今日" : escapeHtml(report.day)} 共 ${report.stats.total} 条，精选 ${report.stats.selected} 条 ·
      生成于 ${escapeHtml(fmtTime(report.generatedAt))}
    </p>`;
}

function dayTabsHtml(reports, activeDay) {
  if (reports.length <= 1) return "";
  const tabs = reports
    .map((report) => `<a href="#/report/${report.day}" class="${report.day === activeDay ? "active" : ""}">${escapeHtml(report.day)}</a>`)
    .join("");
  return `<div class="day-tabs">${tabs}</div>`;
}

function todayView() {
  const reports = state.data.reports ?? [];
  if (reports.length === 0) return `<div class="state">还没有日报，等第一轮采集完成后回来看看。</div>`;
  const report = reports.find((item) => item.day === state.data.today) ?? reports[0];
  return `${dayTabsHtml(reports, report.day)}${reportHtml(report, report.day === (state.data.today || reports[0].day))}`;
}

function reportView(day) {
  const reports = state.data.reports ?? [];
  const report = reports.find((item) => item.day === day);
  if (!report) return `<div class="state">没有这一天的日报，<a href="#/">回到今日</a>。</div>`;
  return `${dayTabsHtml(reports, report.day)}${reportHtml(report, false)}`;
}

// ── 视图：事件聚合 ──────────────────────────────────────────────────────────────────────

function eventsView() {
  const groups = [...(state.data.groups ?? [])].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  if (groups.length === 0) return `<div class="state">暂时没有聚合出事件，多条信源报道同一件事时会出现在这里。</div>`;
  const cards = groups
    .map(
      (group) => `
    <article class="card">
      <div class="item-top">${chip(categoryLabel(group.category))}${chip(`报道 ${group.itemIds.length}`, true)}</div>
      <h3 class="group-title">${escapeHtml(group.title)}</h3>
      <div class="item-meta">${(group.tags ?? []).map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join("")}</div>
      <ul class="group-items">
        ${group.itemIds
          .map((id) => state.data.items.find((item) => item.id === id))
          .filter((item) => item)
          .map(
            (item) => `
        <li><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a><span class="src">${escapeHtml(item.sourceName)}</span></li>`,
          )
          .join("")}
      </ul>
    </article>`,
    )
    .join("");
  return `<section class="section"><div class="cards">${cards}</div></section>`;
}

// ── 视图：全部条目 ──────────────────────────────────────────────────────────────────────

function filteredItems() {
  const { category, query, sort } = state.all;
  const needle = query.trim().toLowerCase();
  let items = state.data.items ?? [];
  if (category) {
    items = items.filter((item) => item.category === category);
  }
  if (needle) {
    items = items.filter((item) =>
      [item.title, item.summary, item.sourceName, ...(item.tags ?? []), ...(item.entityTags ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }
  if (sort === "time") {
    items = [...items].sort((a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? ""));
  }
  return items;
}

function allListHtml() {
  const items = filteredItems();
  if (items.length === 0) return `<div class="state">没有匹配的条目。</div>`;
  return `<div class="cards">${items.map(itemCard).join("")}</div>`;
}

function allView() {
  const categories = state.data.categories ?? CATEGORY_FALLBACK;
  const chips = [
    `<button data-cat="" class="${state.all.category === "" ? "active" : ""}">全部</button>`,
    ...categories.map(
      (category) =>
        `<button data-cat="${escapeHtml(category.key)}" class="${state.all.category === category.key ? "active" : ""}">${escapeHtml(category.label)}</button>`,
    ),
  ].join("");
  return `
    <div class="toolbar">
      <input id="search" type="search" placeholder="搜索标题、摘要、标签、来源…" value="${escapeHtml(state.all.query)}" />
      <select id="sort">
        <option value="score" ${state.all.sort === "score" ? "selected" : ""}>按分数</option>
        <option value="time" ${state.all.sort === "time" ? "selected" : ""}>按时间</option>
      </select>
    </div>
    <div class="chip-row">${chips}</div>
    <div id="all-list">${allListHtml()}</div>`;
}

function bindAllView() {
  const search = document.getElementById("search");
  const sort = document.getElementById("sort");
  let timer;
  search?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.all.query = search.value;
      const list = document.getElementById("all-list");
      if (list) list.innerHTML = allListHtml();
    }, 150);
  });
  sort?.addEventListener("change", () => {
    state.all.sort = sort.value;
    const list = document.getElementById("all-list");
    if (list) list.innerHTML = allListHtml();
  });
  for (const button of view.querySelectorAll(".chip-row button")) {
    button.addEventListener("click", () => {
      state.all.category = button.dataset.cat ?? "";
      for (const other of view.querySelectorAll(".chip-row button")) other.classList.toggle("active", other === button);
      const list = document.getElementById("all-list");
      if (list) list.innerHTML = allListHtml();
    });
  }
}

// ── 视图：关于 ──────────────────────────────────────────────────────────────────────────

function aboutView() {
  const about = state.data?.site?.about;
  if (!about) return `<div class="state">站点文案尚未生成，先跑一轮采集。</div>`;
  const mail = about.contactEmail
    ? `<a href="mailto:${escapeHtml(about.contactEmail)}">${escapeHtml(about.contactEmail)}</a>。`
    : "GitHub 仓库的 Issue 区。";
  const steps = [
    ["采集", about.steps.collect],
    ["归组", about.steps.store],
    ["筛选", about.steps.select],
    ["发布", about.steps.publish],
  ];
  return `
    <div class="prose">
      <h1 class="about-title">${escapeHtml(about.headline[0])}<br /><em>${escapeHtml(about.headline[1])}</em></h1>
      <p>${escapeHtml(about.lead)}</p>
      <h2>如何运转</h2>
      <ul>${steps.map(([label, text]) => `<li><strong>${escapeHtml(label)}：</strong>${escapeHtml(text)}</li>`).join("")}</ul>
      <h2>版权与下架</h2>
      <p>${escapeHtml(about.copyright)}${mail}</p>
    </div>`;
}

// ── 站点身份：页头、标题、页脚跟着 site.json 走 ─────────────────────────────────────────

function applyIdentity() {
  const site = state.data?.site;
  if (!site) return;
  if (site.homeTitle) document.title = site.homeTitle;
  const brand = document.querySelector(".brand");
  if (brand && site.name) brand.textContent = site.name;
  const tagline = document.querySelector(".tagline");
  if (tagline && site.tagline) tagline.textContent = site.tagline;
  const meta = document.querySelector('meta[name="description"]');
  if (meta && site.description) meta.setAttribute("content", site.description);
  const foot = document.querySelector(".site-foot .wrap");
  if (foot && site.footerNote) foot.textContent = site.footerNote;
}

// ── 路由 ────────────────────────────────────────────────────────────────────────────────

function currentRoute() {
  const path = location.hash.replace(/^#\/?/, "");
  return path.split("/").filter(Boolean);
}

function render() {
  if (state.loadError) {
    view.innerHTML = `<div class="state state-error">数据加载失败（${escapeHtml(state.loadError)}）。<br />请确认站点已完成首次采集与部署。</div>`;
    return;
  }
  if (!state.data) {
    view.innerHTML = `<div class="state state-loading">正在加载数据…</div>`;
    return;
  }
  const [head, arg] = currentRoute();
  let html;
  switch (head) {
    case undefined:
      html = todayView();
      break;
    case "report":
      html = reportView(arg ?? "");
      break;
    case "events":
      html = eventsView();
      break;
    case "all":
      html = allView();
      break;
    case "about":
      html = aboutView();
      break;
    default:
      html = `<div class="state">页面不存在，<a href="#/">回到今日</a>。</div>`;
  }
  view.innerHTML = html;
  if (head === "all") bindAllView();
  for (const link of nav.querySelectorAll("a")) {
    link.classList.toggle("active", (link.dataset.route ?? "") === (head ?? ""));
  }
  const site = state.data.site;
  document.title =
    head === "about"
      ? `关于 · ${site.name}`
      : head === "events"
        ? `事件 · ${site.name}`
        : head === "all"
          ? `全部条目 · ${site.name}`
          : site.homeTitle;
}

window.addEventListener("hashchange", render);

await loadData();
applyIdentity();
render();
