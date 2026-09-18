// GET /api/account/:username - 账号公开信息 + 最近发帖
import { Ctx, fail, ok, preflight, isBrowserOrigin, pageParams } from "../core/_util.ts";
import { getAccountByUsername, publicAccount } from "../core/_auth.ts";
import { serializePost, type Post } from "../core/_posts.ts";

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === "OPTIONS") return preflight();
  if (isBrowserOrigin(context.request)) {
    return fail("browser_forbidden", "该接口不接受浏览器跨站调用", 403);
  }
  if (context.request.method !== "GET") {
    return fail("method_not_allowed", "该接口只接受 GET", 405);
  }

  const raw = context.params.username;
  const username = (Array.isArray(raw) ? raw[0] : raw ?? "").toLowerCase();
  if (!username) return fail("invalid_username", "缺少 username", 400);

  const account = await getAccountByUsername(context.env, username);
  if (!account) return fail("not_found", `账号 "${username}" 不存在`, 404);

  const url = new URL(context.request.url);
  const { limit, offset } = pageParams(url, 20, 100);
  const res = await context.env.DB.prepare(
    `SELECT * FROM posts WHERE username = ? AND is_deleted = 0
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(username, limit, offset)
    .all<Post>();

  const posts = (res.results ?? []).map((p) => serializePost(p));
  return ok({ account: publicAccount(account), posts, pagination: { limit, offset, count: posts.length } });
}
