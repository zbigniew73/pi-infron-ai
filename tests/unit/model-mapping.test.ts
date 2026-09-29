import assert from "node:assert/strict";
import test from "node:test";

import { FALLBACK_MODELS } from "../../src/fallback-models.js";
import { parseModelCatalog, type InfronModel } from "../../src/infron-api.js";
import {
  isChatModel,
  isReasoningModel,
  NON_REASONING_PATTERNS,
  REASONING_LEVELS,
  toProviderModel,
} from "../../src/model-mapping.js";
import {
  CODEX_RESPONSES_ONLY,
  EMBEDDING,
  FREE_FLASH,
  GEMINI_IMAGE_MIXED_CASE,
  KIMI,
  QWEN_THINKING,
} from "./fixtures.js";

function parse(entry: unknown): InfronModel {
  const model = parseModelCatalog({ data: [entry] })?.models[0];
  assert.ok(model);
  return model;
}

test("filter keeps LLMs on the OpenAI endpoint, including free and mixed-case entries", () => {
  assert.equal(isChatModel(parse(KIMI)), true);
  assert.equal(isChatModel(parse(FREE_FLASH)), true);
  assert.equal(isChatModel(parse(GEMINI_IMAGE_MIXED_CASE)), true);
  assert.equal(isChatModel(parse(QWEN_THINKING)), true);
  assert.equal(isChatModel(parse(EMBEDDING)), false);
  assert.equal(isChatModel(parse(CODEX_RESPONSES_ONLY)), false);
  assert.equal(toProviderModel(parse(EMBEDDING)), null);
  assert.equal(toProviderModel(parse(CODEX_RESPONSES_ONLY)), null);
});

test("filter drops deprecated, display-only, non-streaming, and non-text-output models", () => {
  for (const override of [
    { deprecated: true },
    { is_display_only: true },
    { supports_streaming: false },
    { output_modalities: ["image"] },
    { supported_endpoint_types: [] },
  ]) {
    assert.equal(isChatModel(parse({ ...KIMI, ...override })), false, JSON.stringify(override));
  }
  const { output_modalities: _omit, ...withoutOutput } = KIMI;
  assert.equal(isChatModel(parse(withoutOutput)), true);
  assert.equal(isChatModel(parse({ ...KIMI, supports_function_calling: false })), true);
});

test("context window is the smallest provider or model context", () => {
  const kimi = toProviderModel(parse(KIMI));
  assert.equal(kimi?.contextWindow, 256000);
  assert.equal(kimi?.maxTokens, 65536);

  const thinking = toProviderModel(parse(QWEN_THINKING));
  assert.equal(thinking?.contextWindow, 128000);
  assert.equal(thinking?.maxTokens, 32800);

  const inputOnly = toProviderModel(
    parse({ ...KIMI, context_length: null, providers: [], max_input_tokens: 50000, max_output_tokens: 90000 }),
  );
  assert.equal(inputOnly?.contextWindow, 50000);
  assert.equal(inputOnly?.maxTokens, 50000);
});

test("missing limits fall back to defaults", () => {
  const free = toProviderModel(parse(FREE_FLASH));
  assert.ok(free);
  assert.equal(free.contextWindow, 128000);
  assert.equal(free.maxTokens, 4096);
});

