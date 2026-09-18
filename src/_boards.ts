// 分区模型
// 发帖必须落在某个分区里。分区由已登录（持有 KEY）的人创建，可以设置密码。
// 密码不为空时，只有带正确分区密码的请求才能在其下发帖 / 回复。

import { nowMs, sha256Hex, clampString, type Env } from "./_util";
import { ensureSchema } from "./_db";

export interface Board {
  id: number;
  slug: string;
  name: string;
  description: string;
  owner_id: number | null;
  owner_name: string;
  is_locked: number;
  pass_hash: string;
  created_at: number;
  updated_at: number;
}

export const SLUG_RE = /^[a-z0-9_](?:[a-z0-9_-]{0,30})[a-z0-9_]$/;
export const NAME_MAX = 48;
export const DESC_MAX = 300;
export const BOARD_PASS_MIN = 4;
export const BOARD_PASS_MAX = 128;

const RESERVED_SLUGS = new Set([
  "api", "admin", "root", "system", "me", "null", "undefined",
  "login", "register", "help", "docs", "post", "posts", "account",
  "board", "boards", "new", "all", "list",
]);

export function validSlug(slug: string): { ok: boolean; reason?: string } {
  if (!slug) return { ok: false, reason: "slug 不能为空" };
  if (slug.length < 2) return { ok: false, reason: "slug 至少 2 个字符" };
  if (slug.length > 32) return { ok: false, reason: "slug 最多 32 个字符" };
  if (!SLUG_RE.test(slug)) {
    return { ok: false, reason: "slug 只允许小写字母、数字、下划线、连字符，且首尾必须是字母或数字" };
  }
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: `slug "${slug}" 是保留名` };
  return { ok: true };
}

export async function createBoard(
  env: Env,
  input: {
    slug: string;
    name: string;
    description: string;
    ownerId: number;
    ownerName: string;
    password: string;
  },
): Promise<number> {
  await ensureSchema(env);
  const ts = nowMs();
  const hash = input.password ? await sha256Hex(input.password) : "";
  const res = await env.DB.prepare(
    `INSERT INTO boards (slug, name, description, owner_id, owner_name, is_locked, pass_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  )
    .bind(
      input.slug,
      input.name || input.slug,
      input.description,
      input.ownerId,
      input.ownerName,
      hash,
      ts,
      ts,
    )
    .run();
  return Number(res.meta.last_row_id);
}

export async function getBoardById(env: Env, id: number): Promise<Board | null> {
  const row = await env.DB.prepare(`SELECT * FROM boards WHERE id = ?`).bind(id).first<Board>();
  return row ?? null;
}

export async function getBoardBySlug(env: Env, slug: string): Promise<Board | null> {
  const row = await env.DB.prepare(`SELECT * FROM boards WHERE slug = ?`).bind(slug).first<Board>();
  return row ?? null;
}

export async function listBoards(env: Env): Promise<Board[]> {
  const res = await env.DB.prepare(`SELECT * FROM boards ORDER BY id ASC LIMIT 500`).all<Board>();
  return res.results ?? [];
}

export async function updateBoard(
  env: Env,
  id: number,
  fields: { name?: string; description?: string; is_locked?: number; pass_hash?: string },
): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (fields.name !== undefined) {
    sets.push("name = ?");
    vals.push(fields.name);
  }
  if (fields.description !== undefined) {
    sets.push("description = ?");
    vals.push(fields.description);
  }
  if (fields.is_locked !== undefined) {
    sets.push("is_locked = ?");
    vals.push(fields.is_locked);
  }
  if (fields.pass_hash !== undefined) {
    sets.push("pass_hash = ?");
    vals.push(fields.pass_hash);
  }
  if (!sets.length) return false;
  sets.push("updated_at = ?");
  vals.push(nowMs(), id);
  const res = await env.DB.prepare(`UPDATE boards SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...vals)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteBoard(env: Env, id: number): Promise<boolean> {
  const res = await env.DB.prepare(`DELETE FROM boards WHERE id = ?`).bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function countBoardPosts(env: Env, boardId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM posts WHERE board_id = ? AND is_deleted = 0`,
  )
    .bind(boardId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export function boardHasPassword(b: Board): boolean {
  return !!b.pass_hash;
}

// 分区密码校验：无密码的分区任何人可发；有密码时必须给对。
export async function checkBoardPassword(board: Board, password: string): Promise<boolean> {
  if (!board.pass_hash) return true;
  if (!password) return false;
  const hash = await sha256Hex(password);
  return hash === board.pass_hash;
}

export function serializeBoard(b: Board, postCount?: number) {
  return {
    id: b.id,
    slug: b.slug,
    name: b.name,
    description: b.description,
    owner: b.owner_name,
    has_password: boardHasPassword(b),
    is_locked: !!b.is_locked,
    post_count: postCount,
    created_at: b.created_at,
    updated_at: b.updated_at,
  };
}

export function normalizeSlug(input: unknown): string {
  const s = clampString(input, 32).toLowerCase();
  return s.replace(/\s+/g, "-");
}
