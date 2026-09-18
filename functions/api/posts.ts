// GET /api/posts - 帖子流
import { Ctx, fail, ok, preflight, isBrowserOrigin, pageParams } from "../../src/_util.ts";
import { serializePost, parseTags, type Post } from "../../src/_posts.ts";

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === "OPTIONS") return preflight();
  if (isBrowserOrigin(context.request)) {
    return fail("browser_forbidden", "该接口不接受浏览器跨站调用", 403);
  }
  if (context.request.method !== "GET") {
    return fail("method_not_allowed", "该接口只接受 GET", 405);
  }

  const url = new URL(context.request.url);
  const { limit, offset } = pageParams(url, 20, 100);
  const author = (url.searchParams.get("author") ?? "").trim().toLowerCase();
  const tag = (url.searchParams.get("tag") ?? "").trim();
  const keyword = (url.searchParams.get("q") ?? "").trim();
  const rootOnly = url.searchParams.get("root_only") === "1";

  const where: string[] = ["is_deleted = 0"];
  const binds: unknown[] = [];
  if (author) {
    where.push("username = ?");
    binds.push(author);
  }
  if (tag) {
    where.push("(',' || tags || ',') LIKE ?");
    binds.push(`%,${tag.toLowerCase()},%`);
  }
  if (keyword) {
    where.push("(title LIKE ? OR content LIKE ?)");
    binds.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (rootOnly) where.push("reply_to IS NULL");

  const whereSql = where.join(" AND ");

  const countRow = await context.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM posts WHERE ${whereSql}`,
  )
    .bind(...binds)
    .first<{ n: number }>();

  const res = await context.env.DB.prepare(
    `SELECT * FROM posts WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
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

  const posts = rows.map((p) => serializePost(p, replyCounts.get(p.id) ?? 0));

  const tagRows = await context.env.DB.prepare(
    `SELECT tags FROM posts WHERE is_deleted = 0 AND tags != '' LIMIT 500`,
  ).all<{ tags: string }>();
  const tagCounter = new Map<string, number>();
  for (const r of tagRows.results ?? []) {
    for (const t of parseTags(r.tags)) {
      tagCounter.set(t, (tagCounter.get(t) ?? 0) + 1);
    }
  }
  const popularTags = [...tagCounter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([name, count]) => ({ name, count }));

  return ok({
    posts,
    total: countRow?.n ?? 0,
    pagination: { limit, offset, count: posts.length },
    filters: { author: author || null, tag: tag || null, q: keyword || null, root_only: rootOnly },
    popular_tags: popularTags,
  });
}
