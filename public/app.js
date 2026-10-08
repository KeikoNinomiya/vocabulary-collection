// Vocabulary Collection — front end (no build step).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

/* ---------- constants & helpers ---------- */
const INTERVALS = [1, 3, 7, 14, 30];        // days after each "覚えた"
const MASTER_STEP = 4;                       // passed the 7-day review → Mastered
const STATUS = { "Not yet": "notyet", "Fuzzy": "fuzzy", "Mastered": "mastered" };
const STATUS_JA = { "Not yet": "未定着", "Fuzzy": "あいまい", "Mastered": "定着" };
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const addDays = (n, from = new Date()) => { const d = new Date(from); d.setHours(12); d.setDate(d.getDate() + n); return ymd(d); };
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const ytId = url => { const m = String(url || "").match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : null; };
const ytLink = id => `https://youtu.be/${id}`;
const short = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const toast = msg => { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3000); };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/* phrase → regex that finds it inside the example sentence */
const STOP = new Set(["someone", "something", "sb", "sth", "a", "an", "the", "to", "of", "verb", "~", "…", "..."]);
function phraseTokens(p) {
  return String(p || "").replace(/\(.*?\)/g, " ").replace(/[~…+]/g, " ").split(/\s+/).map(w => w.toLowerCase().replace(/[^a-z'-]/g, "")).filter(w => w && !STOP.has(w));
}
const stem = w => w.length > 5 ? w.slice(0, w.length - 2) : w.length > 3 ? w.slice(0, w.length - 1) : w;
function hlRegex(p) {
  const toks = phraseTokens(p);
  if (!toks.length) return null;
  return new RegExp("\\b(" + toks.map(t => stem(t).replace(/[-']/g, "[-' ]?")).join("|") + ")[a-z'-]*", "gi");
}
function highlight(text, phrase) { const re = hlRegex(phrase), safe = esc(text); return re ? safe.replace(re, m => `<mark class="hl">${m}</mark>`) : safe; }
function blanked(text, phrase) {
  const re = hlRegex(phrase); if (!re) return null;
  let hit = false;
  const out = esc(text).replace(re, () => { hit = true; return `<span class="blank">&nbsp;</span>`; });
  return hit ? out : null;
}

/* speech */
const SPK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const canSpeak = "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";
function speak(text) {
  if (!canSpeak || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/\((.*?)\)/g, "$1").replace(/[~…]/g, ""));
    u.lang = "en-US"; u.rate = 0.92;
    const v = speechSynthesis.getVoices().find(v => /^en(-|_)(US|GB)/i.test(v.lang)); if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch {}
}
const spkBtn = (text, label) => canSpeak && text ? `<button class="speak" data-say="${esc(text)}" aria-label="${label || "読み上げ"}">${SPK}</button>` : "";
document.addEventListener("click", e => { const b = e.target.closest("[data-say]"); if (b) { e.stopPropagation(); speak(b.dataset.say); } }, true);

/* ---------- state ---------- */
const S = {
  tab: (location.hash || "").replace("#", "") || "today",
  cards: new Map(), videos: new Map(), ready: false, sb: null, cfg: null, user: null, online: navigator.onLine,
  bookFilter: lsGet("vc.filter", "all"), bookSource: "all", bookQuery: "", bookSort: lsGet("vc.sort", "new"), editing: null, confirmDel: null,
  session: null, video: lsGet("vc.videoDraft", { url: "", transcript: "" }), videoResult: null, busy: false, fetching: false,
  sessionSize: lsGet("vc.size", 20), authMode: "login", authErr: "", pushState: "unknown"
};
if (!["today", "video", "book", "add"].includes(S.tab)) S.tab = "today";

const cardsArr = () => [...S.cards.values()];
const dueCards = () => { const t = today(); return cardsArr().filter(c => (c.due || "") <= t); };
const counts = () => { const r = { "Not yet": 0, "Fuzzy": 0, "Mastered": 0 }; cardsArr().forEach(c => r[c.status] = (r[c.status] || 0) + 1); return r; };
const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");

/* ---------- rows ↔ cards ---------- */
const toRow = c => ({
  id: c.id, phrase: c.phrase, meaning: c.meaning || "", example: c.example || "", translation: c.translation || "",
  source: c.source || "", source_title: c.sourceTitle || "", source_type: c.sourceType || "manual", note: c.note || "",
  status: c.status, step: c.step || 0, due: c.due, reviews: c.reviews || 0, lapses: c.lapses || 0,
  last_reviewed: c.lastReviewed ? new Date(c.lastReviewed).toISOString() : null,
  created_at: new Date(c.createdAt || Date.now()).toISOString(), updated_at: new Date(c.updatedAt || Date.now()).toISOString()
});
const fromRow = r => ({
  id: r.id, phrase: r.phrase, meaning: r.meaning, example: r.example, translation: r.translation, source: r.source,
  sourceTitle: r.source_title, sourceType: r.source_type, note: r.note, status: r.status, step: r.step, due: r.due,
  reviews: r.reviews, lapses: r.lapses, lastReviewed: r.last_reviewed ? Date.parse(r.last_reviewed) : null,
  createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at)
});

/* ---------- persistence: Supabase + local copy + offline queue ---------- */
const cacheKey = () => "vc.cache." + (S.user?.id || "anon");
const pendKey = () => "vc.pending." + (S.user?.id || "anon");
const cacheCards = () => lsSet(cacheKey(), cardsArr());
const pending = () => lsGet(pendKey(), {});
const setPending = p => { lsSet(pendKey(), p); renderHeader(); };
const markPending = (id, op) => { const p = pending(); p[id] = op; setPending(p); };

async function pushOne(id, op) {
  if (op === "del") { const { error } = await S.sb.from("cards").delete().eq("id", id); if (error) throw error; return; }
  const c = S.cards.get(id); if (!c) return;
  const { error } = await S.sb.from("cards").upsert(toRow(c)); if (error) throw error;
}
async function flushPending() {
  if (!S.sb || !S.user || !navigator.onLine || flushPending.busy) return;
  const ids = Object.keys(pending()); if (!ids.length) return;
  flushPending.busy = true;
  for (const id of ids) {
    try { await pushOne(id, pending()[id]); const q = pending(); delete q[id]; setPending(q); }
    catch { break; }
  }
  flushPending.busy = false;
}
async function saveCard(c) {
  c.updatedAt = Date.now();
  S.cards.set(c.id, c); cacheCards(); updateAppBadge();
  if (!navigator.onLine) { markPending(c.id, "set"); return; }
  try { await pushOne(c.id, "set"); } catch { markPending(c.id, "set"); }
}
async function deleteCard(id) {
  S.cards.delete(id); cacheCards(); updateAppBadge();
  if (!navigator.onLine) { markPending(id, "del"); return; }
  try { await pushOne(id, "del"); } catch { markPending(id, "del"); }
}
async function loadCards() {
  if (!S.sb || !navigator.onLine) return;
  const rows = []; let from = 0;
  while (true) {
    const { data, error } = await S.sb.from("cards").select("*").order("created_at").range(from, from + 999);
    if (error) { toast("単語帳を読み込めませんでした: " + error.message); return; }
    rows.push(...data); if (data.length < 1000) break; from += 1000;
  }
  const p = pending(), next = new Map(rows.map(r => [r.id, fromRow(r)]));
  S.cards.forEach((c, id) => { const k = next.get(id); if (p[id] === "set" || (k && (c.updatedAt || 0) > (k.updatedAt || 0))) next.set(id, c); });
  Object.keys(p).forEach(id => { if (p[id] === "del") next.delete(id); });
  S.cards = next; S.ready = true; cacheCards(); updateAppBadge();
  flushPending();
}
async function loadVideos() {
  if (!S.sb || !navigator.onLine) return;
  const { data } = await S.sb.from("videos").select("id,video_id,url,title,summary,points,phrases,created_at").order("created_at", { ascending: false }).limit(100);
  if (data) S.videos = new Map(data.map(v => [v.id, { ...v, videoId: v.video_id, createdAt: Date.parse(v.created_at) }]));
}
async function refresh() { await Promise.all([loadCards(), loadVideos()]); if (!S.session && !typing()) render(); else renderHeader(); }

function newCard(f) {
  return { id: uuid(), phrase: f.phrase.trim(), meaning: (f.meaning || "").trim(), example: (f.example || "").trim(), translation: (f.translation || "").trim(),
    source: (f.source || "").trim(), sourceTitle: (f.sourceTitle || "").trim(), sourceType: f.sourceType || "manual", note: (f.note || "").trim(),
    status: "Not yet", step: 0, due: today(), reviews: 0, lapses: 0, lastReviewed: null, createdAt: Date.now(), updatedAt: Date.now() };
}
const findDupe = phrase => { const k = phraseTokens(phrase).join(" "); return cardsArr().find(c => phraseTokens(c.phrase).join(" ") === k); };

function updateAppBadge() {
  try { const n = dueCards().length; if (navigator.setAppBadge) n ? navigator.setAppBadge(n) : navigator.clearAppBadge?.(); } catch {}
}

/* server calls */
async function api(path, opts = {}) {
  const { data } = await S.sb.auth.getSession();
  const r = await fetch(path, { ...opts, headers: { ...(opts.headers || {}), Authorization: "Bearer " + (data.session?.access_token || ""), ...(opts.body ? { "Content-Type": "application/json" } : {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `エラー (${r.status})`), { status: r.status, data: j });
  return j;
}

/* spaced-repetition grade */
function grade(c, g) {
  c.reviews = (c.reviews || 0) + 1; c.lastReviewed = Date.now();
  if (g === "again") { c.step = 0; c.lapses = (c.lapses || 0) + 1; c.due = today(); c.status = "Not yet"; }
  else if (g === "hard") { c.step = Math.max(1, Math.min(c.step || 0, 2)); c.due = addDays(1); c.status = "Fuzzy"; }
  else { c.step = (c.step || 0) + 1; c.due = addDays(INTERVALS[Math.min(c.step - 1, INTERVALS.length - 1)]); c.status = c.step >= MASTER_STEP ? "Mastered" : "Fuzzy"; }
  return c;
}
const nextLabel = (c, g) => g === "again" ? "今日もう一度" : g === "hard" ? "1日後" : INTERVALS[Math.min((c.step || 0), INTERVALS.length - 1)] + "日後";

/* ---------- render: shell ---------- */
function setTab(t) { S.tab = t; S.editing = null; S.confirmDel = null; try { history.replaceState(null, "", "#" + t); } catch {} render(); window.scrollTo(0, 0); }
document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => { S.session = null; setTab(b.dataset.tab); }));

function renderHeader() {
  document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === S.tab)));
  $("#tabs").hidden = !S.user;
  const d = dueCards().length, badge = $("#dueBadge");
  badge.hidden = !S.ready || d === 0; badge.textContent = d;
  const np = Object.keys(pending()).length;
  $("#meta").innerHTML = !S.user ? "" : !S.ready ? "読み込み中…" :
    `${S.cards.size} フレーズ${!navigator.onLine ? ` <span class="sync">· オフライン</span>` : ""}${np ? ` <span class="sync">· 未同期 ${np}</span>` : ""}`;
}
function render() {
  renderHeader();
  const m = $("#main");
  if (!S.user) return renderAuth(m);
  if (S.session) return renderSession(m);
  ({ today: renderToday, video: renderVideo, book: renderBook, add: renderAdd })[S.tab](m);
}

/* ---------- login ---------- */
function renderAuth(m) {
  const signup = S.authMode === "signup";
  m.innerHTML = `<form class="auth panel" id="authf" autocomplete="on">
    <div><h2>${signup ? "アカウントを作成" : "ログイン"}</h2><p class="muted" style="margin:0">${signup ? "最初の1回だけ。メールアドレスとパスワードを決めてください。" : "単語帳はあなたのアカウントに保存されます。"}</p></div>
    <label class="f">メールアドレス<input type="email" id="aemail" name="email" required autocomplete="email" inputmode="email" style="font:inherit;width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)"></label>
    <label class="f">パスワード（8文字以上）<input type="password" id="apass" name="password" required minlength="8" autocomplete="${signup ? "new-password" : "current-password"}" style="font:inherit;width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)"></label>
    ${S.authErr ? `<p class="err">${esc(S.authErr)}</p>` : ""}
    <button class="btn primary" type="submit" id="asub">${signup ? "作成してはじめる" : "ログイン"}</button>
    <button class="switch" type="button" id="aswitch">${signup ? "アカウントがある方はこちら（ログイン）" : "はじめての方はこちら（アカウントを作成）"}</button>
  </form>`;
  $("#aswitch").onclick = () => { S.authMode = signup ? "login" : "signup"; S.authErr = ""; render(); };
  $("#authf").onsubmit = async e => {
    e.preventDefault();
    const email = $("#aemail").value.trim(), password = $("#apass").value;
    $("#asub").disabled = true; S.authErr = "";
    const { data, error } = signup ? await S.sb.auth.signUp({ email, password }) : await S.sb.auth.signInWithPassword({ email, password });
    if (error) {
      S.authErr = /Invalid login/i.test(error.message) ? "メールアドレスかパスワードが違います" : /not confirmed/i.test(error.message) ? "確認メールのリンクを開いてからログインしてください" : /signups not allowed|Signups not allowed/i.test(error.message) ? "新規登録は停止されています" : error.message;
      render(); return;
    }
    if (signup && !data.session) { S.authMode = "login"; S.authErr = "確認メールを送りました。メールのリンクを開いてからログインしてください。"; render(); }
  };
}

/* ---------- 今日の復習 ---------- */
function renderToday(m) {
  if (!S.ready) { m.innerHTML = `<div class="empty">単語帳を読み込んでいます…</div>`; return; }
  const settings = settingsHTML();
  if (!S.cards.size) {
    m.innerHTML = `<div class="stack"><div class="empty"><h2>まだフレーズがありません</h2><p>「動画から学ぶ」でYouTubeから抽出するか、「登録」で自分で追加しましょう。今までの単語帳は「単語帳」タブのCSV取り込みで移せます。</p><div class="row" style="justify-content:center"><button class="btn primary" data-go="add">最初のフレーズを登録</button><button class="btn" data-go="book">CSVを取り込む</button></div></div>${settings}</div>`;
    m.querySelectorAll("[data-go]").forEach(b => b.onclick = () => setTab(b.dataset.go)); bindSettings(m); return;
  }
  const due = dueCards(), c = counts();
  const week = [...Array(7)].map((_, i) => { const d = addDays(i); return { d, n: cardsArr().filter(x => i === 0 ? x.due <= d : x.due === d).length, label: i === 0 ? "今日" : i === 1 ? "明日" : ["日", "月", "火", "水", "木", "金", "土"][new Date(d + "T12:00").getDay()] }; });
  const max = Math.max(1, ...week.map(w => w.n));
  m.innerHTML = `
  <div class="stack">
    <section class="panel duehero">
      <div><div class="label">Due today</div><div class="num">${due.length}</div><div class="muted">今日復習するフレーズ</div></div>
      <div style="flex:1;min-width:220px">
        <div class="label">これからの予定</div>
        <div class="week">${week.map(w => `<div><div class="bar"><i style="height:${Math.round(w.n / max * 100)}%"></i></div><b>${w.n}</b>${w.label}</div>`).join("")}</div>
      </div>
    </section>
    <div class="statbar">${Object.keys(STATUS).map(k => `<div class="stat ${STATUS[k]}"><b>${c[k] || 0}</b><span>${STATUS_JA[k]}</span></div>`).join("")}</div>
    <section class="stack">
      <div class="row" style="justify-content:space-between"><h3 style="margin:0">復習モード</h3>
        <label class="row muted" style="font-size:13px">1回の枚数 <select id="sz" style="width:auto;padding:4px 8px">${[10, 20, 30, 0].map(n => `<option value="${n}" ${n === S.sessionSize ? "selected" : ""}>${n || "全部"}</option>`).join("")}</select></label></div>
      <div class="modes">
        <button class="mode" data-mode="flash"><strong>フラッシュカード</strong><span>英語を見て意味を思い出す</span></button>
        <button class="mode" data-mode="reverse"><strong>逆引きカード</strong><span>日本語訳から英語フレーズを思い出す</span></button>
        <button class="mode" data-mode="meaning"><strong>意味クイズ</strong><span>4択で意味を選ぶ</span></button>
        <button class="mode" data-mode="cloze"><strong>穴埋めクイズ</strong><span>例文の空欄に入るフレーズを選ぶ</span></button>
      </div>
      <p class="muted" style="font-size:13px;margin:0">${due.length ? "期限が来たフレーズ（未定着を優先）から出題します。" : "今日の復習は完了です。続ける場合は「あいまい」「未定着」から出題します。"}「覚えた」で次回は 1日後 → 3日後 → 7日後 → 14日後 → 30日後 と伸び、7日後の復習を通過すると「定着」です。</p>
    </section>
    ${settings}
  </div>`;
  $("#sz").onchange = e => { S.sessionSize = +e.target.value; lsSet("vc.size", S.sessionSize); };
  m.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => startSession(b.dataset.mode));
  bindSettings(m);
}

/* settings: notifications, account */
function settingsHTML() {
  const pushOK = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  let note = "";
  if (isIOS() && !isStandalone()) note = "iPhoneでは、Safariの共有ボタン →「ホーム画面に追加」で入れたアプリから開くと通知をオンにできます。";
  else if (!pushOK) note = "この端末・ブラウザは通知に対応していません。";
  else if (Notification.permission === "denied") note = "通知が拒否されています。iPhoneの「設定」→「通知」→ Vocabulary から許可してください。";
  const on = S.pushState === "on";
  return `<section class="panel" style="padding-block:6px">
    <div class="setrow"><div><strong style="font-size:14px">毎朝の復習通知</strong><p>${note || "毎朝8時ごろ、その日の復習枚数をお知らせします。"}</p></div>
      ${note ? "" : on ? `<span class="row"><span class="ok">オン</span><button class="btn small ghost" id="ptest">テスト送信</button><button class="btn small ghost" id="poff">オフにする</button></span>` : `<button class="btn small primary" id="pon">通知をオンにする</button>`}</div>
    <div class="setrow"><div><strong style="font-size:14px">アカウント</strong><p>${esc(S.user?.email || "")}</p></div><button class="btn small ghost" id="logout">ログアウト</button></div>
  </section>`;
}
function bindSettings(m) {
  const on = $("#pon", m), off = $("#poff", m), test = $("#ptest", m);
  if (on) on.onclick = enablePush;
  if (off) off.onclick = disablePush;
  if (test) test.onclick = async () => { test.disabled = true; try { const r = await api("/api/push-test", { method: "POST", body: "{}" }); toast(r.sent ? "テスト通知を送りました" : "送り先の端末が見つかりませんでした"); } catch (e) { toast(e.message); } test.disabled = false; };
  $("#logout", m).onclick = async () => { await S.sb.auth.signOut(); };
}
function b64ToBytes(b64) { const pad = "=".repeat((4 - b64.length % 4) % 4); const s = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, c => c.charCodeAt(0)); }
async function checkPush() {
  try { const reg = await navigator.serviceWorker?.getRegistration(); const sub = await reg?.pushManager?.getSubscription(); S.pushState = sub && Notification.permission === "granted" ? "on" : "off"; } catch { S.pushState = "off"; }
}
async function enablePush() {
  try {
    if (!S.cfg?.vapidPublicKey) { toast("通知用の鍵（VAPID_PUBLIC_KEY）が設定されていません"); return; }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("通知が許可されませんでした"); render(); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(S.cfg.vapidPublicKey) });
    const j = sub.toJSON();
    const { error } = await S.sb.from("push_subscriptions").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
    if (error) throw error;
    S.pushState = "on"; toast("通知をオンにしました"); render();
  } catch (e) { toast("通知をオンにできませんでした: " + (e.message || e)); }
}
async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (sub) { await S.sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
    S.pushState = "off"; toast("通知をオフにしました"); render();
  } catch (e) { toast(e.message || String(e)); }
}

