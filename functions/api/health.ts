// GET /api/health - 健康检查，顺带探活 D1 / KV
import { Ctx, ok, preflight, API_VERSION, SCHEMA_VERSION } from "../../src/_util.ts";
import { ensureSchema } from "../../src/_db.ts";

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === "OPTIONS") return preflight();

  let db = "down";
  let dbError: string | null = null;
  let appliedSchema: string | null = null;
  try {
    await ensureSchema(context.env);
    await context.env.DB.prepare("SELECT 1 AS n").first();
    const row = await context.env.DB
      .prepare(`SELECT v FROM schema_meta WHERE k = 'schema_version'`)
      .first<{ v: string }>();
    appliedSchema = row?.v ?? null;
    db = "up";
  } catch (e) {
    db = "down";
    dbError = e instanceof Error ? e.message : String(e);
  }

  let kv = "down";
  try {
    await context.env.PW_KV.put("health:ping", String(Date.now()));
    kv = "up";
  } catch {
    kv = "down";
  }

  const schemaOk = appliedSchema === SCHEMA_VERSION;
  const healthy = db === "up" && schemaOk;
  return ok(
    {
      status: healthy ? "healthy" : "degraded",
      api_version: API_VERSION,
      schema_version: SCHEMA_VERSION,
      schema_applied: appliedSchema,
      services: { d1: db, kv },
      db_error: dbError,
      time: new Date().toISOString(),
    },
    healthy ? 200 : 503,
  );
}
