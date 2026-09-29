import type { InfronModel } from "./infron-api.js";
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  MAX_TOKENS_CAP,
} from "./config.js";

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface OpenAICompletionsCompat {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsUsageInStreaming?: boolean;
  supportsStrictMode?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  thinkingFormat?: "openrouter";
}

export type ThinkingLevelMap = Partial<
  Record<
    "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
    string | null
  >
>;

export interface ProviderModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: ModelCost;
  contextWindow: number;
  maxTokens: number;
  thinkingLevelMap?: ThinkingLevelMap;
  compat: OpenAICompletionsCompat;
}

// `max_completion_tokens` is passed through unclamped and can fail upstream,
// while `max_tokens` is clamped by Infron. The developer role is unverified.
const BASE_COMPAT: OpenAICompletionsCompat = {
  supportsDeveloperRole: false,
  maxTokensField: "max_tokens",
  supportsUsageInStreaming: true,
  supportsStore: false,
};

// Pi's "openrouter" format sends `reasoning: {effort}`, which is Infron's
// request shape; `effort: "none"` disables reasoning.
export const REASONING_LEVELS: ThinkingLevelMap = {
  off: "none",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: null,
};

// Models matched here are registered without reasoning. Explicit non-thinking
// variants always match; specialist patterns never override a name that says
// thinking or reasoning.
export const NON_REASONING_PATTERNS = {
  nonThinkingVariant: /\bno(n)?[\s_-]?(reasoning|thinking|think)\b/i,
  specialist: /(^|[\s/._-])(ocr|mt|embed\w*|rerank\w*|tts|whisper)([\s._:-]|$)/i,
};
const REASONING_WORD_PATTERN = /thinking|reasoning/i;

// Infron reports cache reads at roughly a fifth of the input price and does
// not bill cache writes.
const CACHE_READ_RATIO = 0.2;

/** Whether a catalog entry is a streaming chat model reachable through the OpenAI endpoint. */
export function isChatModel(model: InfronModel): boolean {
  if (model.category_type !== "LLM") return false;
  if (!model.supported_endpoint_types?.includes("openai")) return false;
  if (model.output_modalities && !model.output_modalities.includes("text")) {
    return false;
  }
  if (model.supports_streaming === false) return false;
  return !model.deprecated && !model.is_display_only;
}

/**
 * No catalog field marks reasoning models. Infron ignores `reasoning` for
 * models that do not reason, so every text model counts as reasoning-capable
 * unless its id or name matches NON_REASONING_PATTERNS.
 */
export function isReasoningModel(model: InfronModel): boolean {
  const names = [model.id, model.display_name ?? ""];
  const matches = (pattern: RegExp) => names.some((name) => pattern.test(name));
  if (matches(NON_REASONING_PATTERNS.nonThinkingVariant)) return false;
  if (matches(REASONING_WORD_PATTERN)) return true;
  return !matches(NON_REASONING_PATTERNS.specialist);
}

export function contextWindowOf(model: InfronModel): number {
  const candidates = [
    model.context_length,
    ...(model.providers ?? []).map((provider) => provider.context_length),
  ].filter((value): value is number => value !== undefined && value > 0);
  if (candidates.length > 0) return Math.min(...candidates);
  return model.max_input_tokens ?? DEFAULT_CONTEXT_WINDOW;
}

function roundPrice(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export function costOf(model: InfronModel): ModelCost {
  const input = model.min_prompt_price ?? 0;
  return {
    input,
    output: model.min_completion_price ?? 0,
    cacheRead: roundPrice(input * CACHE_READ_RATIO),
    cacheWrite: 0,
  };
}

/** Maps an Infron /models entry to a Pi model config, or null for entries Pi cannot serve. */
export function toProviderModel(model: InfronModel): ProviderModel | null {
  if (!isChatModel(model)) return null;

  const reasoning = isReasoningModel(model);
  const contextWindow = contextWindowOf(model);
  const maxTokens = Math.min(
    model.max_output_tokens ?? DEFAULT_MAX_TOKENS,
    contextWindow,
    MAX_TOKENS_CAP,
  );
  const vision =
    model.supports_vision === true ||
    (model.input_modalities?.includes("image") ?? false);
  const compat: OpenAICompletionsCompat = {
    ...BASE_COMPAT,
    supportsStrictMode: model.supports_json_mode === true,
    ...(reasoning
      ? { thinkingFormat: "openrouter", supportsReasoningEffort: false }
      : {}),
  };

  return {
    id: model.id,
    name: model.display_name || model.id,
    reasoning,
    input: vision ? ["text", "image"] : ["text"],
    cost: costOf(model),
    contextWindow,
    maxTokens,
    ...(reasoning ? { thinkingLevelMap: REASONING_LEVELS } : {}),
    compat,
  };
}
