// PagesWeb 公共工具层
// 所有接口统一 JSON 响应、统一错误结构、统一鉴权入口。

export const API_VERSION = "2.0.0";
export const SCHEMA_VERSION = "v4";

export interface Env {
  DB: D1Database;
  PW_KV: KVNamespace;
  APP_SECRET?: string;
}

export type Ctx = {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
};

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Key, Authorization",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS,
      ...extra,
    },
  });
}

export function ok(data: unknown = {}, status = 200): Response {
  const body =
    data && typeof data === "object" && !Array.isArray(data)
      ? { ok: true, ...(data as Record<string, unknown>) }
      : { ok: true, data };
  return json(body, status);
}

export function fail(code: string, message: string, status = 400, detail?: unknown): Response {
  return json({ ok: false, error: { code, message, detail: detail ?? null } }, status);
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

// 带 KEY 的接口拒绝浏览器来源，避免 KEY 被前端代码或浏览器扩展读到。
// 命令行、脚本、后端服务不发 Origin / Sec-Fetch-*，照常放行。
// 注意判断的是「是否来自浏览器」而非「是否跨站」：同源页面也不该拿到 KEY。
// 公开读接口不调用本函数。
export function isBrowserOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (origin) return true;
  const sec = request.headers.get("Sec-Fetch-Site");
  if (sec === "cross-site" || sec === "same-origin" || sec === "same-site") return true;
  if (request.headers.get("Sec-Fetch-Mode")) return true;
  return false;
}

// 读取 key 唯一入口
export async function readKey(input: {
  body?: Record<string, unknown> | null;
  request: Request;
  query?: URLSearchParams;
}): Promise<string> {
  const { body, request, query } = input;
  const header = request.headers.get("X-Key") || request.headers.get("x-key");
  if (header && header.trim()) return header.trim();
  const auth = request.headers.get("Authorization") || "";
  if (auth.toLowerCase().startsWith("key ")) return auth.slice(4).trim();
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  if (body && typeof body.key === "string" && body.key.trim()) return body.key.trim();
  if (query) {
    const q = query.get("key");
    if (q && q.trim()) return q.trim();
  }
  return "";
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomKey(prefix = "pw"): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const body = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${body}`;
}

export function nowMs(): number {
  return Date.now();
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const ct = request.headers.get("Content-Type") || "";
  if (!ct.includes("application/json")) return null;
  try {
    const data = await request.json();
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function clampString(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

export function pageParams(url: URL, defaultLimit = 20, maxLimit = 100): { limit: number; offset: number } {
  const rawLimit = Number(url.searchParams.get("limit") ?? defaultLimit);
  const rawPage = Number(url.searchParams.get("page") ?? 1);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), maxLimit) : defaultLimit;
  const page = Number.isFinite(rawPage) ? Math.max(Math.trunc(rawPage), 1) : 1;
  return { limit, offset: (page - 1) * limit };
}
