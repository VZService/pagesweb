// PATCH /api/auth/profile - 修改显示名 / 简介（不改 username）
import { Ctx, fail, ok, preflight, readJson, readKey, isBrowserOrigin, clampString, nowMs } from "../core/_util";
import { authByKey, getAccountById, publicAccount, audit } from "../core/_auth";

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === "OPTIONS") return preflight();
  if (context.request.method !== "PATCH" && context.request.method !== "POST") {
    return fail("method_not_allowed", "该接口只接受 PATCH", 405);
  }
  if (isBrowserOrigin(context.request)) {
    return fail("browser_forbidden", "该接口不接受浏览器跨站调用", 403);
  }

  const body = await readJson(context.request);
  if (!body) return fail("invalid_body", "请求体必须是 application/json 对象", 400);

  const key = await readKey({ body, request: context.request });
  if (!key) return fail("key_required", "缺少 KEY", 401);

  const auth = await authByKey(context.env, key);
  if (!auth) return fail("invalid_key", "KEY 无效或已吊销", 401);
  if (auth.scope !== "write") return fail("readonly_key", "该子 KEY 是只读权限", 403);

  const fields: string[] = [];
  const vals: unknown[] = [];
  if (body.display_name !== undefined) {
    fields.push("display_name = ?");
    vals.push(clampString(body.display_name, 48) || auth.account.username);
  }
  if (body.bio !== undefined) {
    fields.push("bio = ?");
    vals.push(clampString(body.bio, 400));
  }
  if (!fields.length) return fail("nothing_to_update", "没有可更新的字段（display_name / bio）", 400);

  fields.push("updated_at = ?");
  vals.push(nowMs(), auth.account.id);
  await context.env.DB.prepare(`UPDATE accounts SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...vals)
    .run();

  const fresh = await getAccountById(context.env, auth.account.id);
  await audit(context.env, auth.account.id, "update_profile", JSON.stringify(Object.keys(body)));
  return ok({ account: fresh ? publicAccount(fresh) : null });
}
