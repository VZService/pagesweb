// D1 schema 迁移
// TABLE_CREATES 内的语句无条件幂等执行；SCHEMA_VERSION 变更时补跑 MIGRATIONS。
// 注意：任何新增表都放进 TABLE_CREATES，并同时 bump SCHEMA_VERSION，否则不会执行。

import { SCHEMA_VERSION, type Env } from "./_util";

const TABLE_CREATES: string[] = [
  `CREATE TABLE IF NOT EXISTS accounts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      display_name  TEXT NOT NULL,
      key_hash      TEXT NOT NULL UNIQUE,
      bio           TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      last_seen_at  INTEGER,
      post_count    INTEGER NOT NULL DEFAULT 0,
      is_admin      INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_key_hash ON accounts (key_hash)`,

  `CREATE TABLE IF NOT EXISTS posts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id    INTEGER,
      username      TEXT NOT NULL,
      title         TEXT NOT NULL DEFAULT '',
      content       TEXT NOT NULL DEFAULT '',
      reply_to      INTEGER,
      tags          TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      is_deleted    INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_username ON posts (username)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_reply_to ON posts (reply_to)`,

  `CREATE TABLE IF NOT EXISTS subkeys (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id    INTEGER NOT NULL,
      label         TEXT NOT NULL DEFAULT '',
      key_hash      TEXT NOT NULL UNIQUE,
      prefix        TEXT NOT NULL,
      scope         TEXT NOT NULL DEFAULT 'read',
      created_at    INTEGER NOT NULL,
      revoked_at    INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_subkeys_account ON subkeys (account_id)`,

  `CREATE TABLE IF NOT EXISTS audit_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id    INTEGER,
      action        TEXT NOT NULL,
      detail        TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL
  )`,
];

const MIGRATIONS: Record<string, string[]> = {
  v1: [],
  v2: [],
  v3: [],
};

export async function ensureSchema(env: Env): Promise<void> {
  for (const sql of TABLE_CREATES) {
    await env.DB.prepare(sql).run();
  }
  try {
    const flag = await env.PW_KV.get(`schema:${SCHEMA_VERSION}`);
    if (flag) return;
  } catch {
    // KV 不可用时退化为每次都尝试迁移，迁移本身幂等
  }
  const steps = MIGRATIONS[SCHEMA_VERSION] ?? [];
  for (const sql of steps) {
    try {
      await env.DB.prepare(sql).run();
    } catch {
      // 已存在的列/索引重复创建会报错，忽略
    }
  }
  try {
    await env.PW_KV.put(`schema:${SCHEMA_VERSION}`, String(Date.now()));
  } catch {
    // 忽略
  }
}
