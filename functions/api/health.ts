// GET /api/health - 健康检查，顺带探活 D1 / KV
import { Ctx, ok, preflight, API_VERSION } from "../core/_util.ts";
import { ensureSchema } from "../core/_db.ts";

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === "OPTIONS") return preflight();

  let db = "down";
  let kv = "down";
  try {
    await ensureSchema(context.env);
    await context.env.DB.prepare("SELECT 1 AS n").first();
    db = "up";
  } catch {
    db = "down";
  }
  try {
    await context.env.PW_KV.put("health:ping", String(Date.now()));
    kv = "up";
  } catch {
    kv = "down";
  }

  const healthy = db === "up";
  return ok(
    {
      status: healthy ? "healthy" : "degraded",
      api_version: API_VERSION,
      services: { d1: db, kv },
      time: new Date().toISOString(),
    },
    healthy ? 200 : 503,
  );
}
