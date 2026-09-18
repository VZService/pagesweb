// GET /api/account/:username - 账号公开信息 + 最近发帖
import { Ctx, fail, ok, preflight, pageParams } from "../../../src/_util.ts";
import { getAccountByUsername, publicAccount } from "../../../src/_auth.ts";
import { serializePost, type Post } from "../../../src/_posts.ts";
import { listBoards } from "../../../src/_boards.ts";

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === "OPTIONS") return preflight();
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

  const boards = await listBoards(context.env);
  const boardMap = new Map(boards.map((b) => [b.id, b]));

  const posts = (res.results ?? []).map((p) => {
    const b = p.board_id === null ? undefined : boardMap.get(p.board_id);
    return serializePost(p, { boardSlug: b?.slug, boardName: b?.name });
  });
  return ok({ account: publicAccount(account), posts, pagination: { limit, offset, count: posts.length } });
}
