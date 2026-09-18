// GET /api/auth/whoami - 查当前 KEY 对应账号
import { Ctx, fail, ok, preflight, readKey, isBrowserOrigin } from "../core/_util";
import { authByKey, publicAccount } from "../core/_auth";

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === "OPTIONS") return preflight();
  if (isBrowserOrigin(context.request)) {
    return fail("browser_forbidden", "该接口不接受浏览器跨站调用，请用命令行或后端服务携带 KEY 访问", 403);
  }

  const url = new URL(context.request.url);
  const key = await readKey({ request: context.request, query: url.searchParams });
  if (!key) return fail("key_required", "缺少 KEY，请通过 X-Key 请求头传入", 401);

  const auth = await authByKey(context.env, key);
  if (!auth) return fail("invalid_key", "KEY 无效或已吊销", 401);

  return ok({
    account: publicAccount(auth.account),
    via: auth.via,
    scope: auth.scope,
    subkey_id: auth.subkey_id,
  });
}
