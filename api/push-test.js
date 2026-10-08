// POST /api/push-test → sends a test notification to the signed-in user's own devices.
import webpush from "web-push";
import { env, send, requireUser, adminClient } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  const user = await requireUser(req, res); if (!user) return;
  const pub = env("VAPID_PUBLIC_KEY"), priv = env("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return send(res, 500, { error: "Vercel に VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY が設定されていません" });
  webpush.setVapidDetails(`mailto:${user.email || "owner@example.com"}`, pub, priv);
  const db = adminClient();
  const { data: subs, error } = await db.from("push_subscriptions").select("*").eq("user_id", user.id);
  if (error) return send(res, 500, { error: error.message });
  let sent = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: "Vocabulary Collection", body: "通知のテストです。毎朝8時ごろに復習枚数をお知らせします。", url: "/#today" }));
      sent++;
    } catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await db.from("push_subscriptions").delete().eq("id", s.id); }
  }
  send(res, 200, { sent });
}
