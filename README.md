```
    ╔══════╗ ╔══════╗ ╔══════╗         ╔══════╗ ╔══════╗
    ║github║ ║  yt  ║ ║ docs ║   ···   ║slack ║ ║figma ║
╔═══╩══════╩═╩══════╩═╩══════╩═════════╩══════╩═╩══════╩═══════════╗
║                                                                   ║
║  ████████╗ █████╗ ██████╗ ██╗   ██╗██╗      █████╗ ██████╗       ║
║     ██╔══╝██╔══██╗██╔══██╗██║   ██║██║     ██╔══██╗██╔══██╗      ║
║     ██║   ███████║██████╔╝██║   ██║██║     ███████║██████╔╝      ║
║     ██║   ██╔══██║██╔══██╗██║   ██║██║     ██╔══██║██╔══██╗      ║
║     ██║   ██║  ██║██████╔╝╚██████╔╝███████╗██║  ██║██║  ██║      ║
║     ╚═╝   ╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝      ║
║                                                                   ║
║       ██╗███████╗███████╗                                         ║
║       ██║╚══███╔╝██╔════╝                                         ║
║       ██║  ███╔╝ █████╗                                           ║
║       ██║ ███╔╝  ██╔══╝                                           ║
║       ██║███████╗███████╗                                         ║
║       ╚═╝╚══════╝╚══════╝                                         ║
║                                                                   ║
║         Tame your tabs. Master your history.                      ║
╚═══════════════════════════════════════════════════════════════════╝
```

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" />
  <img src="https://img.shields.io/badge/Vanilla_JS-no_framework-F7DF1E?style=flat-square&logo=javascript&logoColor=black" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" />
</p>

---

## What is this?

**tabularize** is a Chrome extension that brings order to your cluttered browser.  
It automatically aggregates 90 days of browsing history so you can see your most-visited sites at a glance — and groups your open tabs by domain with a single click.

---

## Features

### 📊 URL & Domain Analytics
- Automatically fetches and aggregates **the last 90 days of browsing history**
- **URL list**: shows page title, URL, and visit count — sortable by visit count or last visit date
- **Domain list**: shows total visit count per domain
- Incremental search across URLs, titles, and domain names
- Click any row to focus the existing tab or open a new one

### 🗂 Tab Grouping
- **Group by domain**: collect all tabs of a domain into a group with one click
- **Group all tabs**: organize every open tab by domain at once — all groups except the active one are automatically collapsed
- **Auto-group**: mark a domain to be grouped automatically whenever a new tab opens for it
- **Ungroup**: dissolve a group for any domain

### ↕️ Tab Auto-Sort
- Toggle **alphabetical tab sorting** on or off
- When enabled, tabs are automatically re-sorted whenever a new tab finishes loading (pinned tabs are excluded)

### 🚫 Domain Exclusion
- Exclude any domain from tracking — existing entries for that domain are removed immediately

---

## Installation

tabularize is not yet on the Chrome Web Store. Install it manually in developer mode:

```bash
git clone https://github.com/satou30/tabularize.git
cd tabularize
```

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top-right toggle)
3. Click **"Load unpacked"**
4. Select the **`src/`** folder inside the cloned repository

---

## Usage

1. Click the tabularize icon in the Chrome toolbar to open the side panel
2. Browse the **URL list** to see your most-visited pages — click any row to jump to it
3. In the **Domain list**, hit **"Group"** to collect all tabs of that domain in one place
4. Toggle **"Auto▶"** on a domain to have its tabs grouped automatically from now on
5. Enable **"Sort tabs"** in the actions panel to keep all tabs in alphabetical order at all times

---

## Permissions

| Permission | Purpose |
|---|---|
| `history` | Read and aggregate browsing history |
| `tabs` | Query and move tabs |
| `tabGroups` | Create, update, and dissolve tab groups |
| `storage` | Persist aggregated data locally |
| `alarms` | Run the 90-day cleanup on a daily schedule |
| `sidePanel` | Render the side panel UI |

> No `host_permissions` are required — the `history` permission provides full-URL access through the History API.

---

## Tech Stack

- **Vanilla JavaScript** — no framework, no bundler
- **Plain CSS** — no preprocessor
- **[Biome](https://biomejs.dev/)** — lint & format
- **Chrome Extension APIs** — `chrome.history`, `chrome.tabs`, `chrome.tabGroups`, `chrome.storage`, `chrome.alarms`, `chrome.sidePanel`

---

## Development

```bash
npm install       # install Biome
npm run lint      # lint check
npm run format    # auto-fix formatting
```

After any change, reload the extension at `chrome://extensions` by clicking the refresh icon.

- **Debug background.js**: `chrome://extensions` → click the "Service Worker" link → DevTools opens
- **Debug the side panel**: right-click anywhere in the side panel → "Inspect"

---

## License

[MIT](LICENSE)
