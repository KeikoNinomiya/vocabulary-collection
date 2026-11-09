# Vocabulary Collection

YouTube の動画・Web記事・PDFやWordの文書と日常会話から英語フレーズを集めて、1日後・3日後・7日後…と間隔をあけて復習する単語帳アプリです。パソコンのブラウザでも、iPhone のホーム画面に追加したアプリとしても使えます。

## できること

- **教材から学ぶ**: 教材は3種類から選べます。AI（Google Gemini）が日本語の要約と覚えるべきフレーズ（意味・例文・訳）を抽出します。
  - **動画**: YouTube はリンクから字幕を自動取得します。字幕を取れない動画は、貼り付けでも使えます。Instagram は字幕を取り出す仕組みがないため、リンクと文字起こしの貼り付けで使います（リンクは出典として記録）。
  - **Web記事**: 記事のURLから本文を取り出します（`api/article.js`）。会員限定のページなどは本文の貼り付けで使えます。
  - **ファイル**: PDF・Word（.docx）・HTML・テキストを、端末の中で読み込みます（PDFは pdf.js、Wordは mammoth.js）。
- **単語帳の項目**: ステータス（未定着・あいまい・定着）、単語、意味（英語）、意味（日本語）、例文（英語）、例文（日本語）、引用元（URL。ファイルから登録した語は「ファイル」と表示）。
- **なぞって登録**: 「本文を読んで語句を登録」で本文を開き、覚えたい語句を指でなぞると「登録」ボタンが出ます。AIがその文での意味と訳を下書きし、本文の文をそのまま例文にします。登録した語句には本文中で印がつきます。
- **登録**: 日常会話で出会った表現を自分で登録できます。「AIに補完」で意味と例文を下書きします。
- **復習**: フラッシュカード（英→日、日→英）、4択の意味クイズ、例文の穴埋めクイズの4種類。カードはスワイプで採点でき、発音の読み上げにも対応しています。
- **復習スケジュール**: 「覚えた」で 1 → 3 → 7 → 14 → 30 日後と間隔が伸び、7日後の復習を通過すると「定着」になります。
- **毎朝の通知**: 8時ごろにその日の復習枚数を通知し、アイコンに数字のバッジを付けます。
- **オフライン**: 一度開いたあとは電波がなくても復習でき、つながったときに同期します。
- **CSV**: 取り込みと書き出しに対応しています。列はもとのスプレッドシートと同じです。


## しくみ

| 部分 | 使っているもの |
|---|---|
| 画面 | `public/`（ビルド不要の HTML / JS / CSS、PWA） |
| サーバー処理 | `api/`（字幕取得、記事の本文取得、AI、通知） |
| サーバー本体 | `server.js`（パソコンでも Google Cloud Run でも、`public/` と `api/` をそのまま動かす） |
| ファイル読み込み | pdf.js（PDF）、mammoth.js（Word）をCDNから読み込み、ブラウザ内で処理 |
| データとログイン | Supabase（`supabase/schema.sql`） |
| 要約・抽出 | Google Gemini API |
| 毎朝の通知 | Cloud Scheduler（Vercel の場合は Vercel Cron）＋ Web Push |

```
vocabulary-collection/
├── server.js            パソコン・Cloud Run 用のサーバー
├── api/                 サーバー処理（server.js と Vercel の両方で使う）
├── public/              画面（HTML / JS / CSS / アイコン）
├── supabase/schema.sql  データベースの表
├── Dockerfile           Cloud Run 用
├── .env.example         パソコンで試すときの設定のひな形
├── env.example.yaml     Cloud Run 用の設定のひな形
└── vercel.json          Vercel 用（Vercel を使わないなら不要）
```

---

## 1. 共通の準備（最初の1回だけ）

どの方法で動かす場合も、次の3つが必要です。

