const EXCLUDED_SCHEMES = ["chrome:", "about:", "file:", "chrome-extension:"];
const TAB_GROUP_COLORS = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];
const CLEANUP_ALARM = "cleanup90Days";
const HISTORY_DAYS = 90;

/**
 * @param {string | undefined} url
 * @param {string[]} excludedDomains
 * @returns {boolean}
 */
function isExcludedUrl(url, excludedDomains) {
  if (!url) return true;
  if (EXCLUDED_SCHEMES.some((s) => url.startsWith(s))) return true;
  try {
    const { hostname } = new URL(url);
    return excludedDomains.includes(hostname);
  } catch {
    return true;
  }
}

/**
 * @param {string} url
 * @returns {string | null}
 */
function getHostname(url) {
  try {
    const { hostname } = new URL(url);
    return hostname || null;
  } catch {
    return null;
  }
}

/** @returns {string} */
function randomColor() {
  return TAB_GROUP_COLORS[Math.floor(Math.random() * TAB_GROUP_COLORS.length)];
}

// ── History aggregation ───────────────────────────────────────────────────────

/** @returns {Promise<void>} */
async function buildHistoryEntries() {
  const startTime = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
  const items = await chrome.history.search({
    text: "",
    startTime,
    maxResults: 0,
  });
  const { excludedDomains = [] } =
    await chrome.storage.local.get("excludedDomains");

  /** @type {Record<string, { count: number; title: string; lastVisitTime: number }>} */
  const urlEntries = {};
  for (const item of items) {
    if (isExcludedUrl(item.url, excludedDomains)) continue;
    urlEntries[item.url] = {
      count: item.visitCount || 1,
      title: item.title || "",
      lastVisitTime: item.lastVisitTime || Date.now(),
    };
  }

  await chrome.storage.local.set({ urlEntries });
}

/** @returns {Promise<void>} */
async function runCleanup() {
  const cutoff = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
  const { urlEntries = {} } = await chrome.storage.local.get("urlEntries");

  let changed = false;
  for (const [url, entry] of Object.entries(urlEntries)) {
    if (entry.lastVisitTime < cutoff) {
      delete urlEntries[url];
      changed = true;
    }
  }
  if (changed) await chrome.storage.local.set({ urlEntries });
}

// ── Tab grouping ─────────────────────────────────────────────────────────────

/**
 * @param {string} domain
 * @param {number | null} [windowId]
 * @returns {Promise<void>}
 */
async function groupDomain(domain, windowId = null) {
  const targetWindowId =
    windowId ?? (await chrome.windows.getLastFocused({ populate: false })).id;

  const allTabs = await chrome.tabs.query({});
  const targetTabs = allTabs.filter(
    (tab) => tab.url && getHostname(tab.url) === domain,
  );
  if (targetTabs.length === 0) return;

  const tabIds = [];
  for (const tab of targetTabs) {
    if (tab.windowId !== targetWindowId) {
      await chrome.tabs.move(tab.id, { windowId: targetWindowId, index: -1 });
    }
    tabIds.push(tab.id);
  }

  const groups = await chrome.tabGroups.query({ windowId: targetWindowId });
  const existing = groups.find((g) => g.title === domain);

  if (existing) {
    await chrome.tabs.group({ tabIds, groupId: existing.id });
  } else {
    const groupId = await chrome.tabs.group({
      tabIds,
      createProperties: { windowId: targetWindowId },
    });
    await chrome.tabGroups.update(groupId, {
      title: domain,
      color: randomColor(),
    });
  }

  await chrome.windows.update(targetWindowId, { focused: true });
}

/** @returns {Promise<void>} */
async function groupAll() {
  const win = await chrome.windows.getLastFocused({ populate: false });
  const targetWindowId = win.id;
  const allTabs = await chrome.tabs.query({});

  /** @type {Map<string, chrome.tabs.Tab[]>} */
  const byDomain = new Map();
  for (const tab of allTabs) {
    if (!tab.url || EXCLUDED_SCHEMES.some((s) => tab.url.startsWith(s)))
      continue;
    const hostname = getHostname(tab.url);
    if (!hostname) continue;
    const list = byDomain.get(hostname) ?? [];
    list.push(tab);
    byDomain.set(hostname, list);
  }

  for (const [domain, tabs] of byDomain) {
    const tabIds = [];
    for (const tab of tabs) {
      if (tab.windowId !== targetWindowId) {
        await chrome.tabs.move(tab.id, { windowId: targetWindowId, index: -1 });
      }
      tabIds.push(tab.id);
    }

    const groups = await chrome.tabGroups.query({ windowId: targetWindowId });
    const existing = groups.find((g) => g.title === domain);

    if (existing) {
      await chrome.tabs.group({ tabIds, groupId: existing.id });
    } else {
      const groupId = await chrome.tabs.group({
        tabIds,
        createProperties: { windowId: targetWindowId },
      });
      await chrome.tabGroups.update(groupId, {
        title: domain,
        color: randomColor(),
      });
    }
  }

  // アクティブタブのグループだけ展開、それ以外を畳む
  const [activeTab] = await chrome.tabs.query({
    active: true,
    windowId: targetWindowId,
  });
  const activeGroupId =
    activeTab?.groupId ?? chrome.tabGroups.TAB_GROUP_ID_NONE;
  const allGroups = await chrome.tabGroups.query({ windowId: targetWindowId });
  await Promise.all(
    allGroups.map((g) =>
      chrome.tabGroups.update(g.id, {
        collapsed: g.id !== activeGroupId,
      }),
    ),
  );

  await chrome.windows.update(targetWindowId, { focused: true });
}

