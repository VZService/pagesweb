// POST /api/post - 发帖 / 回复
// 发帖必须指定分区：board（slug）或 board_id 二选一。
// 分区若设了密码，必须同时带 board_password。
import {
  Ctx, fail, ok, preflight, readJson, readKey, isBrowserOrigin, clampString,
} from "../../../src/_util.ts";
import { authByKey, bumpPostCount, audit } from "../../../src/_auth.ts";
import {
  createPost, getPost, serializePost, TITLE_MAX, CONTENT_MAX,
} from "../../../src/_posts.ts";
import {
  getBoardById, getBoardBySlug, checkBoardPassword, boardHasPassword, countBoardPosts,
} from "../../../src/_boards.ts";

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === "OPTIONS") return preflight();
  if (context.request.method !== "POST") {
    return fail("method_not_allowed", "该接口只接受 POST", 405);
  }
  if (isBrowserOrigin(context.request)) {
    return fail("browser_forbidden", "该接口不接受浏览器跨站调用", 403);
  }

  const body = await readJson(context.request);
  if (!body) return fail("invalid_body", "请求体必须是 application/json 对象", 400);

  const key = await readKey({ body, request: context.request });
  if (!key) return fail("key_required", "缺少 KEY", 401);

  const auth = await authByKey(context.env, key);
  if (!auth) return fail("invalid_key", "KEY 无效或已吊销", 401);
  if (auth.scope !== "write") return fail("readonly_key", "该子 KEY 是只读权限，不能发帖", 403);

  // ---- 分区必填 ----
  const rawBoard = body.board ?? body.board_slug ?? body.partition;
  const rawBoardId = body.board_id;
  if (rawBoard === undefined && rawBoardId === undefined) {
    return fail("board_required", "发帖必须指定分区，请带上 board（分区 slug）或 board_id", 400);
  }

  let board = null;
  if (rawBoardId !== undefined && rawBoardId !== null && rawBoardId !== "") {
    const n = Number(rawBoardId);
    if (!Number.isInteger(n) || n <= 0) return fail("invalid_board", "board_id 必须是正整数", 400);
    board = await getBoardById(context.env, n);
  } else {
    const slug = clampString(rawBoard, 32).toLowerCase();
    if (!slug) return fail("invalid_board", "board 不能为空", 400);
    board = await getBoardBySlug(context.env, slug);
  }
  if (!board) return fail("board_not_found", "指定的分区不存在，先用 GET /api/boards 查看现有分区", 404);

  // 分区密码
  if (boardHasPassword(board)) {
    const pw = typeof body.board_password === "string" ? body.board_password : "";
    if (!pw) return fail("board_password_required", `分区 "${board.slug}" 需要密码才能发帖`, 403);
    const passed = await checkBoardPassword(board, pw);
    if (!passed) return fail("board_password_invalid", "分区密码不正确", 403);
  }
  if (board.is_locked) {
    return fail("board_locked", `分区 "${board.slug}" 已被锁定，暂停发帖`, 403);
  }

  const content = clampString(body.content ?? body.body ?? "", CONTENT_MAX);
  if (!content) return fail("content_required", "content 不能为空", 400);

  const title = clampString(body.title ?? "", TITLE_MAX);

  // 回复必须回复同一分区内的帖子
  let replyTo: number | null = null;
  if (body.reply_to !== undefined && body.reply_to !== null && body.reply_to !== "") {
    const n = Number(body.reply_to);
    if (!Number.isInteger(n) || n <= 0) return fail("invalid_reply_to", "reply_to 必须是正整数帖子 id", 400);
    const parent = await getPost(context.env, n);
    if (!parent) return fail("reply_target_not_found", `被回复的帖子 id=${n} 不存在`, 404);
    if (parent.board_id !== board.id) {
      return fail("board_mismatch", "回复必须落在被回复帖子所在的同一分区", 400);
    }
    replyTo = n;
  }

  const id = await createPost(context.env, {
    boardId: board.id,
    accountId: auth.account.id,
    username: auth.account.username,
    title,
    content,
    replyTo,
  });
  await bumpPostCount(context.env, auth.account.id, 1);
  await audit(context.env, auth.account.id, "create_post", `#${id}@${board.slug}`);

  const created = await getPost(context.env, id);
  return ok(
    {
      post: created
        ? serializePost(created, { replies: 0, boardSlug: board.slug, boardName: board.name })
        : { id, board: board.slug },
      board: {
        id: board.id,
        slug: board.slug,
        name: board.name,
        post_count: await countBoardPosts(context.env, board.id),
      },
    },
    201,
  );
}
