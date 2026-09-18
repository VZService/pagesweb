// GET  /api/boards - 列出全部分区（公开读）
// POST /api/boards - 创建分区（需要 KEY，可设置密码）
import {
  Ctx, fail, ok, preflight, readJson, readKey, isBrowserOrigin, clampString,
} from "../../src/_util.ts";
import { authByKey, audit } from "../../src/_auth.ts";
import {
  createBoard, getBoardBySlug, listBoards, serializeBoard, countBoardPosts,
  normalizeSlug, validSlug, NAME_MAX, DESC_MAX, BOARD_PASS_MIN, BOARD_PASS_MAX,
} from "../../src/_boards.ts";

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === "OPTIONS") return preflight();
  const method = context.request.method;

  // 公开读：列出全部分区
  if (method === "GET") {
    const boards = await listBoards(context.env);
    const out = [];
    for (const b of boards) {
      out.push(serializeBoard(b, await countBoardPosts(context.env, b.id)));
    }
    return ok({ boards: out, total: out.length });
  }

  if (method !== "POST") {
    return fail("method_not_allowed", "支持 GET / POST", 405);
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
  if (auth.scope !== "write") return fail("readonly_key", "该子 KEY 是只读权限，不能创建分区", 403);

  const slug = normalizeSlug(body.slug ?? body.board ?? body.name);
  const v = validSlug(slug);
  if (!v.ok) return fail("invalid_slug", v.reason ?? "slug 不合法", 400);

  const existing = await getBoardBySlug(context.env, slug);
  if (existing) return fail("slug_taken", `分区 "${slug}" 已存在`, 409);

  const name = clampString(body.name ?? slug, NAME_MAX);
  const description = clampString(body.description ?? body.desc, DESC_MAX);
  const password = typeof body.password === "string" ? body.password : "";
  if (password && password.length < BOARD_PASS_MIN) {
    return fail("password_too_short", `分区密码至少 ${BOARD_PASS_MIN} 个字符`, 400);
  }
  if (password.length > BOARD_PASS_MAX) {
    return fail("password_too_long", `分区密码最多 ${BOARD_PASS_MAX} 个字符`, 400);
  }

  const id = await createBoard(context.env, {
    slug,
    name,
    description,
    ownerId: auth.account.id,
    ownerName: auth.account.username,
    password,
  });
  await audit(context.env, auth.account.id, "create_board", `${slug}${password ? ":locked" : ""}`);

  const created = await getBoardBySlug(context.env, slug);
  return ok(
    {
      board: created ? serializeBoard(created, 0) : { id, slug },
      notice: password
        ? "分区已设置密码，发帖时必须带上 board_password。密码本身不会再次返回。"
        : "分区未设密码，任何持有 KEY 的人都可以在此发帖。",
    },
    201,
  );
}
