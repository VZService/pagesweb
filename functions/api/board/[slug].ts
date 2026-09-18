// GET    /api/board/:slug - 分区详情 + 该分区帖子（公开读）
// PATCH  /api/board/:slug - 改分区（仅分区主；可改密码 / 名称 / 简介 / 锁定）
// DELETE /api/board/:slug - 删分区（仅分区主；分区内还有帖子时拒绝）
import {
  Ctx, fail, ok, preflight, readJson, readKey, isBrowserOrigin, clampString, pageParams, sha256Hex,
} from "../../../src/_util.ts";
import { authByKey, audit } from "../../../src/_auth.ts";
import {
  getBoardBySlug, updateBoard, deleteBoard, serializeBoard, countBoardPosts,
  boardHasPassword, NAME_MAX, DESC_MAX, BOARD_PASS_MIN, BOARD_PASS_MAX,
} from "../../../src/_boards.ts";
import { serializePost, type Post } from "../../../src/_posts.ts";

function readSlug(context: Ctx): string {
  const raw = context.params.slug;
  return (Array.isArray(raw) ? raw[0] : raw ?? "").toLowerCase();
}

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === "OPTIONS") return preflight();

  const method = context.request.method;
  const slug = readSlug(context);
  if (!slug) return fail("invalid_slug", "缺少分区 slug", 400);

  const board = await getBoardBySlug(context.env, slug);
  if (!board) return fail("board_not_found", `分区 "${slug}" 不存在`, 404);

  if (method === "GET") {
    const url = new URL(context.request.url);
    const { limit, offset } = pageParams(url, 20, 100);
    const rootOnly = url.searchParams.get("root_only") === "1";

    const where = ["board_id = ?", "is_deleted = 0"];
    if (rootOnly) where.push("reply_to IS NULL");
    const whereSql = where.join(" AND ");

    const countRow = await context.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM posts WHERE ${whereSql}`,
    )
      .bind(board.id)
      .first<{ n: number }>();

    const res = await context.env.DB.prepare(
      `SELECT * FROM posts WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(board.id, limit, offset)
      .all<Post>();

    const rows = res.results ?? [];
    const ids = rows.map((r) => r.id);
    const replyCounts = new Map<number, number>();
    if (ids.length) {
      const ph = ids.map(() => "?").join(",");
      const rc = await context.env.DB.prepare(
        `SELECT reply_to, COUNT(*) AS n FROM posts
         WHERE is_deleted = 0 AND reply_to IN (${ph}) GROUP BY reply_to`,
      )
        .bind(...ids)
        .all<{ reply_to: number; n: number }>();
      for (const r of rc.results ?? []) replyCounts.set(r.reply_to, r.n);
    }

    const total = await countBoardPosts(context.env, board.id);

    return ok({
      board: serializeBoard(board, total),
      posts: rows.map((p) =>
        serializePost(p, { replies: replyCounts.get(p.id) ?? 0, boardSlug: board.slug, boardName: board.name }),
      ),
      total: countRow?.n ?? 0,
      pagination: { limit, offset, count: rows.length },
      filters: { root_only: rootOnly },
    });
  }

  // 以下都需要 KEY 与分区主身份
  if (isBrowserOrigin(context.request)) {
    return fail("browser_forbidden", "该接口不接受浏览器跨站调用", 403);
  }

  const body = await readJson(context.request);
  const key = await readKey({ body, request: context.request });
  if (!key) return fail("key_required", "缺少 KEY", 401);
  const auth = await authByKey(context.env, key);
  if (!auth) return fail("invalid_key", "KEY 无效或已吊销", 401);
  if (auth.scope !== "write") return fail("readonly_key", "该子 KEY 是只读权限", 403);

  const isOwner = board.owner_id === auth.account.id;
  if (!isOwner) return fail("forbidden", "只有分区创建者可以修改这个分区", 403);

  if (method === "DELETE") {
    const n = await countBoardPosts(context.env, board.id);
    if (n > 0) {
      return fail("board_not_empty", `分区内还有 ${n} 条帖子，先删帖再删分区`, 409);
    }
    await deleteBoard(context.env, board.id);
    await audit(context.env, auth.account.id, "delete_board", board.slug);
    return ok({ deleted: board.slug });
  }

  if (method === "PATCH" || method === "POST") {
    if (!body) return fail("invalid_body", "请求体必须是 application/json 对象", 400);
    const fields: { name?: string; description?: string; is_locked?: number; pass_hash?: string } = {};

    if (body.name !== undefined) {
      const n = clampString(body.name, NAME_MAX);
      if (!n) return fail("invalid_name", "name 不能为空", 400);
      fields.name = n;
    }
    if (body.description !== undefined || body.desc !== undefined) {
      fields.description = clampString(body.description ?? body.desc, DESC_MAX);
    }
    if (body.is_locked !== undefined) {
      fields.is_locked = body.is_locked === 1 || body.is_locked === true ? 1 : 0;
    }
    if (body.password !== undefined) {
      const pw = typeof body.password === "string" ? body.password : "";
      if (pw.length > BOARD_PASS_MAX) {
        return fail("password_too_long", `分区密码最多 ${BOARD_PASS_MAX} 个字符`, 400);
      }
      if (pw && pw.length < BOARD_PASS_MIN) {
        return fail("password_too_short", `分区密码至少 ${BOARD_PASS_MIN} 个字符`, 400);
      }
      fields.pass_hash = pw ? await sha256Hex(pw) : "";
    }

    if (!Object.keys(fields).length) {
      return fail("nothing_to_update", "没有可更新的字段（name / description / password / is_locked）", 400);
    }
    await updateBoard(context.env, board.id, fields);
    await audit(context.env, auth.account.id, "update_board", board.slug);

    const fresh = await getBoardBySlug(context.env, slug);
    return ok({
      board: fresh ? serializeBoard(fresh, await countBoardPosts(context.env, fresh.id)) : null,
      notice:
        body.password !== undefined
          ? boardHasPassword(fresh as never)
            ? "分区密码已更新，新密码不会返回。"
            : "分区密码已清除，现在任何人都能发帖。"
          : undefined,
    });
  }

  return fail("method_not_allowed", "支持 GET / PATCH / DELETE", 405);
}
