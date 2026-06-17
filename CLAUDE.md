# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome 拡張（Manifest V3）、拡張名 **tabularize**。閲覧履歴のドメイン別集計とタブグループ化を行う。実装の仕様は `DESIGN.md` が正典。

**ディレクトリ構成（予定）:**

```
src/
├── manifest.json
├── background.js   # service worker
├── sidepanel.html
├── sidepanel.css
└── sidepanel.js
```

## Development Workflow

ビルドツールなし。変更後は `chrome://extensions` の「更新」ボタンで再読み込みする。

- デバッグ: background.js は `chrome://extensions` の「Service Worker」リンクから DevTools を開く。sidepanel.js はサイドパネルを右クリック → 「検証」。

## Tech Stack

- Vanilla JavaScript（フレームワーク・バンドラー不使用）
- Plain CSS（プリプロセッサ不使用）
- Chrome APIs: `chrome.history`, `chrome.tabs`, `chrome.tabGroups`, `chrome.storage`, `chrome.alarms`, `chrome.sidePanel`

## Code Style

**Biome** を使用（lint + format）。

```bash
npm run lint      # チェックのみ
npm run format    # 自動修正
```

- インデント: スペース 2 つ
- セミコロン: あり

## JSDoc

関数・クラスには JSDoc コメントを書く。

```js
/**
 * @param {string} domain
 * @returns {chrome.tabs.Tab[]}
 */
function getTabsByDomain(domain) { ... }
```
