// chat 能力：发一条消息给 Neodrop 的对话 agent，等回复生成完，拿完整回复。
//
// 链路（全部走用户 PAT，Bearer 鉴权）：
//   1. 建 / 复用会话：session.create（全局助手）或
//      session.getOrCreateChannelAssistant（--channel 频道助手）——tRPC mutation
//   2. 发送：POST /api/chat（非 tRPC 的 Hono 端点，后端 2026-07 起支持 PAT Bearer）。
//      响应是 SSE 流；回复由后端 BullMQ worker 生成、与本连接生命周期解耦，
//      CLI 不解析流内容，只把「流读到 EOF」当作大概率完成的信号。
//   3. 收敛：轮询 session.getActiveChatTurn 直到 null（turn 已 terminal——
//      SSE 中途断线也靠这层兜住），再 session.getMessages 取本次 user 消息
//      之后新增的消息作为回复。最终一致以 getMessages 为准，不信任流。
//
// 为什么不解析 SSE：UIMessage chunk 协议类型多且随主仓演进，CLI 的消费者是
// AI agent，要的是「一次拿到完整回复的 JSON」，不是逐 token 渲染。

import { randomUUID } from "node:crypto";
import { trpcMutation, trpcQuery } from "./api.mjs";
import { note } from "./output.mjs";

const USER_AGENT = "neodrop-cli/1.0 (+https://github.com/NeoDropAI/neodrop-skills)";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// POST /api/chat 发送消息。成功返回 Response（SSE 已开始）；HTTP >= 400 时
// 解析 JSON error 抛出（402 余额不足 / 401 未登录 / 400 消息非法等）。
async function postChatMessage({ apiOrigin, token, sessionId, text, locale, signal }) {
  const url = `${apiOrigin.replace(/\/+$/, "")}/api/chat`;
  const body = {
    sessionId,
    locale,
    message: {
      id: randomUUID(),
      role: "user",
      parts: [{ type: "text", text }],
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": USER_AGENT,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status >= 400) {
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      // 非 JSON 错误体，用 HTTP 状态兜底
    }
    const msg = (payload && (payload.error || payload.message)) || `HTTP ${res.status}`;
    const code = (payload && payload.code) || "";
    throw new Error(code ? `[${code}] ${msg}` : `发送失败：${msg}`);
  }
  return { response: res, userMessageId: body.message.id };
}

// 读 SSE 流到 EOF（内容丢弃）。断线 / 超时都不算失败——后端 worker 与连接
// 解耦，最终状态交给 getActiveChatTurn 轮询收敛。
async function drainStream(response) {
  try {
    if (!response.body) return;
    for await (const _chunk of response.body) {
      // 只等 EOF，不解析
    }
  } catch {
    note("⚠ SSE 连接中断，转轮询等待回复…");
  }
}

// 轮询直到 session 没有 live 的 chat turn（回复已生成完 / 失败 / 取消）。
async function pollUntilTurnSettled({ apiOrigin, token, sessionId, deadline, intervalMs }) {
  for (;;) {
    const turn = await trpcQuery({ apiOrigin, token }, "session.getActiveChatTurn", {
      sessionId,
    });
    if (!turn) return;
    if (Date.now() > deadline) {
      throw new Error(
        `等待回复超时（turn=${turn.id} 仍在 ${turn.status}）。稍后可用 chat history --session ${sessionId} 查看结果。`,
      );
    }
    await sleep(intervalMs);
  }
}

function extractText(parts) {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
}

/**
 * 发送一条消息并等待完整回复。
 *
 * @returns {Promise<{sessionId: string, reply: {text: string, parts: unknown[]} | null, newMessages: unknown[]}>}
 *   reply 是本次新增消息里最后一条 assistant 消息（text = 其 text parts 拼接）；
 *   turn 失败等场景下可能没有 assistant 回复，reply 为 null，调用方看 newMessages 自行判断。
 */
export async function sendAndAwaitReply({
  apiOrigin,
  token,
  sessionId,
  text,
  locale,
  timeoutMs,
  pollIntervalMs,
}) {
  const deadline = Date.now() + timeoutMs;
  const abort = AbortSignal.timeout(timeoutMs);

  note(`→ 发送到 session ${sessionId} …`);
  const { response, userMessageId } = await postChatMessage({
    apiOrigin,
    token,
    sessionId,
    text,
    locale,
    signal: abort,
  });

  note("… 回复生成中");
  await drainStream(response);
  await pollUntilTurnSettled({
    apiOrigin,
    token,
    sessionId,
    deadline,
    intervalMs: pollIntervalMs,
  });

  const messages = await trpcQuery({ apiOrigin, token }, "session.getMessages", {
    sessionId,
  });
  // 本次 user 消息之后新增的所有消息 = 这轮回复（含 tool / data 卡片等中间产物）
  const anchor = messages.findIndex((m) => m.id === userMessageId);
  const newMessages = anchor >= 0 ? messages.slice(anchor + 1) : [];
  const lastAssistant = [...newMessages]
    .reverse()
    .find((m) => m.role === "assistant");

  return {
    sessionId,
    reply: lastAssistant
      ? { text: extractText(lastAssistant.parts), parts: lastAssistant.parts }
      : null,
    newMessages,
  };
}

/** 建新会话（全局助手），或按 --channel 拿该频道的助手会话。 */
export async function resolveChatSession({ apiOrigin, token, channelId }) {
  if (channelId) {
    const session = await trpcMutation(
      { apiOrigin, token },
      "session.getOrCreateChannelAssistant",
      { channelId },
    );
    return session.id;
  }
  const session = await trpcMutation({ apiOrigin, token }, "session.create", {});
  return session.id;
}
