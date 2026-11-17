# app-itonami-omikuji — Omikuji

おみくじ — 神社ごとのおみくじの割合を決め、引いた結果を残します。同じ人は同じ神社で 1 日 1 回まで。結んだ（resetFortune）おみくじは手放したことになり、もう一度引けます。

Tauri **3.0.0-alpha.6** の独立 app（`tauri-runtime-wry`、OS の WebView）と、同じファイルの static Web ビルドです。記録はすべてこの端末の中（localStorage、key `itonami.omikuji.v1`）に保存し、外部へは通信しません。外部操作の宣言もありません（`dist/descriptor.json` の `operations: []`）。保存に失敗したときは画面に表示します。

## できること

| 操作 | 内容 |
| --- | --- |
| 神社を作る (createShrine) | weights は {"大吉":16,"吉":35,…} のような JSON。空なら標準の割合です。 |
| 神社を変える (updateShrine) | — |
| 神社を見る (getShrine) | — |
| おみくじを引く (drawFortune) | 端末の暗号用乱数で、割合どおりに選びます。 |
| 引いた記録 (listFortunes) | — |
| 結果を見る (getFortune) | — |
| 結ぶ (resetFortune) | — |
| 神社の一覧 (listShrines) | — |

記録（collection）: `cloud.itonami.apps.omikuji.fortune`、`cloud.itonami.apps.omikuji.shrine`

## 補足

- **この domain は新しく設計したものです。** 旧 Worker は処理を外部の AgentGateway / LangServer に転送していて、処理の中身はこの repository にありませんでした。旧 Worker の method 名・README・BPMN をもとに、この端末だけで動く domain を作りました。旧サービスと同じ挙動である保証はありません。
- 標準の割合は 大吉 16・吉 35・中吉 5・小吉 4・末吉 6・凶 30・大凶 4 です（神社ごとに変えられます）。乱数は端末の `crypto.getRandomValues` で、偏りが出ないように棄却法で選びます。
- 旧 `appview/omikuji-mcp-component/cljs/`（UI）と `kotodama.jsonld` は残しています。中身が `expect(true)` だけだった Worker 用のテストは削除しました。

## 構成

| パス | 役割 |
| --- | --- |
| `src/domain/` | domain logic（TypeScript）。ビルド時に Node の type stripping で JS にします（bundler・依存なし） |
| `src/local-store.js` | この端末内の record store。domain が使う `read` / `write` を localStorage で実装 |
| `src/app-def.js` | 画面の操作と domain 関数・collection の対応 |
| `src/ui/` | 依存なしの UI。DOM はテキストノードだけで組み、HTML 文字列を使いません（CSP `style-src 'self'`） |
| `vendor/` | kotoba-lang/kotoba の `kotoba-client-runtime.js` / consent CSS と `PINS.json`。`scripts/build.mjs` が digest のずれで失敗します |
| `src-tauri/` | Tauri v3 host。read-only command は `awai_host_info` の 1 つだけ。filesystem・network・shell・installer 権限なし |
| `appview/` | 旧 appview（Svelte / cljs UI）。この app のビルド・テストでは使いません |
| `bpmn/` | BPMN 定義（参照用） |

## コマンド

```sh
npm ci
npm test              # build してから domain と local-only のテスト（local-only.test.mjs, omikuji.test.ts）
npm run build         # dist/ と SHA-256 の release.json
npm run build:desktop # native desktop 実行ファイル（bundle・署名なし）
```

## 状態と制限（AWAI-3079, 2026-11-17）

- 旧構成（Cloudflare Worker の XRPC dispatcher / adapter、`wrangler.jsonc`、`@etzhayyim/sdk`）は削除しました。履歴は git にあります。
- 検証済み: `npm test`、`npm run build`、`cargo check`（Tauri 3.0.0-alpha.6）。
- 未検証: native window の起動、`tauri build`、Android、署名、配布。アイコンは app-soshiki の仮アイコンです。