/**
 * @param {string} domain
 * @returns {Promise<void>}
 */
async function ungroupDomain(domain) {
  const windows = await chrome.windows.getAll({ populate: false });
  for (const win of windows) {
    const groups = await chrome.tabGroups.query({ windowId: win.id });
    const target = groups.find((g) => g.title === domain);
    if (!target) continue;
    const tabs = await chrome.tabs.query({ groupId: target.id });
    if (tabs.length > 0) {
      await chrome.tabs.ungroup(tabs.map((t) => t.id));
    }
  }
}

/**
 * Sort non-pinned tabs in a window alphabetically by title (then URL).
 * @param {number} windowId
 * @returns {Promise<void>}
 */
async function sortTabsInWindow(windowId) {
  const allTabs = await chrome.tabs.query({ windowId });
  const pinnedCount = allTabs.filter((t) => t.pinned).length;
  const nonPinned = allTabs.filter((t) => !t.pinned);

  nonPinned.sort((a, b) => {
    const ak = (a.title || a.url || "").toLowerCase();
    const bk = (b.title || b.url || "").toLowerCase();
    return ak.localeCompare(bk, "ja");
  });

  for (let i = 0; i < nonPinned.length; i++) {
    await chrome.tabs.move(nonPinned[i].id, { index: pinnedCount + i });
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true;
});

/**
 * @param {{ type: string; domain?: string }} message
 * @returns {Promise<{ success: true } | { error: string }>}
 */
async function handleMessage(message) {
  switch (message.type) {
    case "GROUP_DOMAIN":
      await groupDomain(message.domain);
      return { success: true };
    case "GROUP_ALL":
      await groupAll();
      return { success: true };
    case "UNGROUP_DOMAIN":
      await ungroupDomain(message.domain);
      return { success: true };
    case "SORT_TABS": {
      const win = await chrome.windows.getLastFocused({ populate: false });
      await sortTabsInWindow(win.id);
      return { success: true };
    }
    case "RESET_DATA":
      await chrome.storage.local.remove("urlEntries");
      await buildHistoryEntries();
      return { success: true };
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  const alarm = await chrome.alarms.get(CLEANUP_ALARM);
  if (!alarm) {
    await chrome.alarms.create(CLEANUP_ALARM, { periodInMinutes: 1440 });
  }

  if (details.reason === "install") {
    await buildHistoryEntries();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === CLEANUP_ALARM) await runCleanup();
});

chrome.history.onVisited.addListener(async (item) => {
  const { excludedDomains = [], urlEntries = {} } =
    await chrome.storage.local.get(["excludedDomains", "urlEntries"]);

  if (isExcludedUrl(item.url, excludedDomains)) return;

  const existing = urlEntries[item.url];
  urlEntries[item.url] = existing
    ? {
        ...existing,
        count: existing.count + 1,
        title: item.title || existing.title,
        lastVisitTime: item.lastVisitTime || Date.now(),
      }
    : {
        count: 1,
        title: item.title || "",
        lastVisitTime: item.lastVisitTime || Date.now(),
      };

  await chrome.storage.local.set({ urlEntries });
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url || EXCLUDED_SCHEMES.some((s) => tab.url.startsWith(s))) return;

  const { autoGroupDomains = [], sortTabsEnabled = false } =
    await chrome.storage.local.get(["autoGroupDomains", "sortTabsEnabled"]);

  const hostname = getHostname(tab.url);
  if (hostname && autoGroupDomains.includes(hostname)) {
    await groupDomain(hostname, tab.windowId);
  }

  if (sortTabsEnabled) {
    await sortTabsInWindow(tab.windowId);
  }
});

// アラームが SW 再起動で失われていた場合に備えて再登録する
(async () => {
  const alarm = await chrome.alarms.get(CLEANUP_ALARM);
  if (!alarm) {
    await chrome.alarms.create(CLEANUP_ALARM, { periodInMinutes: 1440 });
  }
})();
