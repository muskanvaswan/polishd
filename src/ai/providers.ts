/**
 * Buffd — model providers (server only).
 *
 * A deliberately tiny, dependency-free abstraction over the chat endpoints of
 * the common vendors. We use raw `fetch` rather than any vendor SDK so the
 * package keeps its zero-runtime-dependency footprint and so the owner can
 * point Buffd at whichever model they already pay for.
 *
 * Each call is a single non-streaming request: one system prompt, one user
 * message, a small token cap. That's all a one-paragraph summary needs, and it
 * keeps the owner's spend to the absolute minimum.
 */
import type { BuffdAIProvider, BuffdAISettings } from "./types";

export interface ModelReply {
  text: string;
  /** True when the provider stopped at the output-token cap (clipped text). */
  truncated: boolean;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Sensible default model per provider, used when none is configured. */
export const DEFAULT_MODEL: Record<BuffdAIProvider, string> = {
  // Anthropic's most capable model; the owner can downgrade for cost.
  anthropic: "claude-opus-4-8",
  openai: "gpt-4o-mini",
  "openai-compatible": "gpt-4o-mini",
  google: "gemini-1.5-flash",
};

/**
 * Default cap. Reasoning models (e.g. the Claude 4.x family) spend output
 * tokens on internal thinking before the visible text, and those count against
 * `max_tokens` — so the cap needs generous headroom beyond the paragraph we
 * actually want. It's a worst-case ceiling, not expected spend: providers bill
 * only tokens actually generated.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

export interface CallOptions {
  /** Output token cap for this call. */
  maxTokens?: number;
}

class ProviderError extends Error {}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ProviderError(
      `network error contacting model provider: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const raw = await res.text();
  if (!res.ok) {
    // Surface the provider's message but trim it so a key never lands in a log.
    const detail = raw.slice(0, 300).replace(/\s+/g, " ").trim();
    throw new ProviderError(`provider returned ${res.status}: ${detail}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ProviderError("provider returned a non-JSON response");
  }
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

// ── Anthropic Messages API ───────────────────────────────────────────────────
async function callAnthropic(
  s: BuffdAISettings,
  system: string,
  user: string,
  maxTokens: number,
): Promise<ModelReply> {
  const data = (await postJson(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": s.apiKey, "anthropic-version": "2023-06-01" },
    {
      model: s.model || DEFAULT_MODEL.anthropic,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    },
  )) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
    usage?: Record<string, unknown>;
  };

  const text = (data.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
  return {
    text,
    truncated: data.stop_reason === "max_tokens",
    usage: {
      inputTokens: num(data.usage?.input_tokens),
      outputTokens: num(data.usage?.output_tokens),
    },
  };
}

// ── OpenAI (and OpenAI-compatible) Chat Completions ──────────────────────────
async function callOpenAI(
  s: BuffdAISettings,
  system: string,
  user: string,
  maxTokens: number,
): Promise<ModelReply> {
  const base = (s.baseUrl?.replace(/\/$/, "") || "https://api.openai.com/v1");
  const data = (await postJson(
    `${base}/chat/completions`,
    { authorization: `Bearer ${s.apiKey}` },
    {
      model: s.model || DEFAULT_MODEL.openai,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
  )) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: Record<string, unknown>;
  };

  const text = (data.choices?.[0]?.message?.content ?? "").trim();
  return {
    text,
    truncated: data.choices?.[0]?.finish_reason === "length",
    usage: {
      inputTokens: num(data.usage?.prompt_tokens),
      outputTokens: num(data.usage?.completion_tokens),
    },
  };
}

// ── Google Gemini generateContent ────────────────────────────────────────────
async function callGoogle(
  s: BuffdAISettings,
  system: string,
  user: string,
  maxTokens: number,
): Promise<ModelReply> {
  const model = s.model || DEFAULT_MODEL.google;
  const data = (await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(s.apiKey)}`,
    {},
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    },
  )) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: Record<string, unknown>;
  };

  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  return {
    text,
    truncated: data.candidates?.[0]?.finishReason === "MAX_TOKENS",
    usage: {
      inputTokens: num(data.usageMetadata?.promptTokenCount),
      outputTokens: num(data.usageMetadata?.candidatesTokenCount),
    },
  };
}

function dispatch(
  settings: BuffdAISettings,
  system: string,
  user: string,
  maxTokens: number,
): Promise<ModelReply> {
  switch (settings.provider) {
    case "anthropic":
      return callAnthropic(settings, system, user, maxTokens);
    case "openai":
    case "openai-compatible":
      return callOpenAI(settings, system, user, maxTokens);
    case "google":
      return callGoogle(settings, system, user, maxTokens);
    default:
      throw new ProviderError(`unknown provider: ${settings.provider}`);
  }
}

/**
 * Dispatch to the configured provider. Throws on transport / API errors with a
 * message safe to surface (no key material), which the caller turns into a
 * `provider-error` result.
 *
 * If the reply hits the output cap (reasoning models can burn most of it on
 * thinking), retry once at double the cap — a clipped reply is 100% wasted
 * spend, so one bigger attempt is the cheaper path. Still-truncated replies
 * are returned flagged; callers must not cache them.
 */
export async function callModel(
  settings: BuffdAISettings,
  system: string,
  user: string,
  opts: CallOptions = {},
): Promise<ModelReply> {
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const reply = await dispatch(settings, system, user, maxTokens);
  if (!reply.truncated) return reply;
  console.warn(
    `[buffd] model hit the ${maxTokens}-token output cap — retrying once at ${maxTokens * 2}`,
  );
  return dispatch(settings, system, user, maxTokens * 2);
}
