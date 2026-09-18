// /api/auth/subkey - 子 KEY 的签发 / 列表 / 吊销
// 仅主 KEY 可操作。
import { Ctx, fail, ok, preflight, readJson, readKey, isBrowserOrigin, clampString } from "../core/_util.ts";
import { authByKey, issueSubkey, listSubkeys, revokeSubkey, audit } from "../core/_auth.ts";

async function resolveMaster(context: Ctx, body: Record<string, unknown> | null) {
  const key = await readKey({ body, request: context.request });
  if (!key) return { error: fail("key_required", "缺少 KEY", 401) } as const;
  const auth = await authByKey(context.env, key);
  if (!auth) return { error: fail("invalid_key", "KEY 无效或已吊销", 401) } as const;
  if (auth.via !== "master") {
    return { error: fail("master_key_required", "子 KEY 管理只能用主 KEY 操作", 403) } as const;
  }
  return { auth } as const;
}

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === "OPTIONS") return preflight();
  if (isBrowserOrigin(context.request)) {
    return fail("browser_forbidden", "该接口不接受浏览器跨站调用", 403);
  }

  const method = context.request.method;
  const body = method === "GET" ? null : await readJson(context.request);
  const resolved = await resolveMaster(context, body);
  if ("error" in resolved) return resolved.error;
  const { auth } = resolved;

  if (method === "GET") {
    return ok({ subkeys: await listSubkeys(context.env, auth.account.id) });
  }

  if (method === "POST") {
    const label = clampString(body?.label ?? "", 40);
    const scope = clampString(body?.scope ?? "read", 10);
    if (scope !== "read" && scope !== "write") {
      return fail("invalid_scope", "scope 只能是 read 或 write", 400);
    }
    const created = await issueSubkey(context.env, auth.account.id, label, scope);
    await audit(context.env, auth.account.id, "issue_subkey", `${created.id}:${scope}`);
    return ok(
      {
        subkey: { id: created.id, label: created.label, scope: created.scope },
        key: created.key,
        warning: "子 KEY 仅此一次明文返回，请立刻保存。",
      },
      201,
    );
  }

  if (method === "DELETE") {
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) return fail("invalid_id", "需要整数 id", 400);
    const done = await revokeSubkey(context.env, auth.account.id, id);
    if (!done) return fail("not_found", `未找到可吊销的子 KEY id=${id}`, 404);
    await audit(context.env, auth.account.id, "revoke_subkey", String(id));
    return ok({ revoked: id });
  }

  return fail("method_not_allowed", "支持 GET / POST / DELETE", 405);
}
