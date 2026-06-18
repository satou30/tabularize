// ── i18n ──────────────────────────────────────────────────────────────────────

/**
 * @param {string} key
 * @param {string[]} [subs]
 * @returns {string}
 */
function t(key, subs) {
  return chrome.i18n.getMessage(key, subs) || key;
}

function applyI18n() {
  document.documentElement.lang = chrome.i18n.getUILanguage().split("-")[0];
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
}

// ── State ─────────────────────────────────────────────────────────────────────

/** @type {Record<string, { count: number; title: string; lastVisitTime: number }>} */
let urlEntries = {};

/** @type {string[]} */
let excludedDomains = [];

/** @type {string[]} */
let autoGroupDomains = [];

let sortTabsEnabled = false;

/** @type {"count" | "lastVisit"} */
let sortBy = "count";

let urlFilter = "";
let domainFilter = "";

let urlRenderLimit = 100;
const URL_BATCH = 100;
/** @type {IntersectionObserver | null} */
let urlSentinelObserver = null;

// ── Data ──────────────────────────────────────────────────────────────────────

/** @returns {Promise<void>} */
async function loadData() {
  const result = await chrome.storage.local.get([
    "urlEntries",
    "excludedDomains",
    "autoGroupDomains",
    "sortTabsEnabled",
  ]);
  urlEntries = result.urlEntries ?? {};
  excludedDomains = result.excludedDomains ?? [];
  autoGroupDomains = result.autoGroupDomains ?? [];
  sortTabsEnabled = result.sortTabsEnabled ?? false;
}

/**
 * @returns {Map<string, { count: number; lastVisitTime: number }>}
 */
function computeDomains() {
  /** @type {Map<string, { count: number; lastVisitTime: number }>} */
  const map = new Map();
  for (const [url, entry] of Object.entries(urlEntries)) {
    try {
      const { hostname } = new URL(url);
      if (!hostname) continue;
      const existing = map.get(hostname);
      if (existing) {
        existing.count += entry.count;
        existing.lastVisitTime = Math.max(
          existing.lastVisitTime,
          entry.lastVisitTime,
        );
      } else {
        map.set(hostname, {
          count: entry.count,
          lastVisitTime: entry.lastVisitTime,
        });
      }
    } catch {
      // skip invalid URLs
    }
  }
  return map;
}

// ── Date utilities ────────────────────────────────────────────────────────────

/**
 * @param {number} ts  lastVisitTime (ms)
 * @returns {number}   今日からの日数差（今日=0, 昨日=1, ...）
 */
function daysDiff(ts) {
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const d = new Date(ts);
  const itemMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round(
    (todayMidnight.getTime() - itemMidnight.getTime()) / 86400000,
  );
}

/**
 * HH:MM 形式の時刻文字列
 * @param {number} ts
 * @returns {string}  例: "13:45"
 */
