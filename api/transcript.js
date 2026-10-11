// GET /api/transcript?v=VIDEO_ID  → { title, lang, auto, text }
// Fetches YouTube captions server-side, trying several YouTube app clients in turn because
// YouTube often blocks cloud servers for some of them. When all fail, the app offers
// "AIに動画を直接見てもらう" (Gemini reads the video itself) or pasting the transcript.
import { send, requireUser } from "./_lib.js";

const WEB_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const CLIENTS = [
  { name: "ANDROID_VR", ua: "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    client: { clientName: "ANDROID_VR", clientVersion: "1.62.27", deviceMake: "Oculus", deviceModel: "Quest 3", androidSdkVersion: 32, osName: "Android", osVersion: "12L" } },
  { name: "IOS", ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    client: { clientName: "IOS", clientVersion: "20.10.4", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82" } },
  { name: "TV_EMBED", ua: WEB_UA,
    client: { clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", clientVersion: "2.0" }, thirdParty: { embedUrl: "https://www.youtube.com/" } },
  { name: "ANDROID", ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
    client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34, osName: "Android", osVersion: "14" } },
  { name: "WEB_EMBEDDED", ua: WEB_UA,
    client: { clientName: "WEB_EMBEDDED_PLAYER", clientVersion: "1.20250101.00.00" }, thirdParty: { embedUrl: "https://www.youtube.com/" } }
];

const decode = s => s
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));

export function parseCaptionXml(xml) {
  const lines = [];
  for (const m of xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) lines.push(decode(m[1]));
  if (!lines.length) for (const m of xml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) lines.push(decode(m[1]));
  return lines.map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

function pickTrack(tracks) {
  const en = tracks.filter(t => /^en\b/i.test(t.languageCode || ""));
  return en.find(t => t.kind !== "asr") || en[0] || tracks.find(t => t.kind !== "asr") || tracks[0];
}

async function tryClient(videoId, c) {
  const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": c.ua, "Accept-Language": "en-US,en;q=0.9", Origin: "https://www.youtube.com" },
    body: JSON.stringify({ context: { client: { hl: "en", gl: "US", ...c.client }, ...(c.thirdParty ? { thirdParty: c.thirdParty } : {}) }, videoId, contentCheckOk: true, racyCheckOk: true }),
    signal: AbortSignal.timeout(8000)
  });
  const j = await r.json().catch(() => ({}));
  const status = j?.playabilityStatus?.status || `HTTP ${r.status}`;
  const title = j?.videoDetails?.title || "";
  const tracks = j?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) return { status, title };
  const t = pickTrack(tracks);
  const url = String(t.baseUrl || "").replace(/&fmt=[^&]*/, "");
  const xml = await (await fetch(url, { headers: { "User-Agent": c.ua }, signal: AbortSignal.timeout(8000) })).text();
  const text = parseCaptionXml(xml);
  return { status: text ? "OK" : "EMPTY_CAPTIONS", title, text, lang: t.languageCode, auto: t.kind === "asr" };
}

export default async function handler(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  const v = String(req.query?.v || new URL(req.url, "http://x").searchParams.get("v") || "");
  if (!/^[A-Za-z0-9_-]{11}$/.test(v)) return send(res, 400, { error: "YouTube のリンクを確認してください" });
  const tried = [];
  let title = "";
  for (const c of CLIENTS) {
    try {
      const r = await tryClient(v, c);
      title = title || r.title;
      tried.push(`${c.name}:${r.status}`);
      if (r.text) return send(res, 200, { title: r.title || title, lang: r.lang, auto: r.auto, text: r.text, via: c.name });
      if (r.status === "OK" && !r.text) continue;
    } catch (e) {
      tried.push(`${c.name}:${e.name === "TimeoutError" ? "TIMEOUT" : "ERROR"}`);
    }
  }
  send(res, 404, { error: "YouTube から字幕を取得できませんでした", title, tried, canUseVideo: true });
}