1. **Supabase**（データの保存とログイン）
   1. supabase.com でプロジェクトを作る（リージョンは Tokyo）。
   2. SQL Editor に `supabase/schema.sql` の中身を貼って Run する。更新のたびにもう一度 Run してください（何度実行しても安全で、新しい列だけが追加されます）。
   3. Authentication → Sign In / Providers → Email の「Confirm email」をオフにする。
   4. Project Settings → API Keys から、Project URL・Publishable key・Secret key を控える。
2. **Gemini API キー**（要約・抽出）: Google AI Studio（aistudio.google.com）の「Get API key」で作る。
3. **通知用の鍵**: 下の「パソコンで試す」の手順 3 で `npm run keys` を実行すると作れます。

---

## 2. パソコンで試す（ローカル）

自分のパソコンでアプリを動かして、動作を確かめたり画面を直したりするための手順です。

### 必要なもの

- **Node.js 20.6 以上**（nodejs.org の「LTS」をインストール）。ターミナルで `node -v` と打って `v20.6` 以上が出ればOK。
- **Git**（Mac は最初から入っています）

### 手順

```bash
# 1. コードを手元に持ってくる（最初の1回だけ）
git clone https://github.com/KeikoNinomiya/vocabulary-collection.git
cd vocabulary-collection

# 2. 必要な部品を入れる
npm install

# 3. 設定ファイルを作る
cp .env.example .env
npm run keys        # 通知用の鍵が3行出るので、.env の同じ名前の行に貼る
```

4. `.env` をテキストエディタで開き、「共通の準備」で控えた値を入れて保存する。

```bash
# 5. 起動する
npm run dev
```

5. ブラウザ（Chrome がおすすめ）で **http://localhost:3000** を開く。止めるときはターミナルで `Ctrl + C`。

### 知っておくこと

- **データは本番と共通です。** `.env` に本番と同じ Supabase を入れると、パソコンで登録・削除した単語は本番の単語帳にも反映されます。気になる場合は、Supabase でテスト用のプロジェクトをもう1つ作り、その値を `.env` に入れてください。
- **ファイルを直したら、ブラウザを再読み込みするだけで反映されます。** `server.js` や `api/` を直したときは、`Ctrl + C` で止めて `npm run dev` で起動し直してください。
- **パソコンでは画面の保存（オフライン用のキャッシュ）をしません。** 直した内容が古いまま表示されるのを防ぐためです。
- **通知のテスト**: Chrome なら localhost でも「通知をオンにする」→「テスト送信」が使えます。毎朝の通知はパソコンでは自動では動きません。
- **スマホでの確認**: パソコンで開いたまま、Chrome の開発者ツール（`⌘ + Option + I`）→ スマホのアイコンで、iPhone の画面幅で表示できます。
- **YouTube の字幕**: パソコンからだと YouTube に止められにくいので、自動取得が成功しやすくなります。

---

## 3. Google Cloud に公開する（Cloud Run）

インターネットに公開して、iPhone からも使えるようにする手順です。サーバーは Cloud Run、毎朝の通知は Cloud Scheduler で動かします。

### 必要なもの

- Google Cloud のプロジェクトと**請求先アカウント**（Cloud Run は無料枠の範囲なら料金はかかりませんが、請求先の登録は必要です）。念のため「お支払い → 予算とアラート」で 500 円などの予算アラートを作っておくと安心です。
- **gcloud CLI**（cloud.google.com/sdk/docs/install）。インストール後に `gcloud init` でログインし、プロジェクトを選ぶ。
- Gemini の API キーを作ったプロジェクトと同じプロジェクトを使うと管理が楽です。

### 手順

```bash
# 1. 使う機能をオンにする（最初の1回だけ）
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com cloudscheduler.googleapis.com

# 2. 設定ファイルを作る
cp env.example.yaml env.yaml
#    env.yaml を開いて値を入れる（.env と同じ値でOK。書き方は「名前: "値"」）

# 3. 公開する（2回目以降の更新も、このコマンドだけ）
gcloud run deploy vocabulary-collection \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --env-vars-file env.yaml \
  --timeout 300
```

初回は「Artifact Registry のリポジトリを作りますか？」と聞かれるので `Y` で進めます。数分で `Service URL: https://vocabulary-collection-xxxxx.a.run.app` と表示されたら公開完了です。

