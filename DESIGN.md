# 履歴集計＆タブグループ化 拡張機能 設計書

開発者モード専用の Chrome 拡張機能（Manifest V3）。閲覧履歴をURL/ドメイン単位で集計し、
よく見るページ・ドメインを表示する。さらに、開いているタブをドメイン単位で実際にグループ化する。

---

## 1. 技術スタック

- 言語: Vanilla JavaScript（フレームワーク不使用）
- スタイル: 生CSS（別ファイル）
- ビルドツール: 不使用。`chrome://extensions` の「パッケージ化されていない拡張機能を読み込む」でそのまま動作させる
- UI: サイドパネル（`chrome.sidePanel` API）。popup は使用しない
- アイコン: 用意しない（`manifest.json` に `icons` フィールドを含めない）

---

## 2. ファイル構成

```
history-aggregator/
├── manifest.json
├── background.js       # service worker
├── sidepanel.html
├── sidepanel.css
└── sidepanel.js
```

---

## 3. manifest.json

```json
{
  "manifest_version": 3,
  "name": "履歴集計＆タブグループ化",
  "version": "1.0.0",
  "description": "閲覧履歴をURL/ドメイン単位で集計し、よく見るページを表示。開いているタブをドメイン単位でグループ化します。",
  "permissions": [
    "history",
    "tabs",
    "tabGroups",
    "storage",
    "alarms",
    "sidePanel"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "action": {
    "default_title": "履歴集計"
  }
}
```

- `default_popup` は設定しない。ツールバーアイコンクリック時の挙動は `background.js` 内で
  `chrome.action.onClicked` をリスンし、`chrome.sidePanel.open()` 等でサイドパネルをトグル開閉する。
- `host_permissions` は使用しない（`history` permission により全URL対象でAPIが動作するため不要）。

---

## 4. データモデル（chrome.storage.local）

```js
{
  urlEntries: {
    "<url>": {
      count: number,          // 訪問回数（history.search の visitCount を初期値とし、
                               // 以後 onVisited ごとに +1 で累積加算）
      title: string,          // history が持つ title。なければ url を表示に使う
      lastVisitTime: number   // epoch ms。onVisited のたびに更新
    },
    ...
  },
  excludedDomains: [
    "example.com", ...        // 除外ドメイン一覧（hostname文字列の配列）
  ]
}
```

- ドメイン別集計（`domainCounts`）は永続化せず、`urlEntries` から都度算出する
  （`new URL(url).hostname` をキーに `count` を合算）。整合性を保証するため。
- ドメインの粒度は **hostname そのまま**（`sub.example.com` と `example.com` は別ドメインとして区別）。

### 除外対象スキーム

以下のスキームを持つURLは、初期集計・onVisited 双方で常に無視する。

- `chrome:`
- `about:`
- `file:`
- `chrome-extension:`

### 除外ドメイン

- `excludedDomains` に含まれるドメインは、上記スキーム除外と同様に集計対象から外す。
- ユーザーがドメインを除外リストに追加した瞬間、`urlEntries` から該当ドメインの既存エントリを
  即時削除する（過去データも残さない）。

---

## 5. 集計ロジック（background.js）

### 5.1 初期集計

- 拡張インストール時（`chrome.runtime.onInstalled`）に実行。
- `chrome.history.search({ text: "", startTime: <90日前>, maxResults: 0 })` で
  直近90日分の履歴を取得。
- 各履歴項目について、上記の除外スキーム／除外ドメインに該当しないものだけを
  `urlEntries` に登録する。`count` は `visitCount` を初期値とする。`title` と
  `lastVisitTime` も history の値をそのまま使う。

### 5.2 リアルタイム加算

- `chrome.history.onVisited` をリスンする。
- 訪問された URL が除外スキーム／除外ドメインに該当する場合は何もしない。
- 該当しない場合：
  - 既存エントリがあれば `count` を **+1 で累積加算**し、`title` と `lastVisitTime` を更新。
  - 既存エントリがなければ新規作成し、`count: 1` で登録。

### 5.3 90日クリーンアップ

- `chrome.alarms` を使い、1日1回（例: `periodInMinutes: 1440`）起動するアラームを登録する。
- アラーム発火時、`lastVisitTime` が現在時刻から90日より古い `urlEntries` を削除する。

### 5.4 手動リセット／再集計

- サイドパネルから `RESET_DATA` メッセージを受け取った場合：
  - `urlEntries` を完全に削除（`excludedDomains` は保持）。
  - 5.1 と同じ手順で `history.search` を実行し、データをスクラッチから再構築する。
- 確認ダイアログ（「本当にデータを消して再取得しますか？」）はサイドパネル側（UI側）で
  ユーザーに表示し、確認が取れた後にこのメッセージを送る。

---

## 6. タブグループ化（background.js が実処理を担当）

サイドパネル（sidepanel.js）は `chrome.runtime.sendMessage()` で background.js に処理を依頼し、
実際の `chrome.tabs` / `chrome.tabGroups` 操作はすべて background.js 側で行う
（サイドパネルが閉じられても処理が継続するようにするため）。

### 6.1 単一ドメインのグループ化（`GROUP_DOMAIN` メッセージ）

入力: 対象ドメイン（hostname文字列）

処理手順:

1. サイドパネルが開かれているウィンドウ（= 現在アクティブなウィンドウ）を集約先 `targetWindowId` とする。
2. `chrome.tabs.query({})` で全ウィンドウの全タブを取得し、`hostname` が対象ドメインと一致するタブを集める。
3. 各対象タブについて：
   - すでに `targetWindowId` に存在するタブは move 不要（そのまま）。
   - 別ウィンドウにあるタブは `chrome.tabs.move(tabId, { windowId: targetWindowId, index: -1 })` で移動。
   - **例外**: 現在フォーカス中のアクティブタブ自体が対象ドメインと一致する場合、そのタブは
     （すでに目的のウィンドウにいる前提で）move処理をスキップするが、後続のグループ化対象には含める。
4. `targetWindowId` 内に、グループ名が対象ドメイン名と一致する既存の `tabGroup` があるかを
   `chrome.tabGroups.query({ windowId: targetWindowId })` 等で確認する。
   - あれば、収集した対象タブを `chrome.tabs.group({ tabIds, groupId: <既存グループID> })` で
     そのグループに合流させる（新規グループは作らない）。
   - なければ、`chrome.tabs.group({ tabIds, createProperties: { windowId: targetWindowId } })` で
     新規グループを作成し、`chrome.tabGroups.update(groupId, { title: <ドメイン名>, color: <ランダム> })`
     を実行する。色は `chrome.tabGroups` がサポートする色一覧からランダムに1つ選ぶ。
5. 処理完了後、`chrome.windows.update(targetWindowId, { focused: true })` で集約先ウィンドウを
   アクティブ化してユーザーに見せる。
6. 失敗時は呼び出し元（sidepanel.js）にエラー内容を返し、UI側でエラーメッセージのみ表示する
   （リトライ等の救済処理は行わない）。

### 6.2 一括グループ化（`GROUP_ALL` メッセージ）

- 開いている全タブを対象に、6.1 と同様の手順で **全タブを現在のウィンドウに集約**した上で、
  ドメインごとに 6.1 のグループ化ロジック（既存グループへの合流判定含む）を適用する。
- 内部的には「対象タブ一覧 = 開いている全タブ」として 6.1 の手順を全ドメインに対して繰り返す形でよい。

### 6.3 グループ解除（`UNGROUP_DOMAIN` メッセージ）

- 対象ドメイン名のグループを探し、そのグループに属する全タブIDに対して
  `chrome.tabs.ungroup(tabIds)` を呼ぶだけ。タブを元のウィンドウに戻す等の追加処理は行わない。

---

## 7. サイドパネル UI（sidepanel.html / .css / .js）

### 7.1 構成要素

1. **URL一覧セクション**
   - 検索ボックス（インクリメンタル検索）
   - ソート切り替え（訪問数順 / 最終訪問日順）
   - 各行: タイトル（なければURL）、URL、訪問回数
   - 行クリック時の挙動: `chrome.tabs.query` で同じURLの既存タブを探し、あれば
     `chrome.tabs.update(tabId, { active: true })` + `chrome.windows.update` でフォーカス、
     なければ `chrome.tabs.create({ url })` で新規タブを開く。

2. **ドメイン一覧セクション**
   - 検索ボックス（インクリメンタル検索）
   - 各行: ドメイン名、合計訪問数、「タブをグループ化」ボタン、「除外」ボタン
   - 「タブをグループ化」→ background に `GROUP_DOMAIN` を送信
   - 「除外」→ `excludedDomains` にドメインを追加し、該当データを即時削除（storageへの書き込みは
     sidepanel.js から直接 `chrome.storage.local.set` でよい）

3. **一括操作セクション**
   - 「全タブを一括グループ化」ボタン → background に `GROUP_ALL` を送信
   - 「グループ解除」ボタン（ドメインごと、またはドメイン一覧の各行に配置）→ `UNGROUP_DOMAIN` を送信
   - 「データをリセット」ボタン → 確認ダイアログ表示 → OKなら background に `RESET_DATA` を送信

### 7.2 検索（インクリメンタル）仕様

- `<input>` の `input` イベントで即時（デバウンスなし）に再フィルタする。
- マッチ方式: **部分一致**（タイトル または URL のどこかにキーワードが含まれていればヒット）。
  ドメイン一覧側はドメイン名に対する部分一致。
- 大文字・小文字は **区別しない**（比較前に両方を小文字化）。

### 7.3 データ取得方法

- sidepanel.js は `chrome.storage.local.get()` で **直接** storage を読む
  （background へのメッセージ経由はしない。表示専用のため）。
- タブ操作（グループ化・解除・リセット）のみ `chrome.runtime.sendMessage()` で background に依頼する。

---

## 8. 対象外・非対応事項（明示的に確認済み）

- シークレットモード（プライベートウィンドウ）: デフォルト動作のまま。拡張に明示的な許可を
  与えない限り何もしない。特別なハンドリングは入れない。
- データのエクスポート（JSON/CSV）機能: 今回は対応しない。
- グループ化失敗時の詳細なリトライ・救済処理: 行わない。エラーメッセージ表示のみ。

---

## 9. 実装順序（推奨）

1. `manifest.json`
2. `background.js`
   - 初期集計・onVisited加算・90日クリーンアップ（alarms）
   - メッセージハンドラ: `GROUP_DOMAIN` / `GROUP_ALL` / `UNGROUP_DOMAIN` / `RESET_DATA`
   - `chrome.action.onClicked` によるサイドパネルのトグル開閉
3. `sidepanel.html` / `sidepanel.css`（レイアウトの骨組み）
4. `sidepanel.js`
   - storage読み込み・一覧描画
   - 検索／ソート
   - 各ボタンのイベントハンドラ（background へのメッセージ送信）
