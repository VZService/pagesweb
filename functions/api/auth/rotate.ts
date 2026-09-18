// POST /api/auth/rotate - 轮换主 KEY（仅主 KEY 可操作）
import { Ctx, fail, ok, preflight, readKey, isBrowserOrigin } from "../core/_util.ts";
import { authByKey, rotateMasterKey, audit } from "../core/_auth.ts";

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === "OPTIONS") return preflight();
  if (context.request.method !== "POST") {
    return fail("method_not_allowed", "该接口只接受 POST", 405);
  }
  if (isBrowserOrigin(context.request)) {
    return fail("browser_forbidden", "该接口不接受浏览器跨站调用", 403);
  }

  const key = await readKey({ request: context.request });
  if (!key) return fail("key_required", "缺少 KEY", 401);

  const auth = await authByKey(context.env, key);
  if (!auth) return fail("invalid_key", "KEY 无效或已吊销", 401);
  if (auth.via !== "master") {
    return fail("master_key_required", "轮换 KEY 只能用主 KEY 操作，子 KEY 无权", 403);
  }

  const next = await rotateMasterKey(context.env, auth.account.id);
  await audit(context.env, auth.account.id, "rotate_key", auth.account.username);

  return ok({
    key: next,
    warning: "旧主 KEY 已立即失效，子 KEY 不受影响。新 KEY 仅此一次明文返回。",
  });
}