```bash
# 4. 毎朝8時の通知を設定する（最初の1回だけ）
#    URL は手順3で出たもの、CRON_SECRET は env.yaml と同じ値に置き換える
gcloud scheduler jobs create http vocabulary-daily \
  --location asia-northeast1 \
  --schedule "0 8 * * *" \
  --time-zone "Asia/Tokyo" \
  --uri "https://vocabulary-collection-xxxxx.a.run.app/api/cron-daily" \
  --http-method GET \
  --headers "Authorization=Bearer ここにCRON_SECRET"

# 動作確認（すぐに1回動かす）
gcloud scheduler jobs run vocabulary-daily --location asia-northeast1
```

5. **Supabase**: Authentication → URL Configuration の Site URL に、手順3の URL を入れる。
6. **iPhone**: Safari で URL を開き、共有 →「ホーム画面に追加」。アイコンから開いてログインし、「通知をオンにする」を押す。
7. **Supabase**: 自分のアカウントを作ったら、Authentication → Sign In / Providers の「Allow new users to sign up」をオフにする（他人が登録できないようにするため）。

### Vercel から移る場合

- 単語帳のデータは Supabase にあるので、そのまま引き継がれます。ログインし直すだけで使えます。
- **iPhone のホーム画面のアイコンは作り直してください。** URL が変わるため、古いアイコンを削除し、新しい URL から「ホーム画面に追加」と「通知をオンにする」をやり直します。
- **Vercel のプロジェクトは削除するか、Settings → Git から GitHub との接続を外してください。** 両方が動いていると、毎朝の通知が2回届きます。

### 秘密の値をもっと安全に扱いたい場合（任意）

`env.yaml` の代わりに Secret Manager を使えます。値を Secret Manager に登録し、`--env-vars-file env.yaml` の代わりに `--set-secrets "GEMINI_API_KEY=gemini-api-key:latest,..."` を指定します。

---

## 4. Vercel で公開する（これまでの方法）

`vercel.json` があるので、GitHub のリポジトリを Vercel に Import すれば動きます。Settings → Environment Variables に下の表の値を入れ、Deployments から Redeploy してください。毎朝の通知は Vercel Cron が自動で動かします。

---

## 環境変数

| 名前 | 中身 | 秘密 |
|---|---|---|
| `SUPABASE_URL` | Supabase の Project URL | いいえ |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase の Publishable key（または anon key） | いいえ |
| `SUPABASE_SECRET_KEY` | Supabase の Secret key（または service_role key） | **はい** |
| `GEMINI_API_KEY` | Google AI Studio の API キー | **はい** |
| `VAPID_PUBLIC_KEY` | 通知用の公開鍵（`npm run keys` で作成） | いいえ |
| `VAPID_PRIVATE_KEY` | 通知用の秘密鍵（`npm run keys` で作成） | **はい** |
| `CRON_SECRET` | 毎朝の通知処理を守る合言葉（`npm run keys` で作成） | **はい** |
| `ALLOWED_EMAIL` | アプリを使える自分のメールアドレス（カンマ区切りで複数可） | いいえ |
| `GEMINI_MODEL` | （任意）使う Gemini のモデル名。空なら自動で選ぶ | いいえ |
| `PORT` | （任意）サーバーのポート。パソコンでは 3000、Cloud Run では自動で設定される | いいえ |

秘密の値はコードに書かないでください。`.env` と `env.yaml` は `.gitignore` でリポジトリに入らないようにしてあります。リポジトリは公開されているので、この2つのファイルを GitHub に上げないよう注意してください。

## 注意

- YouTube はクラウドサーバーからの字幕取得を止めることがあります。そのときは「AIに動画を直接見てもらう」か、字幕の貼り付けを使ってください。
- Supabase の無料プランは、1週間アクセスがないと一時停止します。毎朝の通知処理が毎日アクセスするので、通常は止まりません。
- Gemini の無料枠では、送った内容が Google のサービス改善に使われることがあります。
