// Shared helpers for the serverless functions. Files starting with "_" are not exposed as routes.
import { createClient } from "@supabase/supabase-js";

export const env = (name, fallback = "") => (process.env[name] || fallback).trim();

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function adminClient() {
  const url = env("SUPABASE_URL"), key = env("SUPABASE_SECRET_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY が設定されていません");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Verifies the caller's Supabase session and (optionally) that it is the allowed owner.
export async function requireUser(req, res) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) { send(res, 401, { error: "ログインしてください" }); return null; }
  try {
    const { data, error } = await adminClient().auth.getUser(token);
    if (error || !data?.user) { send(res, 401, { error: "ログインの有効期限が切れました。もう一度ログインしてください" }); return null; }
    const allowed = env("ALLOWED_EMAIL").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes((data.user.email || "").toLowerCase())) {
      send(res, 403, { error: "このアカウントでは利用できません" }); return null;
    }
    return data.user;
  } catch (e) {
    send(res, 500, { error: String(e.message || e) }); return null;
  }
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

export const todayJST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
