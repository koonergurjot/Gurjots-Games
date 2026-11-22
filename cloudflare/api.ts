// Accounts, cloud saves and leaderboards, backed by Cloudflare D1.
export interface ApiEnv { DB: D1Database }

const SESSION_DAYS = 30;
const MAX_SAVE_BYTES = 256 * 1024;
const GAME_RE = /^[a-z0-9-]{2,32}$/;
const USER_RE = /^[A-Za-z0-9_]{3,20}$/;
const COOKIE = "gg_session";

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const fail = (status: number, error: string) => json({ error }, status);

const hex = (buf: ArrayBuffer | Uint8Array) => [...new Uint8Array(buf as ArrayBuffer)].map(b => b.toString(16).padStart(2, "0")).join("");
const randomHex = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
  return hex(bits);
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function cookieOf(req: Request): string | null {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|; )${COOKIE}=([a-f0-9]+)`));
  return m ? m[1] : null;
}
const setCookie = (token: string, maxAge: number) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function currentUser(req: Request, env: ApiEnv) {
  const token = cookieOf(req);
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
  ).bind(await sha256(token), Date.now()).first<{ id: string; username: string }>();
  return row || null;
}

async function startSession(env: ApiEnv, userId: string) {
  const token = randomHex(32);
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, Date.now() + SESSION_DAYS * 864e5).run();
  return setCookie(token, SESSION_DAYS * 86400);
}

async function body(req: Request): Promise<any> {
  try { return await req.json(); } catch { return null; }
}

export async function handleApi(req: Request, env: ApiEnv): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = req.method;

  // State-changing calls must come from this site.
  if (method !== "GET" && method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin) return fail(403, "Cross-site requests are not allowed.");
  }
  try {
    if (path === "/api/signup" && method === "POST") {
      const b = await body(req);
      const username = String(b?.username ?? "").trim();
      const password = String(b?.password ?? "");
      if (!USER_RE.test(username)) return fail(400, "Username must be 3 to 20 letters, numbers or underscores.");
      if (password.length < 8 || password.length > 200) return fail(400, "Password must be at least 8 characters.");
      const id = crypto.randomUUID();
      const salt = randomHex(16);
      try {
        await env.DB.prepare("INSERT INTO users (id, username, pass_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)")
          .bind(id, username, await hashPassword(password, salt), salt, Date.now()).run();
      } catch {
        return fail(409, "That username is taken. Try another.");
      }
      return json({ user: { username } }, 201, { "set-cookie": await startSession(env, id) });
    }

    if (path === "/api/login" && method === "POST") {
      const b = await body(req);
      const username = String(b?.username ?? "").trim();
      const password = String(b?.password ?? "");
      const row = await env.DB.prepare("SELECT id, username, pass_hash, salt FROM users WHERE username = ?")
        .bind(username).first<{ id: string; username: string; pass_hash: string; salt: string }>();
      // Hash even when the user is unknown so timing does not reveal which names exist.
      const attempt = await hashPassword(password, row?.salt ?? "0".repeat(32));
      if (!row || !safeEqual(attempt, row.pass_hash)) return fail(401, "Wrong username or password.");
      return json({ user: { username: row.username } }, 200, { "set-cookie": await startSession(env, row.id) });
    }

    if (path === "/api/logout" && method === "POST") {
      const token = cookieOf(req);
      if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
      return json({ ok: true }, 200, { "set-cookie": setCookie("", 0) });
    }

    if (path === "/api/me" && method === "GET") {
      const u = await currentUser(req, env);
      return json({ user: u ? { username: u.username } : null });
    }

    if (path === "/api/account" && method === "DELETE") {
      const u = await currentUser(req, env);
      if (!u) return fail(401, "Sign in first.");
      await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(u.id).run();
      return json({ ok: true }, 200, { "set-cookie": setCookie("", 0) });
    }

    if (path === "/api/save") {
      const u = await currentUser(req, env);
      if (!u) return fail(401, "Sign in first.");
      if (method === "GET") {
        const row = await env.DB.prepare("SELECT data, updated_at FROM saves WHERE user_id = ?").bind(u.id).first<{ data: string; updated_at: number }>();
        return json({ data: row ? JSON.parse(row.data) : null, updatedAt: row?.updated_at ?? null });
      }
      if (method === "PUT") {
        const raw = await req.text();
        if (raw.length > MAX_SAVE_BYTES) return fail(413, "Save is too large.");
        let parsed: any;
        try { parsed = JSON.parse(raw); } catch { return fail(400, "Save must be JSON."); }
        if (!parsed || typeof parsed.data !== "object" || Array.isArray(parsed.data)) return fail(400, "Save must contain a data object.");
        const now = Date.now();
        await env.DB.prepare("INSERT INTO saves (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
          .bind(u.id, JSON.stringify(parsed.data), now).run();
        return json({ ok: true, updatedAt: now });
      }
    }

    // /api/score is this site's client; POST /api/leaderboard is the older shared/leaderboard.js client.
    if ((path === "/api/score" || path === "/api/leaderboard") && method === "POST") {
      const u = await currentUser(req, env);
      const b = await body(req);
      const game = String(b?.game ?? "");
      const score = Number(b?.score);
      if (!GAME_RE.test(game) || !Number.isFinite(score) || score < 0 || score > 1e9) return fail(400, "Invalid score.");
      // Guests keep their score on the device; only signed-in players reach the shared boards.
      if (!u) return path === "/api/leaderboard" ? json({ ok: true, saved: false }) : fail(401, "Sign in first.");
      await env.DB.prepare("INSERT INTO scores (user_id, game, best, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, game) DO UPDATE SET best = MAX(best, excluded.best), updated_at = CASE WHEN excluded.best > best THEN excluded.updated_at ELSE updated_at END")
        .bind(u.id, game, score, Date.now()).run();
      return json({ ok: true, saved: true });
    }

    if (path === "/api/leaderboard" && method === "GET") {
      const game = url.searchParams.get("game") || "";
      if (!GAME_RE.test(game)) return fail(400, "Unknown game.");
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "25", 10) || 25, 1), 100);
      const rows = await env.DB.prepare(
        "SELECT u.username, s.best, s.updated_at FROM scores s JOIN users u ON u.id = s.user_id WHERE s.game = ? ORDER BY s.best DESC, s.updated_at ASC LIMIT ?"
      ).bind(game, limit).all<{ username: string; best: number; updated_at: number }>();
      const entries = rows.results;
      const scores = entries.map(r => ({ score: r.best, handle: r.username, at: r.updated_at }));
      return json({ game, entries, scores }, 200, { "cache-control": "public, max-age=30" });
    }

    return fail(404, "Not found.");
  } catch (err) {
    console.error("api error", err);
    return fail(500, "Something went wrong. Try again.");
  }
}
