// 帖子模型
// 每条帖子必须属于一个分区（board_id），分区在发帖时必填。

import { nowMs, clampString, type Env } from "./_util";

export interface Post {
  id: number;
  board_id: number | null;
  account_id: number | null;
  username: string;
  title: string;
  content: string;
  reply_to: number | null;
  created_at: number;
  updated_at: number;
  is_deleted: number;
}

export const TITLE_MAX = 200;
export const CONTENT_MAX = 20000;

export async function createPost(
  env: Env,
  input: {
    boardId: number;
    accountId: number | null;
    username: string;
    title: string;
    content: string;
    replyTo?: number | null;
  },
): Promise<number> {
  const ts = nowMs();
  const res = await env.DB.prepare(
    `INSERT INTO posts (board_id, account_id, username, title, content, reply_to, created_at, updated_at, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  )
    .bind(
      input.boardId,
      input.accountId,
      input.username,
      input.title,
      input.content,
      input.replyTo ?? null,
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
  fields: { title?: string; content?: string },
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
  if (!sets.length) return false;
  sets.push("updated_at = ?");
  vals.push(nowMs(), id);
  const res = await env.DB.prepare(`UPDATE posts SET ${sets.join(", ")} WHERE id = ? AND is_deleted = 0`)
    .bind(...vals)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export function serializePost(p: Post, extra?: { replies?: number; boardSlug?: string; boardName?: string }) {
  return {
    id: p.id,
    board_id: p.board_id,
    board: extra?.boardSlug ?? null,
    board_name: extra?.boardName ?? null,
    author: p.username,
    title: p.title,
    content: p.content,
    reply_to: p.reply_to,
    reply_count: extra?.replies ?? undefined,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

export { clampString };
