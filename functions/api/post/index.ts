// POST /api/post - 发帖 / 回复
import {
  Ctx, fail, ok, preflight, readJson, readKey, isBrowserOrigin, clampString,
} from "../core/_util";
import { authByKey, bumpPostCount, audit } from "../core/_auth";
import {
  createPost, getPost, normalizeTags, serializePost, TITLE_MAX, CONTENT_MAX,
} from "../core/_posts";

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === "OPTIONS") return preflight();
  if (context.request.method !== "POST") {
    return fail("method_not_allowed", "该接口只接受 POST", 405);
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
  if (auth.scope !== "write") return fail("readonly_key", "该子 KEY 是只读权限，不能发帖", 403);

  const content = clampString(body.content ?? body.body ?? "", CONTENT_MAX);
  if (!content) return fail("content_required", "content 不能为空", 400);

  const title = clampString(body.title ?? "", TITLE_MAX);
  const tags = normalizeTags(body.tags);

  let replyTo: number | null = null;
  if (body.reply_to !== undefined && body.reply_to !== null && body.reply_to !== "") {
    const n = Number(body.reply_to);
    if (!Number.isInteger(n) || n <= 0) return fail("invalid_reply_to", "reply_to 必须是正整数帖子 id", 400);
    const parent = await getPost(context.env, n);
    if (!parent) return fail("reply_target_not_found", `被回复的帖子 id=${n} 不存在`, 404);
    replyTo = n;
  }

  const id = await createPost(context.env, {
    accountId: auth.account.id,
    username: auth.account.username,
    title,
    content,
    replyTo,
    tags,
  });
  await bumpPostCount(context.env, auth.account.id, 1);
  await audit(context.env, auth.account.id, "create_post", `#${id}`);

  const created = await getPost(context.env, id);
  return ok({ post: created ? serializePost(created) : { id } }, 201);
}
