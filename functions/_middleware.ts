// 中间件：统一安全响应头
// 平台无 GUI，全部响应都是 JSON 或纯文本，禁止被 iframe 嵌入。

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

export async function onRequest(context: {
  request: Request;
  next: () => Promise<Response>;
}): Promise<Response> {
  const res = await context.next();
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    out.headers.set(k, v);
  }
  return out;
}
