# 市区町村 High & Low

全国の市区町村の統計データで戦う、1対1のオンライン推理・知識対戦ゲーム。
仕様は `仕様書_確定版.md`（プロジェクトの共有フォルダ spec/）を正とします。

## 構成
| フォルダ | 内容 |
|---|---|
| `shared/` | ルール定数と型（画面・サーバー共通） |
| `server/` | ルール判定エンジン（`engine.ts`）、bot（`bot.ts`）、お題選び（`topics.ts`） |
| `worker/` | Cloudflare Workers。対戦部屋（`room.ts`）とランダムマッチの待ち列（`matchmaker.ts`）は Durable Objects |
| `web/` | 画面（React） |
| `data/dataset.json` | 統計データ。**サーバー側だけ**に置き、画面には公開してよい値だけ送る |
| `scripts/` | データ作成スクリプト |

## 開発
```sh
npm install
npm run data:dummy     # 開発用ダミーデータ（本物の統計ではない）
npm test               # ルール判定のテスト
npm run build && npx wrangler dev   # http://localhost:8787
```

## 公開
```sh
npx wrangler login
npm run deploy
```
