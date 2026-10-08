// GET /api/transcript?v=VIDEO_ID  → { title, lang, auto, text }
// Fetches YouTube captions server-side. YouTube sometimes blocks cloud servers; the app then
// falls back to pasting the transcript by hand.
import { send, requireUser } from "./_lib.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const HEAD = { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+cb; SOCS=CAI" };

const decode = s => s
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));

export function parseCaptionXml(xml) {
  const lines = [];
  // legacy format: <text start=".." dur="..">..</text>
  for (const m of xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) lines.push(decode(m[1]));
  // srv3 format: <p t=".." d="..">..<s>..</s></p>
  if (!lines.length) for (const m of xml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) lines.push(decode(m[1]));
  return lines.map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

function pickTrack(tracks) {
  const en = tracks.filter(t => /^en\b/i.test(t.languageCode || ""));
  return en.find(t => t.kind !== "asr") || en[0] || tracks.find(t => t.kind !== "asr") || tracks[0];
}

async function playerTracks(videoId, apiKey) {
  const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`, {
    method: "POST",
    headers: { ...HEAD, "Content-Type": "application/json" },
    body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", hl: "en" } }, videoId })
  });
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  return j?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
}

export default async function handler(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  const v = String(req.query?.v || new URL(req.url, "http://x").searchParams.get("v") || "");
  if (!/^[A-Za-z0-9_-]{11}$/.test(v)) return send(res, 400, { error: "YouTube のリンクを確認してください" });
  try {
    const page = await (await fetch(`https://www.youtube.com/watch?v=${v}&hl=en`, { headers: HEAD })).text();
    if (/consent\.youtube\.com|g-recaptcha|unusual traffic/i.test(page.slice(0, 20000)))
      return send(res, 503, { error: "YouTube にアクセスを止められました。字幕を貼り付けてください", blocked: true });
    const title = decode((page.match(/<meta name="title" content="([^"]*)"/) || [])[1] || "");
    const apiKey = (page.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];

    let tracks = apiKey ? await playerTracks(v, apiKey) : [];
    if (!tracks.length) {
      const m = page.match(/"captionTracks":(\[.*?\])/);
      if (m) try { tracks = JSON.parse(m[1]); } catch {}
    }
    if (!tracks.length) return send(res, 404, { error: "この動画の字幕を取得できませんでした。字幕を貼り付けてください", title });

    const t = pickTrack(tracks);
    const url = String(t.baseUrl || "").replace(/&fmt=[^&]*/, "");
    const xml = await (await fetch(url, { headers: HEAD })).text();
    const text = parseCaptionXml(xml);
    if (!text) return send(res, 502, { error: "字幕が空でした。字幕を貼り付けてください", title });
    send(res, 200, { title, lang: t.languageCode, auto: t.kind === "asr", text });
  } catch (e) {
    send(res, 502, { error: "字幕を取得できませんでした。字幕を貼り付けてください", detail: String(e.message || e) });
  }
}
