# Vocabulary Collection

YouTube の動画・Web記事・PDFやWordの文書と日常会話から英語フレーズを集めて、1日後・3日後・7日後…と間隔をあけて復習する単語帳アプリです。iPhone のホーム画面に追加して、アプリとして使えます。

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
| サーバー処理 | `api/`（Vercel Functions: 字幕取得、記事の本文取得、AI、通知） |
| ファイル読み込み | pdf.js（PDF）、mammoth.js（Word）をCDNから読み込み、ブラウザ内で処理 |
| データとログイン | Supabase（`supabase/schema.sql`） |
| 要約・抽出 | Google Gemini API（無料枠） |
| 毎朝の通知 | Vercel Cron（`vercel.json`）＋ Web Push |

## セットアップ

1. **Supabase**: SQL Editor に `supabase/schema.sql` の中身を貼って Run する。すでに使っている場合も、更新のたびにもう一度 Run してください（何度実行しても安全で、新しい列だけが追加されます）。
2. **Supabase**: Authentication → Sign In / Providers → Email の「Confirm email」をオフにする。
3. **Vercel**: Settings → Environment Variables に下の表の値を登録し、Deployments から Redeploy する。
4. **iPhone**: Safari で開き、共有 →「ホーム画面に追加」。アイコンから開いてアカウントを作成し、「通知をオンにする」を押す。
5. **Supabase**: 自分のアカウントを作ったら、Authentication → Sign In / Providers の「Allow new users to sign up」をオフにする（他人が登録できないようにするため）。

### 環境変数

| 名前 | 中身 | 秘密 |
|---|---|---|
| `SUPABASE_URL` | Supabase の Project URL | いいえ |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase の Publishable key（または anon key） | いいえ |
| `SUPABASE_SECRET_KEY` | Supabase の Secret key（または service_role key） | **はい** |
| `GEMINI_API_KEY` | Google AI Studio の API キー | **はい** |
| `VAPID_PUBLIC_KEY` | 通知用の公開鍵 | いいえ |
| `VAPID_PRIVATE_KEY` | 通知用の秘密鍵 | **はい** |
| `CRON_SECRET` | 毎朝の通知処理を守る合言葉（ランダムな文字列） | **はい** |
| `ALLOWED_EMAIL` | アプリを使える自分のメールアドレス | いいえ |
| `GEMINI_MODEL` | （任意）使う Gemini のモデル名。空なら自動で選ぶ | いいえ |

秘密の値はコードに書かず、必ず Vercel の環境変数に入れてください。`.env` ファイルは `.gitignore` でリポジトリに入らないようにしてあります。

## 注意

- YouTube はクラウドサーバーからの字幕取得を止めることがあります。そのときはアプリの案内に従って字幕を貼り付けてください。
- Supabase の無料プランは、1週間アクセスがないと一時停止します。毎朝の通知処理が毎日アクセスするので、通常は止まりません。
- Gemini の無料枠では、送った内容が Google のサービス改善に使われることがあります。
