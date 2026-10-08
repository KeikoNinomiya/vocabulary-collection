// Runs every morning (vercel.json → crons, 23:00 UTC = 8:00 JST).
// Sends each subscribed device a push with today's review count. Also keeps the free
// Supabase project from pausing for inactivity.
import webpush from "web-push";
import { env, send, adminClient, todayJST } from "./_lib.js";

export default async function handler(req, res) {
  const secret = env("CRON_SECRET");
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, { error: "unauthorized" });
  const pub = env("VAPID_PUBLIC_KEY"), priv = env("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return send(res, 500, { error: "VAPID keys missing" });
  webpush.setVapidDetails(`mailto:${env("ALLOWED_EMAIL").split(",")[0] || "owner@example.com"}`, pub, priv);

  const db = adminClient(), today = todayJST();
  const { data: subs, error } = await db.from("push_subscriptions").select("*");
  if (error) return send(res, 500, { error: error.message });

  const byUser = new Map();
  for (const s of subs || []) { if (!byUser.has(s.user_id)) byUser.set(s.user_id, []); byUser.get(s.user_id).push(s); }

  let sent = 0, removed = 0;
  for (const [userId, list] of byUser) {
    const { data: due } = await db.from("cards").select("phrase,status").eq("user_id", userId).lte("due", today).limit(1000);
    const n = due?.length || 0, ny = (due || []).filter(c => c.status === "Not yet").length;
    const picks = (due || []).sort((a, b) => (a.status === "Not yet" ? 0 : 1) - (b.status === "Not yet" ? 0 : 1)).slice(0, 3).map(c => c.phrase);
    const payload = JSON.stringify(n
      ? { title: `今日の復習は ${n} 枚`, body: `${ny ? `未定着 ${ny} 枚。` : ""}今朝の3語: ${picks.join(" / ")}`, badge: n, url: "/#today" }
      : { title: "今日の復習はありません", body: "新しい動画で語彙を増やしませんか？", badge: 0, url: "/#video" });
    for (const s of list) {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600 }); sent++; }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { await db.from("push_subscriptions").delete().eq("id", s.id); removed++; } }
    }
  }
  send(res, 200, { ok: true, today, users: byUser.size, sent, removed });
}