/* ---------- study session ---------- */
function pickQueue(pool) {
  const t = today(), order = { "Not yet": 0, "Fuzzy": 1, "Mastered": 2 };
  let due = pool.filter(c => c.due <= t);
  if (!due.length) due = pool.filter(c => c.status !== "Mastered");
  if (!due.length) due = pool;
  due = shuffle(due).sort((a, b) => (order[a.status] - order[b.status]) || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return S.sessionSize ? due.slice(0, S.sessionSize) : due;
}
function startSession(mode, pool) {
  let src = pool || cardsArr();
  if (mode === "cloze") src = src.filter(c => c.example && blanked(c.example, c.phrase));
  if (mode === "reverse") src = src.filter(c => c.translation || c.meaning);
  if (!src.length) { toast(mode === "cloze" ? "例文があるフレーズがまだありません。" : "出題できるフレーズがありません。"); return; }
  const queue = pool ? shuffle(src) : pickQueue(src);
  S.session = { mode, queue, i: 0, flipped: false, answered: null, results: { again: 0, hard: 0, good: 0 }, total: queue.length, retry: [] };
  render(); window.scrollTo(0, 0);
}
function renderSession(m) {
  const s = S.session;
  if (s.i >= s.queue.length) return renderDone(m);
  const c = s.queue[s.i];
  const head = `<div class="studyhead"><button class="btn ghost small" id="quit">← 終了</button><div class="progress"><i style="width:${Math.round(s.i / s.queue.length * 100)}%"></i></div><span class="label">${s.i + 1} / ${s.queue.length}</span></div>`;
  const srcLine = c.source ? (/^https?:/.test(c.source) ? `<a href="${esc(c.source)}" target="_blank" rel="noopener">${esc(c.sourceTitle || c.source)}</a>` : esc(c.source)) : "";
  const back = `<div class="back">
      <div class="meaning">${esc(c.meaning)}</div>
      ${c.example ? `<div class="quote">${highlight(c.example, c.phrase)} ${spkBtn(c.example, "例文を読み上げ")}</div>` : ""}
      ${c.translation ? `<div class="muted">${esc(c.translation)}</div>` : ""}
      ${c.note ? `<div class="muted" style="font-size:13px">メモ: ${esc(c.note)}</div>` : ""}
      ${srcLine ? `<div class="src">出典: ${srcLine}</div>` : ""}
    </div>`;
  const gradesHTML = `<div class="grades">
      <button class="grade again" data-g="again"><b>わからない</b><small>${nextLabel(c, "again")} · 1</small></button>
      <button class="grade hard" data-g="hard"><b>あいまい</b><small>${nextLabel(c, "hard")} · 2</small></button>
      <button class="grade good" data-g="good"><b>覚えた</b><small>${nextLabel(c, "good")} · 3</small></button></div>
      <div class="swipehint"><span>← スワイプでわからない</span><span>スワイプで覚えた →</span></div>`;
  let body = "";
  if (s.mode === "flash" || s.mode === "reverse") {
    const front = s.mode === "flash"
      ? `<div class="row" style="justify-content:space-between"><span class="pill ${STATUS[c.status]}">${STATUS_JA[c.status]}</span><span class="label">EN → JA</span></div>
         <div class="phrase">${esc(c.phrase)} ${spkBtn(c.phrase)}</div>
         ${c.example && !s.flipped ? `<div class="quote it muted">${highlight(c.example, c.phrase)}</div>` : ""}`
      : `<div class="row" style="justify-content:space-between"><span class="pill ${STATUS[c.status]}">${STATUS_JA[c.status]}</span><span class="label">JA → EN</span></div>
         <div class="meaning" style="font-size:20px">${esc(c.translation || c.meaning)}</div>
         ${c.translation ? `<div class="muted">ヒント: ${esc(short(c.meaning, 60))}</div>` : ""}
         ${s.flipped ? `<div class="phrase">${esc(c.phrase)} ${spkBtn(c.phrase)}</div>` : ""}`;
    const backR = `<div class="back">${c.example ? `<div class="quote">${highlight(c.example, c.phrase)} ${spkBtn(c.example, "例文を読み上げ")}</div>` : ""}<div class="meaning">${esc(c.meaning)}</div></div>`;
    body = `<div class="fc" id="card" tabindex="0" role="button" aria-label="カードをめくる">${front}${s.flipped ? (s.mode === "flash" ? back : backR) : `<div class="hint">タップで答えを見る</div>`}</div>${s.flipped ? gradesHTML : ""}`;
  } else {
    if (!s.choices) s.choices = buildChoices(c, s.mode);
    const prompt = s.mode === "meaning"
      ? `<span class="label">このフレーズの意味は？</span><div class="phrase">${esc(c.phrase)} ${spkBtn(c.phrase)}</div>${c.example ? `<div class="quote it muted">${highlight(c.example, c.phrase)}</div>` : ""}`
      : `<span class="label">空欄に入るフレーズは？</span><div class="quote">${blanked(c.example, c.phrase)}</div>${c.translation ? `<div class="muted" style="font-size:14px">${esc(c.translation)}</div>` : ""}`;
    body = `<div class="fc" style="cursor:default">${prompt}
      <div class="choices">${s.choices.map((ch, k) => {
        const cls = s.answered == null ? "" : ch.id === c.id ? "right" : k === s.answered ? "wrong" : "";
        return `<button class="choice ${cls}" data-k="${k}" ${s.answered != null ? "disabled" : ""}><span class="kbd">${k + 1}</span> ${esc(ch.label)}</button>`; }).join("")}</div>
      ${s.answered != null ? back : ""}</div>
      ${s.answered != null ? `<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn primary" id="next">次へ</button></div>` : ""}`;
  }
  m.innerHTML = head + body;
  $("#quit").onclick = () => { S.session = null; render(); };
  m.querySelectorAll("[data-g]").forEach(b => b.onclick = () => doGrade(b.dataset.g));
  m.querySelectorAll("[data-k]").forEach(b => b.onclick = () => answer(+b.dataset.k));
  const nx = $("#next"); if (nx) nx.onclick = nextQuiz;
  const cardEl = $("#card");
  if (cardEl) {
    cardEl.onclick = () => { if (cardEl._swiped) return; if (!s.flipped) { s.flipped = true; render(); } };
    let x0 = null, dx = 0;
    cardEl.addEventListener("pointerdown", e => { if (!s.flipped || e.target.closest("button")) return; x0 = e.clientX; dx = 0; cardEl.classList.add("dragging"); });
    cardEl.addEventListener("pointermove", e => { if (x0 == null) return; dx = e.clientX - x0; cardEl.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`;
      cardEl.style.backgroundColor = dx > 60 ? "var(--mastered-bg)" : dx < -60 ? "var(--notyet-bg)" : ""; });
    const end = () => { if (x0 == null) return; x0 = null; cardEl.classList.remove("dragging");
      if (Math.abs(dx) > 90) { cardEl._swiped = true; doGrade(dx > 0 ? "good" : "again"); } else { cardEl.style.transform = ""; cardEl.style.backgroundColor = ""; } };
    cardEl.addEventListener("pointerup", end); cardEl.addEventListener("pointercancel", end);
  }
}
function buildChoices(c, mode) {
  const others = shuffle(cardsArr().filter(x => x.id !== c.id && (mode === "meaning" ? x.meaning && x.meaning !== c.meaning : x.phrase)));
  const label = x => mode === "meaning" ? short(x.meaning, 70) : x.phrase.replace(/\s*\((verb|noun)\)\s*/i, "");
  return shuffle([c, ...others.slice(0, 3)]).map(x => ({ id: x.id, label: label(x) }));
}
function answer(k) {
  const s = S.session; if (s.answered != null) return;
  s.answered = k; const c = s.queue[s.i];
  const ok = s.choices[k].id === c.id;
  const g = !ok ? "again" : (c.status === "Not yet" && (c.reviews || 0) === 0 ? "hard" : "good");
  s.results[g]++; if (!ok) s.retry.push(c);
  saveCard(grade(c, g)); render();
}
function nextQuiz() { const s = S.session; s.i++; s.answered = null; s.choices = null; render(); }
function doGrade(g) {
  const s = S.session, c = s.queue[s.i];
  s.results[g]++;
  if (g === "again") s.retry.push(c);
  saveCard(grade(c, g));
  s.i++; s.flipped = false; render();
}
function renderDone(m) {
  const s = S.session, r = s.results, left = dueCards().length;
  m.innerHTML = `<div class="panel stack" style="text-align:center;padding:32px 20px">
    <div class="label">Session complete</div><h2>${s.total} 枚 おつかれさまでした</h2>
    <div class="statbar" style="max-width:420px;margin:8px auto">
      <div class="stat mastered"><b>${r.good}</b><span>覚えた</span></div><div class="stat fuzzy"><b>${r.hard}</b><span>あいまい</span></div><div class="stat notyet"><b>${r.again}</b><span>わからない</span></div></div>
    <p class="muted" style="margin:0">今日の残り: ${left} 枚</p>
    <div class="row" style="justify-content:center">
      ${s.retry.length ? `<button class="btn primary" id="retry">間違えた ${s.retry.length} 枚をもう一度</button>` : ""}
      ${left ? `<button class="btn ${s.retry.length ? "" : "primary"}" id="more">続けて復習する</button>` : ""}
      <button class="btn ghost" id="home">ホームへ</button></div></div>`;
  const mode = s.mode;
  if ($("#retry")) $("#retry").onclick = () => startSession(mode, s.retry);
  if ($("#more")) $("#more").onclick = () => startSession(mode);
  $("#home").onclick = () => { S.session = null; render(); };
}
document.addEventListener("keydown", e => {
  if (!S.session || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const s = S.session; if (s.i >= s.queue.length) return;
  if (s.mode === "flash" || s.mode === "reverse") {
    if (!s.flipped && (e.key === " " || e.key === "Enter")) { e.preventDefault(); s.flipped = true; render(); }
    else if (s.flipped && ["1", "2", "3"].includes(e.key)) doGrade(["again", "hard", "good"][+e.key - 1]);
  } else {
    if (s.answered == null && ["1", "2", "3", "4"].includes(e.key)) answer(+e.key - 1);
    else if (s.answered != null && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); nextQuiz(); }
  }
});

/* ---------- 動画から学ぶ ---------- */
function renderVideo(m) {
  const v = S.video, r = S.videoResult, id = ytId(v.url);
  const past = [...S.videos.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const aiOK = S.cfg?.ai !== false;
  m.innerHTML = `
  <div class="stack">
    <div><h2>動画から学ぶ</h2><p class="lede">YouTubeのリンクから字幕を取り込み、要約と覚えるべきフレーズを作ります。</p></div>
    <section class="panel stack">
      <label class="f">YouTube のリンク<input type="url" id="vurl" placeholder="https://youtu.be/…" value="${esc(v.url)}" inputmode="url"></label>
      <div class="row">
        <button class="btn" id="vfetch" ${!id || S.fetching || !navigator.onLine ? "disabled" : ""}>${S.fetching ? "字幕を取得中…" : "字幕を自動で取得"}</button>
        ${id ? `<a class="btn small ghost" href="${ytLink(id)}" target="_blank" rel="noopener">YouTubeで開く</a>` : ""}
      </div>
      <details ${v.transcript ? "" : ""}><summary>自動で取れないときは（字幕の貼り付け方）</summary>
        <ol class="steps"><li>PCのブラウザでYouTubeの動画を開き、概要欄の下の「文字起こしを表示」を押す</li><li>右側に出た文字起こしをすべて選択してコピーし、下に貼り付ける</li></ol></details>
      <label class="f">字幕テキスト<textarea id="vtr" rows="7" placeholder="自動取得した字幕、または貼り付けた字幕">${esc(v.transcript)}</textarea></label>
      <div class="row" style="justify-content:space-between"><span class="muted" style="font-size:12px;font-family:var(--f-mono)" id="vlen">${v.transcript.length.toLocaleString()} 文字</span>
        <button class="btn primary" id="vgo" ${S.busy || !aiOK || !navigator.onLine ? "disabled" : ""}>${S.busy ? "分析中…" : "要約してフレーズを抽出"}</button></div>
      ${!aiOK ? `<p class="muted" style="font-size:13px;margin:0">要約にはVercelの環境変数 GEMINI_API_KEY が必要です。</p>` : ""}
      ${S.busy ? `<p class="muted" style="font-size:13px;margin:0">AI が字幕を読んでいます。長い動画は1分ほどかかります。</p>` : ""}
    </section>
    ${r ? renderVideoResult(r) : ""}
    ${past.length ? `<section class="panel"><h3>これまでの動画</h3><div class="vlist">${past.map(p => `<div class="vitem"><span class="t">${esc(p.title || p.url)}</span><span class="row" style="flex-wrap:nowrap"><span class="muted" style="font-family:var(--f-mono);font-size:12px">${cardsArr().filter(c => c.source && ytId(c.source) === p.videoId).length}語</span><button class="btn small" data-open="${esc(p.id)}">開く</button></span></div>`).join("")}</div></section>` : ""}
  </div>`;
  const persist = () => lsSet("vc.videoDraft", S.video);
  $("#vurl").oninput = e => { v.url = e.target.value; persist(); $("#vfetch").disabled = !ytId(v.url) || S.fetching; };
  $("#vtr").oninput = e => { v.transcript = e.target.value; $("#vlen").textContent = v.transcript.length.toLocaleString() + " 文字"; persist(); };
  $("#vfetch").onclick = fetchTranscript;
  $("#vgo").onclick = analyze;
  m.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openPastVideo(b.dataset.open));
  if (r) bindVideoResult(m, r);
}
async function fetchTranscript() {
  const id = ytId(S.video.url); if (!id) return;
  S.fetching = true; render();
  try {
    const j = await api("/api/transcript?v=" + id);
    S.video.transcript = j.text; S.video.title = j.title; lsSet("vc.videoDraft", S.video);
    toast(`字幕を取得しました${j.auto ? "（自動生成の字幕）" : ""}`);
  } catch (e) { toast(e.message); }
  S.fetching = false; render();
}
function renderVideoResult(r) {
  return `<section class="panel result" id="vres">
    <div><div class="label">要約</div><h3 style="font-size:20px;margin-top:4px">${esc(r.title)}</h3><p style="margin:0">${esc(r.summary)}</p></div>
    ${r.points?.length ? `<div><div class="label">ポイント</div><ul class="points">${r.points.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}
    ${r.phrases?.length ? `<div>
      <div class="row" style="justify-content:space-between"><div class="label">抽出したフレーズ（${r.phrases.length}）</div>
        <div class="row"><button class="btn small ghost" id="selAll">すべて選択</button><button class="btn small ghost" id="selNone">選択解除</button></div></div>
      <div>${r.phrases.map((p, i) => { const d = findDupe(p.phrase); return `<div class="cand">
        <input type="checkbox" data-i="${i}" ${p.pick ? "checked" : ""} aria-label="${esc(p.phrase)} を保存">
        <div class="ed"><input type="text" data-f="phrase" data-i="${i}" value="${esc(p.phrase)}" style="font-weight:700">
          <input type="text" data-f="meaning" data-i="${i}" value="${esc(p.meaning)}">
          <textarea data-f="example" data-i="${i}">${esc(p.example)}</textarea>
          <input type="text" data-f="translation" data-i="${i}" value="${esc(p.translation)}">
          ${d ? `<span class="dupe">単語帳に登録済み: ${esc(d.phrase)}（${STATUS_JA[d.status]}）</span>` : ""}</div></div>`; }).join("")}</div>
      <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn primary" id="savePicked">選んだフレーズを単語帳に保存</button></div>
    </div>` : ""}
    ${r.transcript ? `<details><summary>字幕を読む（抽出フレーズに印）</summary><div class="transcript">${markTranscript(r.transcript, r.phrases || [])}</div></details>` : ""}
  </section>`;
}
function markTranscript(t, phrases) {
  let html = esc(t);
  phrases.forEach(p => { const re = hlRegex(p.phrase); if (re) html = html.replace(re, m => `<mark class="hl">${m}</mark>`); });
  return html;
}
function bindVideoResult(m, r) {
  m.querySelectorAll(".cand input[type=checkbox]").forEach(cb => cb.onchange = () => r.phrases[+cb.dataset.i].pick = cb.checked);
  m.querySelectorAll(".cand [data-f]").forEach(inp => inp.oninput = () => r.phrases[+inp.dataset.i][inp.dataset.f] = inp.value);
  const all = v => { r.phrases.forEach(p => p.pick = v); render(); };
  if ($("#selAll")) $("#selAll").onclick = () => all(true);
  if ($("#selNone")) $("#selNone").onclick = () => all(false);
  if ($("#savePicked")) $("#savePicked").onclick = async () => {
    const picked = r.phrases.filter(p => p.pick && p.phrase.trim());
    if (!picked.length) { toast("保存するフレーズを選んでください。"); return; }
    let added = 0, skipped = 0;
    for (const p of picked) {
      if (findDupe(p.phrase)) { skipped++; continue; }
      await saveCard(newCard({ ...p, source: r.url, sourceTitle: r.title, sourceType: "video" })); added++;
    }
    r.phrases.forEach(p => p.pick = false);
    toast(`${added} 件を単語帳に保存しました${skipped ? `（登録済み ${skipped} 件はスキップ）` : ""}`);
    render();
  };
}
async function openPastVideo(id) {
  const p = S.videos.get(id); if (!p) return;
  let transcript = "";
  try { const { data } = await S.sb.from("videos").select("transcript").eq("id", id).single(); transcript = data?.transcript || ""; } catch {}
  S.videoResult = { ...p, transcript, phrases: (p.phrases || []).map(x => ({ ...x, pick: false })) };
  render(); $("#vres")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
async function analyze() {
  const v = S.video, id = ytId(v.url);
  if (!v.transcript.trim() || v.transcript.trim().length < 200) { toast("字幕を取得するか貼り付けてください（200文字以上）。"); return; }
  const tr = v.transcript.replace(/^\s*\d{1,2}:\d{2}(:\d{2})?\s*$/gm, "").replace(/\n{2,}/g, "\n").trim().slice(0, 150000);
  S.busy = true; render();
  try {
    const out = await api("/api/ai", { method: "POST", body: JSON.stringify({ mode: "analyze", transcript: tr, known: cardsArr().map(c => c.phrase) }) });
    const phrases = (Array.isArray(out?.phrases) ? out.phrases : []).filter(p => p && p.phrase).map(p => ({ phrase: String(p.phrase), meaning: String(p.meaning || ""), example: String(p.example || ""), translation: String(p.translation || ""), pick: !findDupe(p.phrase) }));
    const res = { id: uuid(), videoId: id, url: id ? ytLink(id) : v.url, title: String(out?.title || v.title || "無題の動画"), summary: String(out?.summary || ""), points: (out?.points || []).map(String), phrases, transcript: tr.slice(0, 120000), createdAt: Date.now() };
    S.videoResult = res; S.videos.set(res.id, res);
    const { error } = await S.sb.from("videos").insert({ id: res.id, video_id: id, url: res.url, title: res.title, summary: res.summary, points: res.points, phrases: phrases.map(({ pick, ...p }) => p), transcript: res.transcript });
    if (error) toast("要約の保存に失敗しました: " + error.message);
  } catch (e) { toast(e.message || "要約できませんでした。"); }
  finally { S.busy = false; render(); $("#vres")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
}

/* ---------- 単語帳 ---------- */
function renderBook(m) {
  if (!S.ready) { m.innerHTML = `<div class="empty">単語帳を読み込んでいます…</div>`; return; }
  const q = S.bookQuery.toLowerCase(), t = today();
  const vids = [...new Set(cardsArr().map(c => ytId(c.source)).filter(Boolean))];
  let list = cardsArr().filter(c =>
    (S.bookFilter === "all" || (S.bookFilter === "due" ? c.due <= t : c.status === S.bookFilter)) &&
    (S.bookSource === "all" || (S.bookSource === "manual" ? !ytId(c.source) : ytId(c.source) === S.bookSource.slice(3))) &&
    (!q || [c.phrase, c.meaning, c.example, c.translation, c.note].some(x => (x || "").toLowerCase().includes(q))));
  const sorters = { new: (a, b) => (b.createdAt || 0) - (a.createdAt || 0), az: (a, b) => a.phrase.localeCompare(b.phrase), due: (a, b) => (a.due || "").localeCompare(b.due || "") };
  list.sort(sorters[S.bookSort] || sorters.new);
  const c = counts();
  const vidTitle = vid => { const v = [...S.videos.values()].find(x => x.videoId === vid); const card = cardsArr().find(x => ytId(x.source) === vid && x.sourceTitle); return v?.title || card?.sourceTitle || "YouTube " + vid; };
  m.innerHTML = `
  <div class="row" style="justify-content:space-between;margin-bottom:14px"><h2 style="margin:0">単語帳</h2>
    <div class="row"><label class="btn small" for="imp">CSVを取り込む</label><input type="file" id="imp" accept=".csv,text/csv" hidden>
    <button class="btn small" id="exp">CSVで書き出す</button></div></div>
  <div class="filters">
    <input type="search" id="bq" placeholder="フレーズ・意味・例文を検索" value="${esc(S.bookQuery)}">
    <select id="bsrc" aria-label="出典"><option value="all">すべての出典</option><option value="manual" ${S.bookSource === "manual" ? "selected" : ""}>自分で登録</option>${vids.map(v => `<option value="yt:${v}" ${S.bookSource === "yt:" + v ? "selected" : ""}>${esc(short(vidTitle(v), 28))}</option>`).join("")}</select>
    <select id="bsort" aria-label="並び順"><option value="new" ${S.bookSort === "new" ? "selected" : ""}>新しい順</option><option value="az" ${S.bookSort === "az" ? "selected" : ""}>A→Z</option><option value="due" ${S.bookSort === "due" ? "selected" : ""}>復習日順</option></select>
  </div>
  <div class="chips">${[["all", `すべて ${S.cards.size}`], ["due", `今日の復習 ${dueCards().length}`], ...Object.keys(STATUS).map(k => [k, `${STATUS_JA[k]} ${c[k] || 0}`])].map(([k, l]) => `<button class="chip" data-f="${k}" aria-pressed="${S.bookFilter === k}">${l}</button>`).join("")}</div>
  <section class="panel" style="padding-block:4px">${list.length ? list.map(entryHTML).join("") : `<div class="empty">条件に合うフレーズはありません。</div>`}</section>
  ${list.length ? `<div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="studyList">この ${list.length} 件をフラッシュカードで復習</button></div>` : ""}`;
  $("#bq").oninput = e => { S.bookQuery = e.target.value; const pos = e.target.selectionStart; render(); const n = $("#bq"); n.focus(); n.setSelectionRange(pos, pos); };
  $("#bsrc").onchange = e => { S.bookSource = e.target.value; render(); };
  $("#bsort").onchange = e => { S.bookSort = e.target.value; lsSet("vc.sort", S.bookSort); render(); };
  m.querySelectorAll(".chip").forEach(b => b.onclick = () => { S.bookFilter = b.dataset.f; lsSet("vc.filter", S.bookFilter); render(); });
  if ($("#studyList")) $("#studyList").onclick = () => startSession("flash", list);
  $("#imp").onchange = importCSV;
  $("#exp").onclick = exportCSV;
  bindEntries(m);
}
function entryHTML(c) {
  const t = today(), dueTxt = c.due <= t ? "今日" : c.due;
  const src = c.source ? (/^https?:/.test(c.source) ? `<a href="${esc(c.source)}" target="_blank" rel="noopener">${esc(short(c.sourceTitle || c.source.replace(/^https?:\/\//, ""), 36))}</a>` : esc(short(c.source, 36))) : "自分で登録";
  const editing = S.editing === c.id;
  return `<div class="entry" data-id="${esc(c.id)}">
    <div class="h"><span class="p">${esc(c.phrase)} ${spkBtn(c.phrase)}</span><span class="pill ${STATUS[c.status]}">${STATUS_JA[c.status]}</span></div>
    <div class="m">${esc(c.meaning)}</div>
    ${c.example ? `<div class="ex">${highlight(c.example, c.phrase)}</div>` : ""}
    ${c.translation ? `<div class="muted" style="font-size:13px">${esc(c.translation)}</div>` : ""}
    <div class="foot"><span>次回 ${dueTxt}</span><span>復習 ${c.reviews || 0}回</span><span>${src}</span>
      <button class="btn small ghost" data-act="edit">${editing ? "閉じる" : "編集"}</button></div>
    ${editing ? `<div class="edit">
      <div class="grid2"><label class="f">フレーズ<input type="text" id="e-phrase" value="${esc(c.phrase)}"></label>
      <label class="f">ステータス<select id="e-status">${Object.keys(STATUS).map(k => `<option value="${k}" ${c.status === k ? "selected" : ""}>${STATUS_JA[k]}（${k}）</option>`).join("")}</select></label></div>
      <label class="f">意味・解説<input type="text" id="e-meaning" value="${esc(c.meaning)}"></label>
      <label class="f">例文<textarea id="e-example" rows="2">${esc(c.example)}</textarea></label>
      <label class="f">訳<input type="text" id="e-translation" value="${esc(c.translation)}"></label>
      <div class="grid2"><label class="f">出典（URLや場面）<input type="text" id="e-source" value="${esc(c.source)}"></label>
      <label class="f">メモ<input type="text" id="e-note" value="${esc(c.note)}"></label></div>
      <div class="row" style="justify-content:space-between">
        ${S.confirmDel === c.id ? `<span class="row"><span style="color:var(--notyet);font-size:13px">削除しますか？</span><button class="btn small" data-act="delyes" style="color:var(--notyet);border-color:var(--notyet)">削除する</button><button class="btn small ghost" data-act="delno">やめる</button></span>` : `<button class="btn small ghost" data-act="del" style="color:var(--notyet)">削除</button>`}
        <span class="row"><button class="btn small ghost" data-act="reset">復習をリセット</button><button class="btn small primary" data-act="save">保存</button></span></div>
    </div>` : ""}
  </div>`;
}
function bindEntries(m) {
  m.querySelectorAll(".entry [data-act]").forEach(b => b.onclick = async () => {
    const id = b.closest(".entry").dataset.id, c = S.cards.get(id), act = b.dataset.act;
    if (act === "edit") { S.editing = S.editing === id ? null : id; S.confirmDel = null; render(); }
    else if (act === "del") { S.confirmDel = id; render(); }
    else if (act === "delno") { S.confirmDel = null; render(); }
    else if (act === "delyes") { await deleteCard(id); S.editing = null; S.confirmDel = null; toast("削除しました"); render(); }
    else if (act === "reset") { Object.assign(c, { status: "Not yet", step: 0, due: today() }); await saveCard(c); toast("今日の復習に戻しました"); render(); }
    else if (act === "save") {
      const g = k => $("#e-" + k).value, st = g("status");
      if (!g("phrase").trim()) { toast("フレーズを入力してください"); return; }
      if (st !== c.status) { c.step = st === "Mastered" ? MASTER_STEP : st === "Fuzzy" ? 1 : 0; c.due = st === "Mastered" ? addDays(14) : today(); }
      Object.assign(c, { phrase: g("phrase").trim(), status: st, meaning: g("meaning").trim(), example: g("example").trim(), translation: g("translation").trim(), source: g("source").trim(), note: g("note").trim() });
      await saveCard(c); S.editing = null; toast("保存しました"); render();
    }
  });
}

/* CSV */
function parseCSV(text) {
  const rows = []; let row = [], f = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
async function importCSV(e) {
  const file = e.target.files[0]; if (!file) return;
  const rows = parseCSV(await file.text()); if (rows.length < 2) { toast("CSVに行がありません"); return; }
  const h = rows[0].map(x => x.trim().toLowerCase());
  const col = (...names) => h.findIndex(x => names.some(n => x === n.toLowerCase()));
  const ix = { status: col("status", "ステータス"), phrase: col("重要表現・フレーズ", "phrase", "word", "フレーズ"), meaning: col("解説", "meaning", "意味"), example: col("例", "example", "例文"), translation: col("訳", "translation"), source: col("引用元", "source", "出典"), title: col("出典タイトル", "source_title"), due: col("次回復習日", "due"), reviews: col("復習回数", "reviews"), step: col("step") };
  if (ix.phrase < 0) { toast("「重要表現・フレーズ」または phrase 列が見つかりません"); return; }
  const add = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const v = k => ix[k] >= 0 ? (r[ix[k]] || "").trim() : "";
    if (!v("phrase")) continue;
    if (findDupe(v("phrase")) || add.some(c => phraseTokens(c.phrase).join(" ") === phraseTokens(v("phrase")).join(" "))) { skipped++; continue; }
    const c = newCard({ phrase: v("phrase"), meaning: v("meaning"), example: v("example"), translation: v("translation"), source: v("source"), sourceTitle: v("title"), sourceType: ytId(v("source")) ? "video" : "manual" });
    const st = v("status");
    if (STATUS[st]) { c.status = st; c.step = st === "Mastered" ? MASTER_STEP : st === "Fuzzy" ? 1 : 0; c.due = st === "Mastered" ? addDays(7) : today(); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(v("due"))) c.due = v("due");
    if (/^\d+$/.test(v("reviews"))) c.reviews = +v("reviews");
    if (/^\d+$/.test(v("step"))) c.step = +v("step");
    c.createdAt = Date.now() + add.length; c.updatedAt = c.createdAt;
    add.push(c);
  }
  add.forEach(c => S.cards.set(c.id, c)); cacheCards();
  if (navigator.onLine) {
    for (let i = 0; i < add.length; i += 200) {
      const { error } = await S.sb.from("cards").upsert(add.slice(i, i + 200).map(toRow));
      if (error) { add.slice(i).forEach(c => markPending(c.id, "set")); break; }
    }
  } else add.forEach(c => markPending(c.id, "set"));
  e.target.value = "";
  toast(`${add.length} 件を取り込みました${skipped ? `（重複 ${skipped} 件はスキップ）` : ""}`); updateAppBadge(); render();
}
function exportCSV() {
  const q = s => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = [["Status", "重要表現・フレーズ", "解説", "例", "訳", "引用元", "出典タイトル", "次回復習日", "復習回数", "step"].join(",")];
  cardsArr().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).forEach(c => lines.push([c.status, c.phrase, c.meaning, c.example, c.translation, c.source, c.sourceTitle, c.due, c.reviews || 0, c.step || 0].map(q).join(",")));
  const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `vocabulary-collection-${today()}.csv` });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- 登録 ---------- */
function renderAdd(m) {
  const d = lsGet("vc.addDraft", { phrase: "", meaning: "", example: "", translation: "", source: "日常会話", note: "" });
  const recent = cardsArr().filter(c => !ytId(c.source)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  m.innerHTML = `
  <div class="stack">
    <div><h2>フレーズを登録</h2><p class="lede">会話や記事で出会った表現をその場でカードにします。フレーズだけ入れて「AIに補完」を押せば、意味と例文を下書きします。</p></div>
    <form class="panel stack" id="addf" autocomplete="off">
      <label class="f">英語のフレーズ・単語 *<input type="text" id="a-phrase" required value="${esc(d.phrase)}" placeholder="例: keep something at bay" style="font-size:17px;font-weight:500" autocapitalize="off"></label>
      <div class="row"><button type="button" class="btn small" id="fill" ${S.cfg?.ai === false || !navigator.onLine ? "disabled" : ""}>AIに意味と例文を補完してもらう</button></div>
      <label class="f">意味・解説<input type="text" id="a-meaning" value="${esc(d.meaning)}" placeholder="悪いことが起こらないよう防ぐ"></label>
      <label class="f">例文<textarea id="a-example" rows="2" placeholder="Exercise can keep heart disease at bay." autocapitalize="off">${esc(d.example)}</textarea></label>
      <label class="f">例文の訳<input type="text" id="a-translation" value="${esc(d.translation)}"></label>
      <div class="grid2"><label class="f">出典（URLや場面）<input type="text" id="a-source" value="${esc(d.source)}" placeholder="日常会話 / 同僚との雑談 / https://…"></label>
      <label class="f">メモ<input type="text" id="a-note" value="${esc(d.note)}" placeholder="誰が、どんな場面で使った？"></label></div>
      <div class="row" style="justify-content:space-between"><span class="muted" style="font-size:13px" id="dupeMsg"></span><button class="btn primary" type="submit">単語帳に追加</button></div>
    </form>
    <section><div class="label" style="margin-bottom:6px">最近自分で登録したフレーズ</div>
      <div class="panel" style="padding-block:4px">${recent.length ? recent.map(c => `<div class="entry"><div class="h"><span class="p">${esc(c.phrase)}</span><span class="pill ${STATUS[c.status]}">${STATUS_JA[c.status]}</span></div><div class="m">${esc(c.meaning)}</div></div>`).join("") : `<div class="empty" style="padding:20px">まだありません</div>`}</div></section>
  </div>`;
  const fields = ["phrase", "meaning", "example", "translation", "source", "note"];
  const read = () => Object.fromEntries(fields.map(k => [k, $("#a-" + k).value]));
  const showDupe = () => { const x = findDupe($("#a-phrase").value); $("#dupeMsg").textContent = x ? `登録済み: ${x.phrase}（${STATUS_JA[x.status]}）` : ""; };
  fields.forEach(k => $("#a-" + k).oninput = () => { lsSet("vc.addDraft", read()); if (k === "phrase") showDupe(); });
  showDupe();
  $("#fill").onclick = async () => {
    const p = $("#a-phrase").value.trim(); if (!p) { toast("先にフレーズを入力してください"); return; }
    const btn = $("#fill"); btn.textContent = "補完中…"; btn.disabled = true;
    try {
      const out = await api("/api/ai", { method: "POST", body: JSON.stringify({ mode: "fill", phrase: p, context: $("#a-note").value.trim() }) });
      const cur = read();
      ["phrase", "meaning", "example", "translation"].forEach(k => { if (out?.[k] && (k === "phrase" || !cur[k].trim())) $("#a-" + k).value = String(out[k]); });
      lsSet("vc.addDraft", read()); showDupe();
    } catch (e) { toast(e.message || "補完できませんでした。"); }
    btn.textContent = "AIに意味と例文を補完してもらう"; btn.disabled = false;
  };
  $("#addf").onsubmit = async e => {
    e.preventDefault();
    const f = read(); if (!f.phrase.trim()) return;
    if (findDupe(f.phrase)) { toast("このフレーズは登録済みです"); return; }
    await saveCard(newCard({ ...f, sourceType: ytId(f.source) ? "video" : "manual" }));
    lsSet("vc.addDraft", { phrase: "", meaning: "", example: "", translation: "", source: f.source, note: "" });
    toast(`「${f.phrase.trim()}」を追加しました。今日の復習に入っています`); render(); $("#a-phrase").focus();
  };
}

/* ---------- boot ---------- */
async function loadConfig() {
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "設定を読み込めませんでした");
    lsSet("vc.cfg", j); return j;
  } catch (e) {
    const cached = lsGet("vc.cfg", null);
    if (cached) return cached;
    throw e;
  }
}
function onUser(user) {
  const changed = !onUser.done || (S.user?.id || null) !== (user?.id || null);
  onUser.done = true;
  S.user = user;
  if (!changed) return;
  S.cards = new Map(); S.videos = new Map(); S.ready = false; S.session = null;
  if (user) {
    const cached = lsGet(cacheKey(), null);
    if (Array.isArray(cached) && cached.length) { cached.forEach(c => c?.id && S.cards.set(c.id, c)); S.ready = true; }
    if (!navigator.onLine) S.ready = true;
    render(); refresh(); checkPush().then(() => { if (S.tab === "today" && !S.session && !typing()) render(); });
  } else render();
}
async function boot() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  try { S.cfg = await loadConfig(); }
  catch (e) { $("#main").innerHTML = `<div class="empty"><h2>セットアップが未完了です</h2><p>${esc(e.message)}</p></div>`; $("#meta").textContent = ""; return; }
  S.sb = createClient(S.cfg.supabaseUrl, S.cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "vc.auth" } });
  const { data } = await S.sb.auth.getSession();
  onUser(data.session?.user || null);
  S.sb.auth.onAuthStateChange((_ev, session) => onUser(session?.user || null));
  window.addEventListener("online", () => { renderHeader(); flushPending(); refresh(); });
  window.addEventListener("offline", renderHeader);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.user) { refresh(); updateAppBadge(); } });
  window.addEventListener("hashchange", () => { const t = location.hash.slice(1); if (["today", "video", "book", "add"].includes(t) && t !== S.tab) { S.session = null; setTab(t); } });
}
boot();
