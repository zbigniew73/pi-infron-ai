import assert from "node:assert/strict";
import test from "node:test";

import { BALANCE_URL, BASE_URL, MODELS_URL } from "../../src/config.js";
import {
  fetchModels,
  parseInfronError,
  parseModelCatalog,
  probeChatCompletion,
  validateApiKey,
} from "../../src/infron-api.js";
import {
  BALANCE_OK,
  CATALOG,
  ERROR_INVALID_TEXT,
  ERROR_NO_TOKEN,
  ERROR_TOKEN_UNAVAILABLE,
  ERROR_UPSTREAM_NUMERIC_CODE,
  FREE_FLASH,
  GEMINI_IMAGE_MIXED_CASE,
  KIMI,
} from "./fixtures.js";

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("parseModelCatalog keeps real entries and normalizes modalities", () => {
  const parsed = parseModelCatalog(CATALOG);
  assert.ok(parsed);
  assert.equal(parsed.models.length, CATALOG.data.length);
  assert.equal(parsed.rejectedEntries, 0);

  const gemini = parsed.models.find((model) => model.id === GEMINI_IMAGE_MIXED_CASE.id);
  assert.deepEqual(gemini?.input_modalities, ["text", "image"]);
  assert.deepEqual(gemini?.output_modalities, ["text"]);
  assert.deepEqual(gemini?.supported_endpoint_types, ["gemini", "openai"]);

  const kimi = parsed.models.find((model) => model.id === KIMI.id);
  assert.equal(kimi?.providers?.length, 3);
  assert.equal(kimi?.providers?.[0]?.context_length, 256000);
  assert.equal(kimi?.min_prompt_price, 0.44695);
});

test("parseModelCatalog treats null limits as missing", () => {
  const parsed = parseModelCatalog({ data: [FREE_FLASH] });
  const free = parsed?.models[0];
  assert.ok(free);
  assert.equal(free.context_length, undefined);
  assert.equal(free.max_output_tokens, undefined);
  assert.equal(free.min_prompt_price, 0);
  assert.deepEqual(free.providers, [
    { provider_slug: "infron/cn", service_tier: "standard", prompt_price: 0, completion_price: 0 },
  ]);
});

test("parseModelCatalog rejects malformed entries and removes duplicates", () => {
  const parsed = parseModelCatalog({
    data: [
      KIMI,
      KIMI,
      null,
      "text",
      { id: "" },
      { id: "bad id with spaces" },
      { ...KIMI, id: "vendor/negative-price", min_prompt_price: -1 },
      { ...KIMI, id: "vendor/string-price", min_completion_price: "1.0" },
      { id: "vendor/minimal" },
      { ...KIMI, id: "vendor/odd-types", context_length: "big", supports_streaming: "yes", providers: [1, null] },
    ],
  });
  assert.ok(parsed);
  assert.deepEqual(
    parsed.models.map((model) => model.id),
    [KIMI.id, "vendor/minimal", "vendor/odd-types"],
  );
  assert.equal(parsed.rejectedEntries, 6);
  assert.equal(parsed.duplicateEntries, 1);
  const odd = parsed.models[2];
  assert.equal(odd?.context_length, undefined);
  assert.equal(odd?.supports_streaming, undefined);
  assert.equal(odd?.providers, undefined);
});

test("parseModelCatalog rejects payloads without a data array", () => {
  assert.equal(parseModelCatalog(null), null);
  assert.equal(parseModelCatalog({ success: true }), null);
  assert.equal(parseModelCatalog({ data: {} }), null);
});

test("fetchModels hits the models URL, sends a key only when given, and fails closed", async () => {
  const calls: Array<{ url: string; auth?: string }> = [];
  const catalogFetch: typeof fetch = async (input, init) => {
    const headers = init?.headers as Record<string, string>;
    calls.push({ url: String(input), auth: headers.Authorization });
    return textResponse(JSON.stringify(CATALOG));
  };
  const withoutKey = await fetchModels({ fetchImpl: catalogFetch });
  assert.equal(withoutKey?.models.length, CATALOG.data.length);
  await fetchModels({ fetchImpl: catalogFetch, apiKey: "test-key" });
  assert.deepEqual(calls, [
    { url: MODELS_URL, auth: undefined },
    { url: MODELS_URL, auth: "Bearer test-key" },
  ]);

  assert.equal(await fetchModels({ fetchImpl: async () => textResponse("{}", 500) }), null);
  assert.equal(await fetchModels({ fetchImpl: async () => textResponse("not-json") }), null);
  assert.equal(await fetchModels({ fetchImpl: async () => textResponse('{"data":[]}') }), null);
  assert.equal(
    await fetchModels({ fetchImpl: async () => Promise.reject(new Error("offline")) }),
    null,
  );
});

