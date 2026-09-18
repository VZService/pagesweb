// GET /api/posts - 帖子流
import { Ctx, fail, ok, preflight, pageParams } from "../../src/_util.ts";
import { serializePost, type Post } from "../../src/_posts.ts";
import { getBoardBySlug, listBoards, serializeBoard, countBoardPosts } from "../../src/_boards.ts";

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === "OPTIONS") return preflight();
  if (context.request.method !== "GET") {
    return fail("method_not_allowed", "该接口只接受 GET", 405);
  }

  const url = new URL(context.request.url);
  const { limit, offset } = pageParams(url, 20, 100);
  const author = (url.searchParams.get("author") ?? "").trim().toLowerCase();
  const boardSlug = (url.searchParams.get("board") ?? "").trim().toLowerCase();
  const keyword = (url.searchParams.get("q") ?? "").trim();
  const rootOnly = url.searchParams.get("root_only") === "1";

  const where: string[] = ["p.is_deleted = 0"];
  const binds: unknown[] = [];
  if (author) {
    where.push("p.username = ?");
    binds.push(author);
  }
  if (boardSlug) {
    const b = await getBoardBySlug(context.env, boardSlug);
    if (!b) return fail("board_not_found", `分区 "${boardSlug}" 不存在`, 404);
    where.push("p.board_id = ?");
    binds.push(b.id);
  }
  if (keyword) {
    where.push("(p.title LIKE ? OR p.content LIKE ?)");
    binds.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (rootOnly) where.push("p.reply_to IS NULL");

  const whereSql = where.join(" AND ");

  const countRow = await context.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM posts p WHERE ${whereSql}`,
  )
    .bind(...binds)
    .first<{ n: number }>();

  const res = await context.env.DB.prepare(
    `SELECT p.* FROM posts p WHERE ${whereSql} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<Post>();

  const rows = res.results ?? [];
  const ids = rows.map((r) => r.id);
  const replyCounts = new Map<number, number>();
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const rc = await context.env.DB.prepare(
      `SELECT reply_to, COUNT(*) AS n FROM posts
       WHERE is_deleted = 0 AND reply_to IN (${placeholders}) GROUP BY reply_to`,
    )
      .bind(...ids)
      .all<{ reply_to: number; n: number }>();
    for (const r of rc.results ?? []) replyCounts.set(r.reply_to, r.n);
  }

  // 分区名映射，避免每条帖子单独查库
  const boards = await listBoards(context.env);
  const boardMap = new Map(boards.map((b) => [b.id, b]));

  const posts = rows.map((p) => {
    const b = p.board_id === null ? undefined : boardMap.get(p.board_id);
    return serializePost(p, {
      replies: replyCounts.get(p.id) ?? 0,
      boardSlug: b?.slug,
      boardName: b?.name,
    });
  });

  const boardList = [];
  for (const b of boards) {
    boardList.push(serializeBoard(b, await countBoardPosts(context.env, b.id)));
  }

  return ok({
    posts,
    total: countRow?.n ?? 0,
    pagination: { limit, offset, count: posts.length },
    filters: { author: author || null, board: boardSlug || null, q: keyword || null, root_only: rootOnly },
    boards: boardList,
  });
}
