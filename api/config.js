// Public settings the browser needs. Only publishable values are returned here.
import { env, send } from "./_lib.js";

export default function handler(req, res) {
  const cfg = {
    supabaseUrl: env("SUPABASE_URL"),
    supabaseKey: env("SUPABASE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY"),
    vapidPublicKey: env("VAPID_PUBLIC_KEY"),
    ai: Boolean(env("GEMINI_API_KEY"))
  };
  const missing = Object.entries({ SUPABASE_URL: cfg.supabaseUrl, SUPABASE_PUBLISHABLE_KEY: cfg.supabaseKey }).filter(([, v]) => !v).map(([k]) => k);
  send(res, missing.length ? 500 : 200, missing.length ? { error: `Vercel の環境変数が足りません: ${missing.join(", ")}` } : cfg);
}
