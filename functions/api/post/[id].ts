// GET / PATCH / DELETE /api/post/:id
import {
  Ctx, fail, ok, preflight, readJson, readKey, isBrowserOrigin, clampString,
} from "../core/_util.ts";
import { authByKey, audit } from "../core/_auth.ts";
import {
  getPost, softDeletePost, updatePost, serializePost, normalizeTags, TITLE_MAX, CONTENT_MAX, type Post,
} from "../core/_posts.ts";

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

    return ok({
      post: serializePost(post, (replies.results ?? []).length),
      replies: (replies.results ?? []).map((r) => serializePost(r)),
      parent,
    });
  }

  const body = method === "DELETE" ? await readJson(context.request) : await readJson(context.request);
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
    const fields: { title?: string; content?: string; tags?: string } = {};
    if (body.title !== undefined) fields.title = clampString(body.title, TITLE_MAX);
    if (body.content !== undefined) {
      const c = clampString(body.content, CONTENT_MAX);
      if (!c) return fail("content_required", "content 不能为空", 400);
      fields.content = c;
    }
    if (body.tags !== undefined) fields.tags = normalizeTags(body.tags);
    if (!Object.keys(fields).length) {
      return fail("nothing_to_update", "没有可更新的字段（title / content / tags）", 400);
    }
    await updatePost(context.env, id, fields);
    await audit(context.env, auth.account.id, "update_post", `#${id}`);
    const fresh = await getPost(context.env, id);
    return ok({ post: fresh ? serializePost(fresh) : null });
  }

  return fail("method_not_allowed", "支持 GET / PATCH / DELETE", 405);
}
