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
  list.innerHTML =
    entries
      .slice(0, urlRenderLimit)
      .map(
        ([url, e]) => `
      <li class="item--url" data-url="${esc(url)}" tabindex="0">
        <span class="item__title" title="${esc(url)}">${esc(e.title || url)}</span>
        <span class="item__url">${esc(url)}</span>
        <span class="item__count">${t("visitCount", [String(e.count)])}</span>
      </li>`,
      )
      .join("") +
    (hasMore ? '<li id="url-sentinel" aria-hidden="true"></li>' : "");

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
  document.getElementById("sort-toggle").textContent =
    sortBy === "count" ? t("sortByCount") : t("sortByLastVisit");
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

/** @param {string} text */
function showError(text) {
  const el = document.getElementById("error-message");
  el.textContent = text;
  el.hidden = false;
  setTimeout(() => {
    el.hidden = true;
  }, 5000);
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function setupEvents() {
  // URL search
  document.getElementById("url-search").addEventListener("input", (e) => {
    urlFilter = e.target.value;
    urlRenderLimit = URL_BATCH;
    renderUrlList();
  });

  // Sort toggle (by count / lastVisit)
  document.getElementById("sort-toggle").addEventListener("click", () => {
    sortBy = sortBy === "count" ? "lastVisit" : "count";
    urlRenderLimit = URL_BATCH;
    updateSortLabel();
    renderUrlList();
  });

  // Domain search
  document.getElementById("domain-search").addEventListener("input", (e) => {
    domainFilter = e.target.value;
    renderDomainList();
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
    if (changes.urlEntries || changes.excludedDomains) renderAll();
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
