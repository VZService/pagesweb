// GET / PATCH / DELETE /api/post/:id
import {
  Ctx, fail, ok, preflight, readJson, readKey, isBrowserOrigin, clampString,
} from "../../../src/_util.ts";
import { authByKey, audit } from "../../../src/_auth.ts";
import {
  getPost, softDeletePost, updatePost, serializePost, TITLE_MAX, CONTENT_MAX, type Post,
} from "../../../src/_posts.ts";
import { getBoardById } from "../../../src/_boards.ts";

function readId(context: Ctx): number {
  const raw = context.params.id;
  const s = Array.isArray(raw) ? raw[0] : raw ?? "";
  return Number(s);
}

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === "OPTIONS") return preflight();
  if (isBrowserOrigin(context.request)) {
    return fail("browser_forbidden", "该接口不接受浏览器跨站调用", 403);
  }

  const method = context.request.method;
  const id = readId(context);
  if (!Number.isInteger(id) || id <= 0) return fail("invalid_id", "帖子 id 必须是正整数", 400);

  if (method === "GET") {
    const post = await getPost(context.env, id);
    if (!post) return fail("not_found", `帖子 #${id} 不存在`, 404);

    const replies = await context.env.DB.prepare(
      `SELECT * FROM posts WHERE reply_to = ? AND is_deleted = 0 ORDER BY created_at ASC LIMIT 200`,
    )
      .bind(id)
      .all<Post>();

    let parent = null;
    if (post.reply_to) {
      const p = await getPost(context.env, post.reply_to);
      parent = p ? { id: p.id, author: p.username, title: p.title } : null;
    }

    const board = post.board_id === null ? null : await getBoardById(context.env, post.board_id);

    return ok({
      post: serializePost(post, {
        replies: (replies.results ?? []).length,
        boardSlug: board?.slug,
        boardName: board?.name,
      }),
      board: board ? { id: board.id, slug: board.slug, name: board.name } : null,
      replies: (replies.results ?? []).map((r) =>
        serializePost(r, { boardSlug: board?.slug, boardName: board?.name }),
      ),
      parent,
    });
  }

  const body = await readJson(context.request);
  const key = await readKey({ body, request: context.request });
  if (!key) return fail("key_required", "缺少 KEY", 401);

  const auth = await authByKey(context.env, key);
  if (!auth) return fail("invalid_key", "KEY 无效或已吊销", 401);
  if (auth.scope !== "write") return fail("readonly_key", "该子 KEY 是只读权限", 403);

  const post = await getPost(context.env, id);
  if (!post) return fail("not_found", `帖子 #${id} 不存在`, 404);

  const isOwner = post.account_id === auth.account.id || post.username === auth.account.username;
  if (!isOwner) return fail("forbidden", "只能操作自己发的帖子", 403);

  if (method === "DELETE") {
    await softDeletePost(context.env, id);
    await audit(context.env, auth.account.id, "delete_post", `#${id}`);
    return ok({ deleted: id });
  }

  if (method === "PATCH" || method === "POST") {
    if (!body) return fail("invalid_body", "请求体必须是 application/json 对象", 400);
    const fields: { title?: string; content?: string } = {};
    if (body.title !== undefined) fields.title = clampString(body.title, TITLE_MAX);
    if (body.content !== undefined) {
      const c = clampString(body.content, CONTENT_MAX);
      if (!c) return fail("content_required", "content 不能为空", 400);
      fields.content = c;
    }
    if (!Object.keys(fields).length) {
      return fail("nothing_to_update", "没有可更新的字段（title / content）。帖子不能改分区。", 400);
    }
    await updatePost(context.env, id, fields);
    await audit(context.env, auth.account.id, "update_post", `#${id}`);
    const fresh = await getPost(context.env, id);
    const board = fresh?.board_id == null ? null : await getBoardById(context.env, fresh.board_id);
    return ok({
      post: fresh
        ? serializePost(fresh, { boardSlug: board?.slug, boardName: board?.name })
        : null,
    });
  }

  return fail("method_not_allowed", "支持 GET / PATCH / DELETE", 405);
}
