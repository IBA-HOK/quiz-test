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

QRコード
- GET /qr?url=<参加用URL> を呼ぶと dataURL を返します（管理画面から生成可能）

注意
- これはサンプル実装で、永続化や本番向けの認証はありません。LLM 呼び出しはキーが必要です。
