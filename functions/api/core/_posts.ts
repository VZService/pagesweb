// 帖子模型

import { nowMs, clampString, type Env } from "./_util";

export interface Post {
  id: number;
  account_id: number | null;
  username: string;
  title: string;
  content: string;
  reply_to: number | null;
  tags: string;
  created_at: number;
  updated_at: number;
  is_deleted: number;
}

export const TITLE_MAX = 200;
export const CONTENT_MAX = 20000;
export const TAG_MAX = 10;

export function normalizeTags(input: unknown): string {
  let list: string[] = [];
  if (Array.isArray(input)) {
    list = input.map((t) => clampString(t, 32)).filter(Boolean);
  } else if (typeof input === "string") {
    list = input
      .split(/[,\s]+/)
      .map((t) => clampString(t, 32))
      .filter(Boolean);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of list) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= TAG_MAX) break;
  }
  return out.join(",");
}

export function parseTags(raw: string): string[] {
  if (!raw) return [];
  return raw.split(",").map((t) => t.trim()).filter(Boolean);
}

export async function createPost(
  env: Env,
  input: {
    accountId: number | null;
    username: string;
    title: string;
    content: string;
    replyTo?: number | null;
    tags?: string;
  },
): Promise<number> {
  const ts = nowMs();
  const res = await env.DB.prepare(
    `INSERT INTO posts (account_id, username, title, content, reply_to, tags, created_at, updated_at, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  )
    .bind(
      input.accountId,
      input.username,
      input.title,
      input.content,
      input.replyTo ?? null,
      input.tags ?? "",
      ts,
      ts,
    )
    .run();
  return Number(res.meta.last_row_id);
}

export async function getPost(env: Env, id: number): Promise<Post | null> {
  const row = await env.DB.prepare(`SELECT * FROM posts WHERE id = ?`).bind(id).first<Post>();
  if (!row || row.is_deleted) return null;
  return row;
}

export async function softDeletePost(env: Env, id: number): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE posts SET is_deleted = 1, updated_at = ? WHERE id = ? AND is_deleted = 0`,
  )
    .bind(nowMs(), id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function updatePost(
  env: Env,
  id: number,
  fields: { title?: string; content?: string; tags?: string },
): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (fields.title !== undefined) {
    sets.push("title = ?");
    vals.push(fields.title);
  }
  if (fields.content !== undefined) {
    sets.push("content = ?");
    vals.push(fields.content);
  }
  if (fields.tags !== undefined) {
    sets.push("tags = ?");
    vals.push(fields.tags);
  }
  if (!sets.length) return false;
  sets.push("updated_at = ?");
  vals.push(nowMs(), id);
  const res = await env.DB.prepare(`UPDATE posts SET ${sets.join(", ")} WHERE id = ? AND is_deleted = 0`)
    .bind(...vals)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export function serializePost(p: Post, replies?: number) {
  return {
    id: p.id,
    author: p.username,
    title: p.title,
    content: p.content,
    tags: parseTags(p.tags),
    reply_to: p.reply_to,
    reply_count: replies ?? undefined,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}
