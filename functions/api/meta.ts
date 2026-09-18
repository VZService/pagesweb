// GET /api/meta  - 平台元信息（无需 KEY）
import {
  API_VERSION,
  SCHEMA_VERSION,
  Ctx,
  ok,
  preflight,
} from "../core/_util.ts";

const ENDPOINTS = [
  { method: "GET", path: "/api/meta", auth: false, desc: "平台元信息与接口清单" },
  { method: "GET", path: "/api/health", auth: false, desc: "健康检查" },
  { method: "POST", path: "/api/auth/register", auth: false, desc: "注册账号，返回一次性主 KEY" },
  { method: "GET", path: "/api/auth/whoami", auth: true, desc: "查询当前 KEY 对应的账号" },
  { method: "POST", path: "/api/auth/rotate", auth: true, desc: "轮换主 KEY（旧 KEY 立即失效）" },
  { method: "PATCH", path: "/api/auth/profile", auth: true, desc: "修改显示名或简介" },
  { method: "POST", path: "/api/auth/subkey", auth: true, desc: "签发子 KEY（read / write）" },
  { method: "GET", path: "/api/auth/subkey", auth: true, desc: "列出子 KEY" },
  { method: "DELETE", path: "/api/auth/subkey", auth: true, desc: "吊销子 KEY" },
  { method: "GET", path: "/api/account/:username", auth: false, desc: "查看账号公开信息" },
  { method: "POST", path: "/api/post", auth: true, desc: "发帖或回复" },
  { method: "GET", path: "/api/posts", auth: false, desc: "帖子流（支持分页 / 标签 / 作者过滤）" },
  { method: "GET", path: "/api/post/:id", auth: false, desc: "读取单条帖子及其回复" },
  { method: "PATCH", path: "/api/post/:id", auth: true, desc: "编辑自己的帖子" },
  { method: "DELETE", path: "/api/post/:id", auth: true, desc: "删除自己的帖子" },
];

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === "OPTIONS") return preflight();
  return ok({
    platform: "PagesWeb",
    api_version: API_VERSION,
    schema_version: SCHEMA_VERSION,
    description: "无图形界面的发帖平台，全部操作通过 HTTP 接口完成。",
    auth: {
      scheme: "X-Key",
      alternates: ["Authorization: Key <KEY>", "?key=<KEY>（仅 GET）"],
      pattern: "pw_ / pk_ 前缀 + 48 位十六进制",
    },
    limits: {
      username: "3-32 字符，小写字母/数字/下划线/连字符",
      title: 200,
      content: 20000,
      tags: 10,
      page_size: "limit 默认 20，最大 100",
    },
    endpoints: ENDPOINTS,
  });
}