test("parseInfronError handles string, numeric, and missing codes", () => {
  assert.deepEqual(parseInfronError(ERROR_NO_TOKEN), {
    message: "No token provided",
    type: "infron_ai_error",
    requestId: "req-test",
  });
  assert.deepEqual(parseInfronError(ERROR_INVALID_TEXT), {
    message: "Invalid text request",
    type: "infron_ai_error",
    code: "invalid_text_request",
    requestId: "req-test",
  });
  assert.deepEqual(parseInfronError(ERROR_UPSTREAM_NUMERIC_CODE), {
    message: "max_completion_tokens is too large: 400000",
    type: "BadRequestError",
    code: 400,
    param: "max_completion_tokens",
  });
  assert.equal(parseInfronError("plain text"), null);
  assert.equal(parseInfronError('{"error":{"type":"x"}}'), null);
  assert.equal(parseInfronError('{"message":"top-level"}'), null);
});

test("validateApiKey accepts 200 with a balance and never exposes the account name", async () => {
  let requested = "";
  const result = await validateApiKey("test-key", {
    fetchImpl: async (input) => {
      requested = String(input);
      return textResponse(BALANCE_OK);
    },
  });
  assert.equal(requested, BALANCE_URL);
  assert.equal(result.status, "valid");
  assert.equal(result.creditBalance, 9.99);
  assert.doesNotMatch(JSON.stringify(result), /@/);
});

test("validateApiKey rejects 401 and treats everything else as indeterminate", async () => {
  const invalid = await validateApiKey("bad", {
    fetchImpl: async () => textResponse(ERROR_TOKEN_UNAVAILABLE, 401),
  });
  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.detail, "The token status is not available");

  const serverError = await validateApiKey("key", {
    fetchImpl: async () => textResponse("upstream down", 503),
  });
  assert.equal(serverError.status, "indeterminate");
  assert.match(serverError.detail, /HTTP 503/);

  const malformed = await validateApiKey("key", {
    fetchImpl: async () => textResponse('{"account_name":"x"}'),
  });
  assert.equal(malformed.status, "indeterminate");

  const network = await validateApiKey("key", {
    fetchImpl: async () => Promise.reject(new Error("socket hang up key=secret")),
  });
  assert.deepEqual(network, {
    status: "indeterminate",
    detail: "validation request failed",
  });

  const timeout = await validateApiKey("key", {
    fetchImpl: async () => Promise.reject(new DOMException("t", "TimeoutError")),
  });
  assert.equal(timeout.detail, "validation timed out or was aborted");
});

test("probeChatCompletion sends a one-token request with max_tokens", async () => {
  let url = "";
  let body: Record<string, unknown> = {};
  const ok = await probeChatCompletion("key", "vendor/model", {
    fetchImpl: async (input, init) => {
      url = String(input);
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return textResponse('{"id":"chatcmpl-test","choices":[]}');
    },
  });
  assert.equal(url, `${BASE_URL}/chat/completions`);
  assert.equal(body.max_tokens, 1);
  assert.equal(body.max_completion_tokens, undefined);
  assert.equal(ok.ok, true);

  const failed = await probeChatCompletion("key", "vendor/model", {
    fetchImpl: async () => textResponse(ERROR_NO_TOKEN, 401),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 401);
  assert.equal(failed.error?.requestId, "req-test");
  assert.equal(failed.detail, "vendor/model: HTTP 401: No token provided");

  const plain = await probeChatCompletion("key", "vendor/model", {
    fetchImpl: async () => textResponse("bad gateway", 502),
  });
  assert.equal(plain.detail, "vendor/model: HTTP 502: bad gateway");

  const malformed = await probeChatCompletion("key", "vendor/model", {
    fetchImpl: async () => textResponse("{}"),
  });
  assert.equal(malformed.ok, false);

  const network = await probeChatCompletion("key", "vendor/model", {
    fetchImpl: async () => Promise.reject(new Error("offline")),
  });
  assert.equal(network.detail, "vendor/model: network request failed");
});
