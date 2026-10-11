// POST /api/ai  { mode: "analyze", transcript, known } | { mode: "fill", phrase, context }
// Calls Google Gemini (free tier) and returns JSON for the app.
import { env, send, requireUser, readJson } from "./_lib.js";

// Tried in order until one answers. Set GEMINI_MODEL in Vercel to force a specific model.
const MODELS = () => [env("GEMINI_MODEL"), "gemini-flash-latest", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-flash-lite-latest", "gemini-2.5-flash"].filter(Boolean);

export function analyzePrompt(transcript, known) {
  return `あなたは日本人の英語学習者（中上級、CEFR B2〜C1）のための英語コーチです。以下はYouTube動画の字幕です。
次の形のJSONだけを返してください:
{"title":"動画の内容を表す短い日本語タイトル（30字以内）","summary":"日本語で4〜6文の要約","points":["日本語の要点を3〜5個"],"phrases":[{"phrase":"見出し形（句動詞・イディオム・コロケーションは原形。目的語が入る場合は (something) 等で示す）","meaning":"日本語の意味と使い方（40字程度、ニュアンスも）","example":"字幕から実際に使われている文をそのまま引用","translation":"その例文の自然な日本語訳"}]}
選ぶ基準:
- 10〜15個。日常会話・ニュースで再利用できる句動詞、イディオム、コロケーション、やや上級の単語を優先
- 固有名詞、専門用語だけの語、中学レベルの基本語は避ける
- 次の登録済みフレーズは除外: ${known || "（なし）"}

字幕:
"""
${transcript}
"""`;
}

export function videoPrompt(known) {
  return `あなたは日本人の英語学習者（中上級、CEFR B2〜C1）のための英語コーチです。添付のYouTube動画（英語）を視聴し、話されている英語をもとに次の形のJSONだけを返してください:
{"title":"動画の内容を表す短い日本語タイトル（30字以内）","summary":"日本語で4〜6文の要約","points":["日本語の要点を3〜5個"],"phrases":[{"phrase":"見出し形（句動詞・イディオム・コロケーションは原形。目的語が入る場合は (something) 等で示す）","meaning":"日本語の意味と使い方（40字程度、ニュアンスも）","example":"動画の中で実際に話された英文をそのまま書き起こしたもの","translation":"その例文の自然な日本語訳"}]}
選ぶ基準:
- 10〜15個。日常会話・ニュースで再利用できる句動詞、イディオム、コロケーション、やや上級の単語を優先
- 固有名詞、専門用語だけの語、中学レベルの基本語は避ける
- 例文は動画で実際に聞こえた文だけを使い、作らない
- 次の登録済みフレーズは除外: ${known || "（なし）"}`;
}

export function fillPrompt(phrase, context) {
  return `日本人の中上級英語学習者の単語帳を作っています。英語表現「${phrase}」について、次の形のJSONだけを返してください。
{"phrase":"見出し形（目的語が入るなら (something) などで示す）","meaning":"日本語の意味・ニュアンス・使う場面（50字程度）","example":"日常会話で自然な英語の例文1つ","translation":"例文の自然な日本語訳"}${context ? `\n使われた場面のメモ: ${context}` : ""}`;
}

async function gemini(prompt, videoUrl) {
  const key = env("GEMINI_API_KEY");
  if (!key) throw Object.assign(new Error("Vercel に GEMINI_API_KEY が設定されていません"), { status: 500 });
  let last;
  for (const model of MODELS()) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [...(videoUrl ? [{ fileData: { fileUri: videoUrl } }] : []), { text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.4, ...(videoUrl ? { mediaResolution: "MEDIA_RESOLUTION_LOW" } : {}) }
      })
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
      try { return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")); }
      catch { last = Object.assign(new Error("AI の返答を読み取れませんでした。もう一度お試しください"), { status: 502 }); continue; }
    }
    last = Object.assign(new Error(j.error?.message || `Gemini エラー (${r.status})`), { status: r.status });
    if (r.status === 429) { last.message = "AI の無料枠の上限に達しました。少し時間をおいてお試しください"; throw last; }
    if (r.status === 400 && /API key/i.test(last.message)) { last.message = "GEMINI_API_KEY が正しくありません"; throw last; }
    // 404 = model not available for this key → try the next one
  }
  throw last;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  const user = await requireUser(req, res); if (!user) return;
  const body = await readJson(req);
  try {
    if (body.mode === "analyze") {
      const tr = String(body.transcript || "").slice(0, 150000);
      if (tr.length < 200) return send(res, 400, { error: "字幕が短すぎます" });
      const known = (Array.isArray(body.known) ? body.known : []).slice(0, 400).join(" | ");
      return send(res, 200, await gemini(analyzePrompt(tr, known)));
    }
    if (body.mode === "analyzeVideo") {
      const id = String(body.videoId || "");
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return send(res, 400, { error: "YouTube のリンクを確認してください" });
      const known = (Array.isArray(body.known) ? body.known : []).slice(0, 400).join(" | ");
      return send(res, 200, await gemini(videoPrompt(known), `https://www.youtube.com/watch?v=${id}`));
    }
    if (body.mode === "fill") {
      const p = String(body.phrase || "").trim().slice(0, 200);
      if (!p) return send(res, 400, { error: "フレーズを入力してください" });
      return send(res, 200, await gemini(fillPrompt(p, String(body.context || "").slice(0, 500))));
    }
    send(res, 400, { error: "unknown mode" });
  } catch (e) {
    send(res, e.status && e.status < 600 ? (e.status === 404 ? 502 : e.status) : 500, { error: e.message || "AI の呼び出しに失敗しました" });
  }
}
