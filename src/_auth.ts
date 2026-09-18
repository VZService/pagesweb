// 账号模型与 KEY 鉴权
// 每个账号有一把主 KEY；主 KEY 可签发子 KEY（只读 / 可写），子 KEY 可单独吊销。

import { ensureSchema } from "./_db";
import { nowMs, sha256Hex, randomKey, type Env } from "./_util";

export interface Account {
  id: number;
  username: string;
  display_name: string;
  bio: string;
  created_at: number;
  updated_at: number;
  last_seen_at: number | null;
  post_count: number;
  is_admin: number;
}

export interface AuthResult {
  account: Account;
  via: "master" | "subkey";
  scope: "read" | "write";
  subkey_id: number | null;
}

const USERNAME_RE = /^[a-z0-9_](?:[a-z0-9_-]{1,30})[a-z0-9_]$/;
const RESERVED = new Set([
  "api", "admin", "root", "system", "pagesweb", "me", "null", "undefined",
  "login", "register", "help", "docs", "post", "posts", "account",
]);

export function validUsername(name: string): { ok: boolean; reason?: string } {
  if (!name) return { ok: false, reason: "username 不能为空" };
  if (name.length < 3) return { ok: false, reason: "username 至少 3 个字符" };
  if (name.length > 32) return { ok: false, reason: "username 最多 32 个字符" };
  if (!USERNAME_RE.test(name)) {
    return { ok: false, reason: "username 只允许小写字母、数字、下划线、连字符，且首尾必须是字母或数字" };
  }
  if (RESERVED.has(name)) return { ok: false, reason: `username "${name}" 是保留名` };
  return { ok: true };
}

export async function createAccount(
  env: Env,
  username: string,
  displayName: string,
  bio: string,
): Promise<{ account: Account; key: string }> {
  await ensureSchema(env);
  const key = randomKey("pw");
  const keyHash = await sha256Hex(key);
  const ts = nowMs();
  const res = await env.DB.prepare(
    `INSERT INTO accounts (username, display_name, key_hash, bio, created_at, updated_at, post_count, is_admin)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
  )
    .bind(username, displayName || username, keyHash, bio, ts, ts)
    .run();
  const id = Number(res.meta.last_row_id);
  const account = await getAccountById(env, id);
  return { account: account as Account, key };
}

export async function getAccountById(env: Env, id: number): Promise<Account | null> {
  const row = await env.DB.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(id).first<Account>();
  return row ?? null;
}

export async function getAccountByUsername(env: Env, username: string): Promise<Account | null> {
  const row = await env.DB.prepare(`SELECT * FROM accounts WHERE username = ?`).bind(username).first<Account>();
  return row ?? null;
}

export async function authByKey(env: Env, key: string): Promise<AuthResult | null> {
  if (!key) return null;
  await ensureSchema(env);
  const hash = await sha256Hex(key);

  const acc = await env.DB.prepare(`SELECT * FROM accounts WHERE key_hash = ?`).bind(hash).first<Account>();
  if (acc) {
    await env.DB.prepare(`UPDATE accounts SET last_seen_at = ? WHERE id = ?`).bind(nowMs(), acc.id).run();
    return { account: acc, via: "master", scope: "write", subkey_id: null };
  }

  const sk = await env.DB.prepare(
    `SELECT * FROM subkeys WHERE key_hash = ? AND revoked_at IS NULL`,
  )
    .bind(hash)
    .first<{ id: number; account_id: number; scope: string }>();
  if (!sk) return null;
  const owner = await getAccountById(env, sk.account_id);
  if (!owner) return null;
  await env.DB.prepare(`UPDATE accounts SET last_seen_at = ? WHERE id = ?`).bind(nowMs(), owner.id).run();
  return {
    account: owner,
    via: "subkey",
    scope: sk.scope === "write" ? "write" : "read",
    subkey_id: sk.id,
  };
}

export async function rotateMasterKey(env: Env, accountId: number): Promise<string> {
  const key = randomKey("pw");
  const hash = await sha256Hex(key);
  await env.DB.prepare(`UPDATE accounts SET key_hash = ?, updated_at = ? WHERE id = ?`)
    .bind(hash, nowMs(), accountId)
    .run();
  return key;
}

export async function issueSubkey(
  env: Env,
  accountId: number,
  label: string,
  scope: string,
): Promise<{ id: number; key: string; scope: string; label: string }> {
  const key = randomKey("pk");
  const hash = await sha256Hex(key);
  const cleanScope = scope === "write" ? "write" : "read";
  const res = await env.DB.prepare(
    `INSERT INTO subkeys (account_id, label, key_hash, prefix, scope, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(accountId, label, hash, key.slice(0, 11), cleanScope, nowMs())
    .run();
  return { id: Number(res.meta.last_row_id), key, scope: cleanScope, label };
}

export async function revokeSubkey(env: Env, accountId: number, id: number): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE subkeys SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL`,
  )
    .bind(nowMs(), id, accountId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function listSubkeys(env: Env, accountId: number) {
  const res = await env.DB.prepare(
    `SELECT id, label, prefix, scope, created_at, revoked_at FROM subkeys
     WHERE account_id = ? ORDER BY id DESC`,
  )
    .bind(accountId)
    .all();
  return res.results ?? [];
}

export async function bumpPostCount(env: Env, accountId: number | null, delta: number): Promise<void> {
  if (!accountId) return;
  await env.DB.prepare(`UPDATE accounts SET post_count = MAX(0, post_count + ?) WHERE id = ?`)
    .bind(delta, accountId)
    .run();
}

export async function audit(
  env: Env,
  accountId: number | null,
  action: string,
  detail = "",
): Promise<void> {
  try {
    await env.DB.prepare(`INSERT INTO audit_log (account_id, action, detail, created_at) VALUES (?, ?, ?, ?)`)
      .bind(accountId, action, detail, nowMs())
      .run();
  } catch {
    // 审计失败不影响主流程
  }
}

export function publicAccount(a: Account) {
  return {
    id: a.id,
    username: a.username,
    display_name: a.display_name,
    bio: a.bio,
    post_count: a.post_count,
    created_at: a.created_at,
    last_seen_at: a.last_seen_at,
  };
}
