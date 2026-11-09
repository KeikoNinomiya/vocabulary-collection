// Vocabulary Collection — single Node server for local testing and Google Cloud Run.
// Serves the app in public/ and runs the same handlers in api/ that Vercel uses.
//
//   Local:      npm run dev        (reads .env, http://localhost:3000)
//   Cloud Run:  npm start          (PORT is set by Cloud Run, env vars come from the service)
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);

// Only these files in api/ are reachable as /api/<name>
const ROUTES = ["ai", "article", "config", "cron-daily", "push-test", "transcript"];
const handlers = new Map();
async function handlerFor(name) {
  if (!ROUTES.includes(name)) return null;
  if (!handlers.has(name)) handlers.set(name, (await import(`./api/${name}.js`)).default);
  return handlers.get(name);
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8"
};

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + sep)) { res.statusCode = 403; return res.end("Forbidden"); }
  let target = file;
  try { if (!(await stat(target)).isFile()) throw new Error(); }
  catch {
    // Unknown paths without a file extension fall back to the app shell
    if (extname(rel)) { res.statusCode = 404; return res.end("Not found"); }
    target = join(PUBLIC, "index.html");
  }
  const body = await readFile(target);
  res.setHeader("Content-Type", TYPES[extname(target)] || "application/octet-stream");
  res.setHeader("Cache-Control", target.endsWith("sw.js") || target.endsWith(".html") ? "no-cache" : "public, max-age=300");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(req.method === "HEAD" ? undefined : body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/healthz") { res.setHeader("Content-Type", "text/plain"); return res.end("ok"); }
    if (url.pathname.startsWith("/api/")) {
      const fn = await handlerFor(url.pathname.slice(5).replace(/\/$/, ""));
      if (!fn) { res.statusCode = 404; res.setHeader("Content-Type", "application/json"); return res.end('{"error":"not found"}'); }
      req.query = Object.fromEntries(url.searchParams);
      return await fn(req, res);
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.statusCode = 405; return res.end("Method not allowed"); }
    await serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(req.method, url.pathname, e);
    if (!res.headersSent) { res.statusCode = 500; res.setHeader("Content-Type", "application/json"); }
    res.end(JSON.stringify({ error: "サーバーでエラーが起きました" }));
  }
});

server.listen(PORT, () => console.log(`Vocabulary Collection: http://localhost:${PORT}`));