function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString(chrome.i18n.getUILanguage(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Google favicon サービス URL を返す
 * @param {string} url
 * @returns {string}
 */
function getFaviconUrl(url) {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=16`;
  } catch {
    return "";
  }
}

/**
 * 日付グループ見出しテキスト（今日/昨日は日付も併記）
 * @param {number} ts
 * @returns {string}  例: "今日 2026/06/18 (水)", "昨日 2026/06/17 (火)", "2026/06/16 (月)"
 */
function formatGroupHeading(ts) {
  const diff = daysDiff(ts);
  const dateStr = new Date(ts).toLocaleDateString(chrome.i18n.getUILanguage(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  if (diff === 0) return `${t("dateToday")} ${dateStr}`;
  if (diff === 1) return `${t("dateYesterday")} ${dateStr}`;
  return dateStr;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/** @returns {[string, { count: number; title: string; lastVisitTime: number }][]} */
function filteredSortedUrls() {
  let entries = Object.entries(urlEntries);

  if (urlFilter) {
    const q = urlFilter.toLowerCase();
    entries = entries.filter(
      ([url, e]) =>
        url.toLowerCase().includes(q) || e.title.toLowerCase().includes(q),
    );
  }

  entries.sort(([, a], [, b]) =>
    sortBy === "count" ? b.count - a.count : b.lastVisitTime - a.lastVisitTime,
  );

  return entries;
}

/** @param {string} s */
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string} url
 * @param {{ count: number; title: string; lastVisitTime: number }} e
 * @returns {string}
 */
/**
 * @param {string} url
 * @param {{ count: number; title: string; lastVisitTime: number }} e
 * @param {boolean} showTime 最終訪問日順のときだけ時刻を表示する
 * @returns {string}
 */
function itemHtml(url, e, showTime) {
  const cls = showTime ? "item--url" : "item--url item--url--no-time";
  const timeHtml = showTime
    ? `<span class="item__time">${esc(formatTime(e.lastVisitTime))}</span>`
    : "";
  return `<li class="${cls}" data-url="${esc(url)}" tabindex="0">${timeHtml}<img class="item__favicon" src="${esc(getFaviconUrl(url))}" alt="" aria-hidden="true" width="16" height="16" onerror="this.style.visibility='hidden'"><span class="item__title" title="${esc(e.title || url)}">${esc(e.title || url)}</span><span class="item__count">${t("visitCount", [String(e.count)])}</span><span class="item__url">${esc(url)}</span></li>`;
}

function renderUrlList() {
  if (urlSentinelObserver) {
    urlSentinelObserver.disconnect();
    urlSentinelObserver = null;
  }

  const list = document.getElementById("url-list");
  const entries = filteredSortedUrls();

  if (entries.length === 0) {
    list.innerHTML = `<li class="list__empty">${t("noData")}</li>`;
    return;
  }

  const hasMore = entries.length > urlRenderLimit;
  const slice = entries.slice(0, urlRenderLimit);
  let html = "";

  if (sortBy === "lastVisit") {
    let lastKey = null;
    for (const [url, e] of slice) {
      const d = new Date(e.lastVisitTime);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (key !== lastKey) {
        lastKey = key;
        html += `<li class="list__date-heading" aria-hidden="true">${esc(formatGroupHeading(e.lastVisitTime))}</li>`;
      }
      html += itemHtml(url, e, true);
    }
  } else {
    for (const [url, e] of slice) html += itemHtml(url, e, false);
  }

  list.innerHTML =
    html + (hasMore ? '<li id="url-sentinel" aria-hidden="true"></li>' : "");

  if (hasMore) {
    urlSentinelObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          urlRenderLimit += URL_BATCH;
          renderUrlList();
        }
      },
      { root: list, threshold: 0 },
    );
    urlSentinelObserver.observe(document.getElementById("url-sentinel"));
  }
}

function renderDomainList() {
  const list = document.getElementById("domain-list");
  let entries = [...computeDomains().entries()];

  if (domainFilter) {
    const q = domainFilter.toLowerCase();
    entries = entries.filter(([d]) => d.toLowerCase().includes(q));
  }

  entries.sort(([, a], [, b]) => b.count - a.count);

  if (entries.length === 0) {
    list.innerHTML = `<li class="list__empty">${t("noData")}</li>`;
    return;
  }

  list.innerHTML = entries
    .map(([domain, data]) => {
      const isAuto = autoGroupDomains.includes(domain);
      return `
      <li class="item--domain">
        <span class="item__domain" title="${esc(domain)}">${esc(domain)}</span>
        <span class="item__count">${t("visitCount", [String(data.count)])}</span>
        <div class="item__actions">
          <button type="button" class="btn btn--group"   data-action="group"             data-domain="${esc(domain)}">${t("groupBtn")}</button>
          <button type="button" class="btn btn--ungroup" data-action="ungroup"           data-domain="${esc(domain)}">${t("ungroupBtn")}</button>
          <button type="button" class="btn btn--auto-group ${isAuto ? "is-active" : ""}" data-action="toggle-auto-group" data-domain="${esc(domain)}" title="${t(isAuto ? "autoGroupOn" : "autoGroupOff")}">${t(isAuto ? "autoGroupOn" : "autoGroupOff")}</button>
          <button type="button" class="btn btn--exclude" data-action="exclude"           data-domain="${esc(domain)}">${t("excludeBtn")}</button>
        </div>
      </li>`;
    })
    .join("");
}

function renderAll() {
  renderUrlList();
  renderDomainList();
}

function updateSortLabel() {
  const btn = document.getElementById("sort-toggle");
  btn.textContent =
    sortBy === "count" ? t("sortByCount") : t("sortByLastVisit");
  btn.classList.toggle("is-active", sortBy === "lastVisit");
}

function updateSortTabsBtn() {
  const btn = document.getElementById("sort-tabs-toggle");
  btn.textContent = t(sortTabsEnabled ? "sortTabsOn" : "sortTabsOff");
  btn.classList.toggle("is-active", sortTabsEnabled);
}

// ── Actions ───────────────────────────────────────────────────────────────────

/**
 * @param {string} url
 * @returns {Promise<void>}
 */
async function openOrFocusTab(url) {
  const all = await chrome.tabs.query({});
  const existing = all.find((t) => t.url === url);
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

/**
 * @param {string} domain
 * @returns {Promise<void>}
 */
async function excludeDomain(domain) {
  if (!excludedDomains.includes(domain)) {
    excludedDomains = [...excludedDomains, domain];
  }
  for (const url of Object.keys(urlEntries)) {
    try {
      if (new URL(url).hostname === domain) delete urlEntries[url];
    } catch {
      // skip
    }
  }
  await chrome.storage.local.set({ urlEntries, excludedDomains });
  renderAll();
}

/**
 * @param {string} domain
 * @returns {Promise<void>}
 */
async function toggleAutoGroup(domain) {
  if (autoGroupDomains.includes(domain)) {
    autoGroupDomains = autoGroupDomains.filter((d) => d !== domain);
  } else {
    autoGroupDomains = [...autoGroupDomains, domain];
  }
  await chrome.storage.local.set({ autoGroupDomains });
  renderDomainList();
}

/**
 * @param {{ type: string; domain?: string }} msg
 * @returns {Promise<{ success?: true; error?: string }>}
 */
async function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

// タイマー ID を保持して前回のタイマーをクリアし、重複 setTimeout を防ぐ
/** @type {ReturnType<typeof setTimeout> | null} */
let noticeTimer = null;

/**
 * @param {string} text
 * @param {"error" | "info"} [kind]
 */
function showNotice(text, kind = "error") {
  const el = document.getElementById("error-message");
  el.textContent = text;
  el.classList.toggle("error-message--info", kind === "info");
  el.hidden = false;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    noticeTimer = null;
    el.hidden = true;
  }, 5000);
}

/** @param {string} text */
function showError(text) {
  showNotice(text, "error");
}

// ── Event wiring ──────────────────────────────────────────────────────────────

/**
 * storage.onChanged からの renderAll 連打を抑制するデバウンス
 * @type {ReturnType<typeof setTimeout> | null}
 */
let renderDebounceTimer = null;

function scheduledRenderAll() {
  if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
  renderDebounceTimer = setTimeout(() => {
    renderDebounceTimer = null;
    renderAll();
  }, 100);
}

function setupEvents() {
  // URL search (150ms デバウンスで連打を抑制)
  let urlSearchTimer = null;
  document.getElementById("url-search").addEventListener("input", (e) => {
    if (urlSearchTimer) clearTimeout(urlSearchTimer);
    urlSearchTimer = setTimeout(() => {
      urlSearchTimer = null;
      urlFilter = e.target.value;
      urlRenderLimit = URL_BATCH;
      renderUrlList();
    }, 150);
  });

  // Sort toggle (by count / lastVisit)
  document.getElementById("sort-toggle").addEventListener("click", () => {
    sortBy = sortBy === "count" ? "lastVisit" : "count";
    urlRenderLimit = URL_BATCH;
    updateSortLabel();
    renderUrlList();
  });

  // Domain search (150ms デバウンス)
  let domainSearchTimer = null;
  document.getElementById("domain-search").addEventListener("input", (e) => {
    if (domainSearchTimer) clearTimeout(domainSearchTimer);
    domainSearchTimer = setTimeout(() => {
      domainSearchTimer = null;
      domainFilter = e.target.value;
      renderDomainList();
    }, 150);
  });

  // URL list click (delegated)
  document.getElementById("url-list").addEventListener("click", (e) => {
    const item = e.target.closest("[data-url]");
    if (item) openOrFocusTab(item.dataset.url);
  });

  // Domain list click (delegated)
  document
    .getElementById("domain-list")
    .addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, domain } = btn.dataset;

      if (action === "group") {
        const res = await send({ type: "GROUP_DOMAIN", domain });
        if (res?.error) showError(t("errGroupFailed", [res.error]));
      } else if (action === "ungroup") {
        const res = await send({ type: "UNGROUP_DOMAIN", domain });
        if (res?.error) showError(t("errUngroupFailed", [res.error]));
      } else if (action === "toggle-auto-group") {
        await toggleAutoGroup(domain);
      } else if (action === "exclude") {
        await excludeDomain(domain);
      }
    });

  // Group all
  document
    .getElementById("group-all-btn")
    .addEventListener("click", async () => {
      const res = await send({ type: "GROUP_ALL" });
      if (res?.error) showError(t("errGroupFailed", [res.error]));
    });

  // Sort tabs toggle
  document
    .getElementById("sort-tabs-toggle")
    .addEventListener("click", async () => {
      sortTabsEnabled = !sortTabsEnabled;
      await chrome.storage.local.set({ sortTabsEnabled });
      updateSortTabsBtn();
      if (sortTabsEnabled) {
        const res = await send({ type: "SORT_TABS" });
        if (res?.error) showError(t("errSortFailed", [res.error]));
      }
    });

  // Deduplicate tabs
  document
    .getElementById("dedup-tabs-btn")
    .addEventListener("click", async () => {
      const res = await send({ type: "DEDUP_TABS" });
      if (res?.error) {
        showError(t("errDedupFailed", [res.error]));
      } else if (res?.closed === 0) {
        showNotice(t("dedupNone"), "info");
      } else {
        showNotice(t("dedupSuccess", [String(res.closed)]), "info");
      }
    });

  // Reset
  document.getElementById("reset-btn").addEventListener("click", async () => {
    if (!confirm(t("confirmReset"))) return;
    const res = await send({ type: "RESET_DATA" });
    if (res?.error) {
      showError(t("errResetFailed", [res.error]));
    } else {
      await loadData();
      renderAll();
    }
  });

  // Sync UI when background updates storage
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.urlEntries) urlEntries = changes.urlEntries.newValue ?? {};
    if (changes.excludedDomains)
      excludedDomains = changes.excludedDomains.newValue ?? [];
    if (changes.autoGroupDomains)
      autoGroupDomains = changes.autoGroupDomains.newValue ?? [];
    if (changes.sortTabsEnabled) {
      sortTabsEnabled = changes.sortTabsEnabled.newValue ?? false;
      updateSortTabsBtn();
    }
    if (changes.urlEntries || changes.excludedDomains) scheduledRenderAll();
    else if (changes.autoGroupDomains) renderDomainList();
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  applyI18n();
  await loadData();
  setupEvents();
  updateSortLabel();
  updateSortTabsBtn();
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);
