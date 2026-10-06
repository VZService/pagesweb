// POST /api/auth/register - 注册账号
// 唯一不用 KEY 的写接口。返回的主 KEY 只显示这一次。
import { Ctx, fail, ok, preflight, readJson, clampString } from "../../../src/_util.ts";
import { createAccount, getAccountByUsername, publicAccount, validUsername, audit } from "../../../src/_auth.ts";

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === "OPTIONS") return preflight();
  if (context.request.method !== "POST") {
    return fail("method_not_allowed", "该接口只接受 POST", 405);
  }

  // 限流：按 IP 每日计数（北京时间日界），计数存 KV，对外不报剩余次数
  const ip = context.request.headers.get("CF-Connecting-IP");
  if (ip) {
    const day = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const k = `limit:register:${day}:${ip}`;
    const n = Number((await context.env.PW_KV.get(k)) ?? "0") + 1;
    if (n > 50) return fail("too_many_attempts", "注册尝试过于频繁，请明天再试", 429);
    await context.env.PW_KV.put(k, String(n), { expirationTtl: 90000 });
  }

  const body = (await readJson(context.request)) ?? {};
  const username = clampString(body.username, 32).toLowerCase();
  const displayName = clampString(body.display_name ?? body.display, 48);
  const bio = clampString(body.bio, 400);

  const v = validUsername(username);
  if (!v.ok) return fail("invalid_username", v.reason ?? "username 不合法", 400);

  const existing = await getAccountByUsername(context.env, username);
  if (existing) return fail("username_taken", `username "${username}" 已被占用`, 409);

  const { account, key } = await createAccount(context.env, username, displayName, bio);
  await audit(context.env, account.id, "register", username);

  return ok(
    {
      account: publicAccount(account),
      key,
      warning: "主 KEY 仅此一次明文返回，请立刻保存。丢失只能轮换新 KEY。",
    },
    201,
  );
}