test("cost uses minimum prices, cache reads at 0.2x, no cache writes, free is zero", () => {
  assert.deepEqual(toProviderModel(parse(KIMI))?.cost, {
    input: 0.44695,
    output: 1.85655,
    cacheRead: 0.08939,
    cacheWrite: 0,
  });
  assert.deepEqual(toProviderModel(parse(FREE_FLASH))?.cost, {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
  const { min_prompt_price: _p, min_completion_price: _c, ...unpriced } = KIMI;
  assert.deepEqual(toProviderModel(parse(unpriced))?.cost, {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
});

test("image input comes from modalities or supports_vision; video and audio are ignored", () => {
  assert.deepEqual(toProviderModel(parse(GEMINI_IMAGE_MIXED_CASE))?.input, ["text", "image"]);
  assert.deepEqual(toProviderModel(parse(QWEN_THINKING))?.input, ["text", "image"]);
  assert.deepEqual(
    toProviderModel(parse({ ...KIMI, input_modalities: ["text", "video", "audio"], supports_vision: false }))?.input,
    ["text"],
  );
});

test("name prefers display_name", () => {
  assert.equal(toProviderModel(parse(KIMI))?.name, "Moonshot: Kimi K2.6");
  const { display_name: _d, ...anonymous } = KIMI;
  assert.equal(toProviderModel(parse(anonymous))?.name, KIMI.id);
});

function fallbackModel(id: string): InfronModel {
  const model = FALLBACK_MODELS.find((entry) => entry.id === id);
  assert.ok(model, `${id} missing from the fallback catalog`);
  return model;
}

test("text models are reasoning-capable by default, including catalog models without keywords", () => {
  for (const id of [
    "deepseek/deepseek-v4-flash",
    "deepseek/deepseek-v4-flash:free",
    "deepseek/deepseek-v4.1-flash:free",
    "motif/motif-3",
    "qwen/qwen3.7-flash",
    "qwen/qwen3.8-27b:free",
    "openai/gpt-5.5",
    "qwen/qwen3-vl-235b-a22b-thinking",
    "x-ai/grok-4.2-reasoning",
    "moonshotai/kimi-k2-instruct",
    "openai/gpt-5.1-chat",
  ]) {
    assert.equal(isReasoningModel(fallbackModel(id)), true, id);
    assert.equal(toProviderModel(fallbackModel(id))?.reasoning, true, id);
  }
});

test("clearly non-reasoning specialist and non-thinking models are excluded", () => {
  for (const id of [
    "deepseek/deepseek-ocr",
    "rednote-hilab/dots.ocr",
    "qwen/qwen-mt-lite",
    "qwen/qwen-mt-plus",
    "x-ai/grok-4.2-non-reasoning",
  ]) {
    assert.equal(isReasoningModel(fallbackModel(id)), false, id);
  }
  const cases: Array<[Partial<InfronModel>, boolean]> = [
    [{ id: "vendor/text-embedding-3" }, false],
    [{ id: "vendor/bge-reranker-v2" }, false],
    [{ id: "vendor/voice-tts" }, false],
    [{ id: "openai/whisper-large-v3" }, false],
    [{ id: "vendor/model-mt" }, false],
    [{ id: "vendor/model-non-thinking" }, false],
    [{ id: "vendor/model-no-think" }, false],
    [{ id: "vendor/model", display_name: "Vendor: Model Non Reasoning" }, false],
    [{ id: "vendor/ocr-thinking" }, true],
    [{ id: "vendor/model", display_name: "Vendor: Embed Reasoning" }, true],
    [{ id: "vendor/smt-large" }, true],
    [{ id: "vendor/model-instruct" }, true],
  ];
  for (const [model, expected] of cases) {
    assert.equal(isReasoningModel({ id: "x", ...model }), expected, JSON.stringify(model));
  }
});

test("exclusion patterns are exported and match both id and display name", () => {
  assert.ok(NON_REASONING_PATTERNS.specialist.test("qwen/qwen-mt-lite"));
  assert.ok(NON_REASONING_PATTERNS.specialist.test("DeepSeek: Deepseek OCR"));
  assert.ok(NON_REASONING_PATTERNS.nonThinkingVariant.test("xAI: Grok 4.2 Non Reasoning"));
  assert.ok(!NON_REASONING_PATTERNS.nonThinkingVariant.test("vendor/nano-thinking"));
});

test("catalog descriptions do not influence reasoning", () => {
  const described = parse({ ...KIMI, description: "A non-reasoning OCR embedding model." });
  assert.equal(isReasoningModel(described), true);
  const mt = parse({ ...KIMI, id: "qwen/qwen-mt-plus", description: "A hybrid reasoning model." });
  assert.equal(isReasoningModel(mt), false);
});

test("reasoning models use the openrouter thinking format and effort map", () => {
  const thinking = toProviderModel(parse(QWEN_THINKING));
  assert.ok(thinking);
  assert.equal(thinking.reasoning, true);
  assert.deepEqual(thinking.thinkingLevelMap, {
    off: "none",
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  });
  assert.equal(thinking.thinkingLevelMap, REASONING_LEVELS);
  assert.deepEqual(thinking.compat, {
    supportsDeveloperRole: false,
    maxTokensField: "max_tokens",
    supportsUsageInStreaming: true,
    supportsStore: false,
    supportsStrictMode: true,
    thinkingFormat: "openrouter",
    supportsReasoningEffort: false,
  });
});

test("non-reasoning models get base compat and strict mode only with JSON mode", () => {
  const mt = toProviderModel(parse({ ...KIMI, id: "qwen/qwen-mt-plus", display_name: "Qwen: Qwen Mt Plus" }));
  assert.ok(mt);
  assert.equal(mt.reasoning, false);
  assert.equal(mt.thinkingLevelMap, undefined);
  assert.deepEqual(mt.compat, {
    supportsDeveloperRole: false,
    maxTokensField: "max_tokens",
    supportsUsageInStreaming: true,
    supportsStore: false,
    supportsStrictMode: true,
  });
  const noJson = toProviderModel(parse({ ...KIMI, supports_json_mode: false }));
  assert.equal(noJson?.compat.supportsStrictMode, false);
  assert.equal(noJson?.reasoning, true);
});

test("every bundled fallback model maps to a Pi model", () => {
  assert.ok(FALLBACK_MODELS.length > 0);
  for (const model of FALLBACK_MODELS) {
    const mapped = toProviderModel(model);
    assert.ok(mapped, model.id);
    assert.ok(mapped.contextWindow > 0);
    assert.ok(mapped.maxTokens > 0 && mapped.maxTokens <= mapped.contextWindow);
  }
  assert.ok(FALLBACK_MODELS.some((model) => model.id.endsWith(":free")));
});
