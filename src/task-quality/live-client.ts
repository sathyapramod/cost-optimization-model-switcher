import type { Provider } from "../types.js";

export interface LiveModelTarget {
  provider: Provider;
  modelId: string;
}

export interface ChatCompletionResult {
  output: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export class LiveModelError extends Error {
  constructor(
    message: string,
    readonly code: "missing_api_key" | "unsupported_provider" | "api_error",
  ) {
    super(message);
    this.name = "LiveModelError";
  }
}

/** Incremented on each `completeLiveModel` call (tests assert the gate path never triggers live APIs). */
export let liveCompletionRequestCount = 0;

export function envVarHintForLiveProvider(provider: Provider): string {
  if (provider === "anthropic") return "ANTHROPIC_API_KEY";
  if (provider === "openai") return "OPENAI_API_KEY";
  if (provider === "cursor") return "CURSOR_API_KEY or OPENAI_API_KEY";
  return "provider API key";
}

function apiKeyForProvider(provider: Provider): string | undefined {
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY;
  if (provider === "openai") return process.env.OPENAI_API_KEY;
  if (provider === "cursor") {
    return process.env.CURSOR_API_KEY ?? process.env.OPENAI_API_KEY;
  }
  return undefined;
}

function missingLiveKeyMessage(provider: Provider): string {
  const envHint = envVarHintForLiveProvider(provider);
  return (
    `${envHint} is required for live evaluation (npm run evaluate:live) with provider "${provider}". ` +
    "The cost gate does not use provider API keys."
  );
}

export function assertLiveModelConfigured(target: LiveModelTarget): void {
  const key = apiKeyForProvider(target.provider);
  if (!key) {
    throw new LiveModelError(missingLiveKeyMessage(target.provider), "missing_api_key");
  }
}

/** OpenAI reasoning models (o1/o3/o4) reject `max_tokens`; they want `max_completion_tokens`. */
export function openaiCompletionLimitField(modelId: string): "max_tokens" | "max_completion_tokens" {
  return /^o[0-9]/i.test(modelId.trim()) ? "max_completion_tokens" : "max_tokens";
}

export async function completeLiveModel(
  target: LiveModelTarget,
  userPrompt: string,
  options?: { maxTokens?: number },
): Promise<ChatCompletionResult> {
  const apiKey = apiKeyForProvider(target.provider);
  if (!apiKey) {
    throw new LiveModelError(missingLiveKeyMessage(target.provider), "missing_api_key");
  }
  liveCompletionRequestCount++;
  const maxTokens = options?.maxTokens ?? 4096;
  const started = Date.now();

  if (target.provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: target.modelId,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new LiveModelError(`Anthropic API ${res.status}: ${text}`, "api_error");
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const output =
      data.content?.map((c) => (c.type === "text" ? c.text ?? "" : "")).join("") ?? "";
    return {
      output,
      latencyMs: Date.now() - started,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
  }

  if (target.provider === "openai" || target.provider === "cursor") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: target.modelId,
        [openaiCompletionLimitField(target.modelId)]: maxTokens,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new LiveModelError(`OpenAI API ${res.status}: ${text}`, "api_error");
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      output: data.choices?.[0]?.message?.content ?? "",
      latencyMs: Date.now() - started,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  }

  throw new LiveModelError(`Live completion not implemented for provider "${target.provider}".`, "unsupported_provider");
}
