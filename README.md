# Quiz Buzzer App

軽量なクイズ早押しアプリのサンプルです。スマホを参加者端末として接続し、出題者は管理画面で操作します。QRコードで参加者に接続先URLを渡せます。

主な機能
- 早押しボタン（参加者画面）
- 管理画面でモード切替（人が読み上げる / 機械が問題リストから読み上げる / LLMで自動生成）
- QRコード発行エンドポイント

セットアップ

1. Node.js 18+ を用意します。
2. ルートで依存をインストールします。

```bash
npm install
```

3. （任意）LLM を使う場合（Gemini / Vertex AI）

Gemini を使うには Google の認証と設定が必要です。手順の概略:

- サービスアカウントキー JSON を作成し、環境変数 `GOOGLE_APPLICATION_CREDENTIALS` にパスを指定します。
- プロジェクトID を `GOOGLE_CLOUD_PROJECT`（または `GCLOUD_PROJECT`）に設定します。
- 必要に応じてロケーション（例: `us-central1`）を `GOOGLE_CLOUD_LOCATION` に設定します。
- Gemini を有効にするには環境変数 `USE_GEMINI=1` を設定します（デフォルトではサンプル問題にフォールバックします）。

例:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
export GOOGLE_CLOUD_PROJECT="my-gcp-project"
export GOOGLE_CLOUD_LOCATION="us-central1"
export USE_GEMINI=1
```

 dotenv を使う場合

 プロジェクトルートに `.env` ファイルを置けば自動的に読み込まれます（既に `server.js` で `require('dotenv').config()` を呼んでいます）。例として以下のような `.env` を作成してください：

```
# .env の例
USE_GEMINI=1
GOOGLE_APPLICATION_CREDENTIALS=/home/you/keys/service-account.json
GOOGLE_CLOUD_PROJECT=my-gcp-project
GOOGLE_CLOUD_LOCATION=us-central1
GEMINI_MODEL=text-bison@001
PORT=3000
```

`.env` に書いた値はサーバー起動時に環境変数として読み込まれるので、`npm start` でそのまま利用できます。

APIキーで使う（別オプション）

もしサービスアカウントを使わずに API キーで呼び出したい場合は、Google API コンソールや AI Studio から API キーを作成して、`.env` に `GEMINI_API_KEY=your_api_key` を追加してください。`server.js` は API キーがあればそれを優先して `@google/genai` クライアントを初期化します。

`.env` 例に追加する行:

```
GEMINI_API_KEY=AIza....
```

注意: API キーはプロジェクトと課金設定に依存し、サービスアカウントに比べて用途が限定されるため、用途に応じて両者を選んでください。

注意: 実際の呼び出しで使うモデル名やエンドポイントは環境により異なります。`server.js` 内で `GEMINI_MODEL` 環境変数で上書きできます（例: `text-bison@001`）。

4. サーバー起動

```bash
npm start
```

使い方
- 管理画面: http://localhost:3000/admin.html
- 参加者: http://localhost:3000/index.html でルームIDを指定して参加
- **Google検索グラウンディング**: http://localhost:3000/grounding.html （新機能！）

QRコード
- GET /qr?url=<参加用URL> を呼ぶと dataURL を返します（管理画面から生成可能）

## Google検索グラウンディング機能 🔍

Gemini API の Google 検索グラウンディング機能を使用したデモが追加されました。

### 機能概要

- リアルタイムのウェブ検索結果に基づいた回答を生成
- 回答に引用元のリンクをインライン表示（クリックで元サイトへ移動可能）
- 使用された検索クエリの表示
- 引用元一覧の表示
- レスポンスキャッシュ（60秒TTL）で高速化とコスト削減

### クイズ問題生成でもグラウンディングを使用 🎯

**新機能！** LLMで自動生成されるクイズ問題にもGoogle検索グラウンディングが統合されました：

- クイズ問題が事実に基づいた最新情報から生成される
- 各問題に出典情報が自動的に付加される
- 管理画面とプレイヤー画面の両方で出典を確認可能
- ハルシネーション（事実誤認）のリスクを大幅に低減

**使い方:**
1. 管理画面で「LLMで自動生成」モードを選択
2. ジャンルや難易度を設定して問題を生成
3. 生成された問題の下に出典リンクが表示されます
4. プレイヤー画面でも問題と一緒に出典が表示されます

### 使い方

1. サーバーを起動（GEMINI_API_KEY が必要）:
```bash
export GEMINI_API_KEY="your-api-key"
npm start
```

2. ブラウザで http://localhost:3000/grounding.html にアクセス

3. 質問を入力して「検索して回答生成」ボタンをクリック

### APIエンドポイント

新しく追加された `POST /api/generate` エンドポイント：

**リクエスト:**
```json
{
  "prompt": "質問文",
  "model": "gemini-2.5-flash" (オプション)
}
```

**レスポンス:**
```json
{
  "text": "回答本文",
  "groundingMetadata": {
    "webSearchQueries": ["検索クエリ1", "検索クエリ2"],
    "groundingChunks": [
      {"uri": "https://...", "title": "サイト名"}
    ],
    "groundingSupports": [
      {
        "segment": {"startIndex": 0, "endIndex": 50, "text": "..."},
        "groundingChunkIndices": [0, 1]
      }
    ]
  }
}
```

### セキュリティ

- APIキーはサーバー側のみで保持（クライアントには露出しない）
- 入力バリデーション（4000文字制限）
- エラーハンドリング（400, 500, 503対応）

### 制限事項

- Gemini API の利用制限に従います
- キャッシュは60秒間のみ有効（メモリ内）
- 同時リクエスト数の制限はアプリケーションレベルでは未実装

注意
- これはサンプル実装で、永続化や本番向けの認証はありません。LLM 呼び出しはキーが必要です。

## テスト

包括的な統合テストが用意されています。以下のコマンドで実行できます：

```bash
npm test
```

詳細なログを表示する場合:

```bash
npm run test:verbose
```

### テストカバレッジ

全28件のテストケースが以下の機能をカバーしています:

1. **部屋立ち上げ** - ホスト接続と部屋作成
2. **プレイヤー参加** - 複数プレイヤーの参加
3. **問題セット** - ホストが問題を設定
4. **ゲーム開始** - start-gameイベント
5. **手動モード** - next-questionで問題送信
6. **プレイヤー解答** - 正解判定
7. **早押しボタン** - buzz機能
8. **ゲーム中の問題変更** - set-questions
9. **モード変更** - start-modeイベント
10. **自動送信モード** - autoモード動作確認
11. **LLM生成モード起動** - generate-llmイベント
12. **自動補充設定** - set-auto-refill
13. **ゲーム中の生成オプション変更** - set-auto-refill
14. **解答表示** - reveal-answerイベント
15. **タイピング更新通知** - typing-update
16. **buzz後のキャンセル** - cancel-buzz
17. **強制補充** - force-refill
18. **複合シナリオ** - 完全なゲームフロー
19. **perCharSec設定** - 1文字あたりの時間設定
20. **切断処理** - プレイヤー切断時の状態更新
21. **restart-game** - LLMモードで問題再生成（パラメータ付き）
22. **restart-game** - 非LLMモードでリセット
23. **restart-game** - パラメータなしでも既存設定で再生成
24. **LLM一時停止** - 参加者がいない場合は自動生成停止
25. **LLM再開** - 参加者が参加したら自動生成再開
26. **POST /api/generate** - エンドポイント存在確認
27. **POST /api/generate** - promptバリデーション
28. **POST /api/generate** - 正常レスポンス構造確認

テストは自動的にサーバーを起動し、全ての機能をエンドツーエンドでテストします。
