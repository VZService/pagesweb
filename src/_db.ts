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

  `CREATE TABLE IF NOT EXISTS boards (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      slug          TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      owner_id      INTEGER,
      owner_name    TEXT NOT NULL DEFAULT '',
      is_locked     INTEGER NOT NULL DEFAULT 0,
      pass_hash     TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_boards_slug ON boards (slug)`,

  `CREATE TABLE IF NOT EXISTS posts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id      INTEGER,
      account_id    INTEGER,
      username      TEXT NOT NULL,
      title         TEXT NOT NULL DEFAULT '',
      content       TEXT NOT NULL DEFAULT '',
      reply_to      INTEGER,
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

  // 迁移版本标记。放 D1 里而不是只放 KV：KV 是旁路，清掉就会重跑迁移，
  // 而 v4 的迁移含 DROP TABLE，重跑会误删数据。以 D1 为准才安全。
  // 注意：表名不能叫 meta，D1 里 meta 是保留名（对应内部的 _cf_KV），建表不报错但不生效。
  `CREATE TABLE IF NOT EXISTS schema_meta (
      k             TEXT PRIMARY KEY,
      v             TEXT NOT NULL,
      updated_at    INTEGER NOT NULL
  )`,
];

const MIGRATIONS: Record<string, string[]> = {
  v1: [],
  v2: [],
  v3: [],
  v4: [
    // v4：引入分区。帖子改挂 board_id，移除 tags。
    // DROP + CREATE 而不是 ALTER：SQLite 不支持 DROP COLUMN，且旧数据本就不保留。
    `DROP TABLE IF EXISTS posts`,
    `CREATE TABLE IF NOT EXISTS posts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        board_id      INTEGER,
        account_id    INTEGER,
        username      TEXT NOT NULL,
        title         TEXT NOT NULL DEFAULT '',
        content       TEXT NOT NULL DEFAULT '',
        reply_to      INTEGER,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        is_deleted    INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_username ON posts (username)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_reply_to ON posts (reply_to)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_board ON posts (board_id)`,
  ],
};

// 迁移后才会存在的新列索引，不能放进 TABLE_CREATES：
// 那里是在迁移之前无条件跑的，旧表没有 board_id 时 CREATE INDEX 会报
// "no such column"，中断整批语句，导致迁移根本没机会执行。
const POST_MIGRATION_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_posts_board ON posts (board_id)`,
];

export async function ensureSchema(env: Env): Promise<void> {
  // 建表失败必须抛出去，否则迁移会被静默跳过，接口带着旧表结构跑，很难查。
  for (const sql of TABLE_CREATES) {
    await env.DB.prepare(sql).run();
  }

  // 以 D1 里的 schema_meta 为版本权威。KV 只作为快速短路缓存，丢了也不会重跑迁移。
  const row = await env.DB.prepare(`SELECT v FROM schema_meta WHERE k = 'schema_version'`).first<{ v: string }>();
  const applied = row?.v ?? "";

  if (applied !== SCHEMA_VERSION) {
    const steps = MIGRATIONS[SCHEMA_VERSION] ?? [];
    for (const sql of steps) {
      await env.DB.prepare(sql).run();
    }
    await env.DB.prepare(
      `INSERT INTO schema_meta (k, v, updated_at) VALUES ('schema_version', ?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
    )
      .bind(SCHEMA_VERSION, Date.now())
      .run();
    try {
      await env.PW_KV.put(`schema:${SCHEMA_VERSION}`, String(Date.now()));
    } catch {
      // KV 只是缓存，失败不影响正确性
    }
  }

  // 每次请求都跑，保证迁移刚完成的那一次也能把索引补上
  for (const sql of POST_MIGRATION_INDEXES) {
    await env.DB.prepare(sql).run();
  }
}
