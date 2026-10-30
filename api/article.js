// GET /api/article?url=https://…  → { title, text, url }
// Fetches a web article server-side (browsers can't, because of CORS) and pulls out the main text.
// No extra libraries: takes <article> / <main> when present, otherwise the page's paragraphs.
import { send, requireUser } from "./_lib.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MAX_BYTES = 3 * 1024 * 1024;

// Refuse addresses inside private networks so the function can't be used to reach them.
export function isPublicHttpUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h.includes(".") || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^(0|10|127)\./.test(h) || /^169\.254\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return false;
  if (h.includes(":")) return false; // IPv6 literals
  return true;
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…" };
export const decodeEntities = s => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);

const strip = s => decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/[ \t ]+/g, " ").trim();

export function extractArticle(html) {
  const meta = (name) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    return tag ? decodeEntities(tag.match(/content=["']([^"']*)["']/i)?.[1] || "").trim() : "";
  };
  const title = meta("og:title") || strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") || strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");

  // drop parts that are never the article body
  let body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|iframe|form|button|select)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(nav|header|footer|aside|figure)\b[\s\S]*?<\/\1>/gi, "");

  // prefer the largest <article>, then <main>
  const pick = tag => {
    const all = [...body.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map(m => m[1]);
    return all.sort((a, b) => b.length - a.length)[0];
  };
  const scope = pick("article") || pick("main") || body;

  // keep headings, paragraphs and list items as separate lines
  const blocks = [...scope.matchAll(/<(h[1-6]|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map(m => strip(m[2]))
    .filter(t => t.length > 1);
  // paragraphs with few words are usually buttons, captions or share links
  const words = t => (t.match(/[A-Za-z]+/g) || []).length;
  let text = blocks.filter((t, i) => words(t) >= 6 || /[.!?"”]$/.test(t) || (i > 0 && words(t) >= 3)).join("\n\n");
  if (text.length < 200) text = strip(scope.replace(/<\/(p|div|li|h[1-6]|br)>/gi, "\n")).replace(/\n\s*\n+/g, "\n\n");
  return { title, text: text.trim() };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "GET only" });
  const user = await requireUser(req, res); if (!user) return;
  const raw = String(new URL(req.url, "http://x").searchParams.get("url") || "").trim();
  if (!isPublicHttpUrl(raw)) return send(res, 400, { error: "記事のURL（https://…）を確認してください" });

  try {
    const r = await fetch(raw, { headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    if (!isPublicHttpUrl(r.url)) return send(res, 400, { error: "このURLは読み込めません" });
    if (!r.ok) return send(res, 502, { error: `記事を開けませんでした（${r.status}）。会員限定のページかもしれません。本文をコピーして貼り付けてください` });
    const type = r.headers.get("content-type") || "";
    if (!/html|xml|text\/plain/i.test(type)) return send(res, 415, { error: "Webページではないようです。PDFなどのファイルは「ファイル」から読み込んでください" });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) return send(res, 413, { error: "ページが大きすぎて読み込めません" });
    const html = buf.toString("utf8");
    const { title, text } = /text\/plain/i.test(type) ? { title: "", text: html } : extractArticle(html);
    if (text.length < 200) return send(res, 422, { error: "本文を取り出せませんでした。ページの本文をコピーして貼り付けてください", title });
    send(res, 200, { title: title || new URL(r.url).hostname, text: text.slice(0, 150000), url: r.url });
  } catch (e) {
    const timeout = e.name === "TimeoutError" || e.name === "AbortError";
    send(res, 502, { error: timeout ? "記事の読み込みに時間がかかりすぎました。もう一度お試しください" : "記事を読み込めませんでした。本文をコピーして貼り付けてください" });
  }
}
