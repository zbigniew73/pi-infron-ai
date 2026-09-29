import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { decodeErrorMessage, registerErrorDecoder } from "../../src/errors.js";
import {
  ERROR_CREDITS,
  ERROR_FREE_BALANCE,
  ERROR_INVALID_TEXT,
  ERROR_NO_PROVIDER,
  ERROR_NO_TOKEN,
  ERROR_TOKEN_UNAVAILABLE,
  ERROR_UPSTREAM_NUMERIC_CODE,
} from "./fixtures.js";

function body(message: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ error: { message, type: "infron_ai_error", ...extra } });
}

test("401 errors point to /login and the key page, keeping the request id", () => {
  for (const fixture of [ERROR_NO_TOKEN, ERROR_TOKEN_UNAVAILABLE]) {
    const decoded = decodeErrorMessage(`401: ${fixture}`) ?? "";
    assert.match(decoded, /^Infron HTTP 401: /);
    assert.match(decoded, /Run \/login/);
    assert.match(decoded, /infron\.ai\/dashboard\/apiKeys/);
    assert.match(decoded, /\(request id: req-test\)$/);
  }
  assert.match(decodeErrorMessage(`401: ${ERROR_NO_TOKEN}`) ?? "", /No token provided/);
});

test("each documented status gets guidance and keeps the original text", () => {
  const cases: Array<[number, string, RegExp]> = [
    [402, body("Insufficient balance"), /Top up/],
    [403, body("Content flagged"), /moderation/],
    [408, body("Request timeout"), /Retry shortly/],
    [429, body("Too many requests"), /Retry shortly/],
    [502, body("Bad gateway"), /upstream provider is unavailable/],
    [503, body("Service unavailable"), /upstream provider is unavailable/],
  ];
  for (const [status, payload, guidance] of cases) {
    const decoded = decodeErrorMessage(`${status}: ${payload}`) ?? "";
    assert.match(decoded, new RegExp(`^Infron HTTP ${status}: `));
    assert.match(decoded, guidance);
    const original = (JSON.parse(payload) as { error: { message: string } }).error.message;
    assert.ok(decoded.includes(original), decoded);
    assert.doesNotMatch(decoded, /request id/);
  }
});

test("credit, free-model, and unknown-model messages are recognized by text", () => {
  assert.match(decodeErrorMessage(`403: ${ERROR_CREDITS}`) ?? "", /credits are used up/);
  const free = decodeErrorMessage(`402: ${ERROR_FREE_BALANCE}`) ?? "";
  assert.match(free, /at least \$5/);
  assert.match(free, /greater than \$4\.999999/);
  const unknown = decodeErrorMessage(`503: ${ERROR_NO_PROVIDER}`) ?? "";
  assert.match(unknown, /vendor\/unknown-model/);
  assert.match(unknown, /unknown or currently unavailable.*\/model/);
  assert.match(unknown, /request id: req-test/);
});

test("string, numeric, and missing codes are all handled", () => {
  assert.match(
    decodeErrorMessage(`400: ${ERROR_INVALID_TEXT}`) ?? "",
    /^Infron HTTP 400 \(invalid_text_request\): Invalid text request\. Infron rejected the request text/,
  );
  assert.match(
    decodeErrorMessage(`400: ${ERROR_UPSTREAM_NUMERIC_CODE}`) ?? "",
    /^Infron HTTP 400 \(400\): max_completion_tokens is too large: 400000\. The request was rejected/,
  );
  assert.equal(
    decodeErrorMessage(`418: ${body("Teapot")}`),
    "Infron HTTP 418: Teapot",
  );
  assert.equal(
    decodeErrorMessage(`500: ${body("Oops", { request_id: "req-test" })}`),
    "Infron HTTP 500: Oops (request id: req-test)",
  );
});

test("unparsable bodies stay untouched and decoding is idempotent", () => {
  assert.equal(decodeErrorMessage("502: plain gateway response"), null);
  assert.equal(decodeErrorMessage('400: {"message":"flat"}'), null);
  assert.equal(decodeErrorMessage("socket hang up"), null);
  const decoded = decodeErrorMessage(`401: ${ERROR_NO_TOKEN}`) ?? "";
  assert.equal(decodeErrorMessage(decoded), null);
});

test("context overflow is normalized exactly once", () => {
  assert.equal(
    decodeErrorMessage("400: maximum context length was exceeded"),
    "context_length_exceeded: 400: maximum context length was exceeded",
  );
  assert.match(
    decodeErrorMessage(`400: ${body("This model's maximum context length is 8192 tokens")}`) ?? "",
    /^context_length_exceeded: Infron HTTP 400: This model's maximum context length/,
  );
  assert.equal(decodeErrorMessage("context_length_exceeded: already normalized"), null);
});

test("registered decoder changes Infron assistant errors only", () => {
  type Handler = (event: { message: Record<string, unknown> }) => unknown;
  let handler: Handler | undefined;
  const pi = {
    on: (event: string, value: Handler) => {
      assert.equal(event, "message_end");
      handler = value;
    },
  } as unknown as ExtensionAPI;
  registerErrorDecoder(pi);
  assert.ok(handler);

  const infron = handler({
    message: {
      role: "assistant",
      provider: "infron",
      stopReason: "error",
      errorMessage: `402: ${ERROR_CREDITS}`,
    },
  }) as { message: { errorMessage: string } };
  assert.match(infron.message.errorMessage, /Top up/);

  for (const message of [
    { role: "assistant", provider: "other", stopReason: "error", errorMessage: `401: ${ERROR_NO_TOKEN}` },
    { role: "assistant", provider: "infron", stopReason: "stop", errorMessage: `401: ${ERROR_NO_TOKEN}` },
    { role: "user", provider: "infron", stopReason: "error" },
    { role: "assistant", provider: "infron", stopReason: "error", errorMessage: "plain" },
  ]) {
    assert.equal(handler({ message }), undefined);
  }
});
