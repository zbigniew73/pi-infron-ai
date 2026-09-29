import assert from "node:assert/strict";
import test from "node:test";

import { BASE_URL } from "../../src/config.js";
import { fetchModels, validateApiKey } from "../../src/infron-api.js";
import { toProviderModel } from "../../src/model-mapping.js";

const apiKey = process.env.INFRON_API_KEY;
const chatModel = process.env.INFRON_TEST_MODEL;
const toolModel = process.env.INFRON_TOOL_TEST_MODEL;
const reasoningModel = process.env.INFRON_REASONING_TEST_MODEL;

function skipUnless(model: string | undefined, variable: string): string | false {
  if (!apiKey) return "INFRON_API_KEY is not set";
  return model ? false : `${variable} is not set`;
}

async function postChat(body: Record<string, unknown>): Promise<Response> {
  assert.ok(apiKey);
  return fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  assert.equal(response.ok, true, `HTTP ${response.status}: ${text.slice(0, 500)}`);
  const payload = JSON.parse(text) as unknown;
  assert.equal(typeof payload, "object");
  assert.notEqual(payload, null);
  return payload as Record<string, unknown>;
}

test("live public catalog validates and maps to Pi models", async () => {
  const catalog = await fetchModels({ signal: AbortSignal.timeout(15_000) });
  assert.ok(catalog);
  const models = catalog.models.map(toProviderModel).filter((model) => model !== null);
  assert.ok(models.length > 0);
  for (const id of [chatModel, toolModel, reasoningModel]) {
    if (id) assert.ok(models.some((model) => model.id === id), `${id} is not registered`);
  }
});

test("live balance endpoint validates the configured key", { skip: apiKey ? false : "INFRON_API_KEY is not set" }, async () => {
  assert.ok(apiKey);
  const validation = await validateApiKey(apiKey, { signal: AbortSignal.timeout(15_000) });
  assert.equal(validation.status, "valid", validation.detail);
  assert.equal(typeof validation.creditBalance, "number");

  const rejected = await validateApiKey("invalid-live-test-key", {
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(rejected.status, "invalid", rejected.detail);
});

test("live streaming completion reports content, DONE, and usage", { skip: skipUnless(chatModel, "INFRON_TEST_MODEL") }, async () => {
  assert.ok(chatModel);
  const response = await postChat({
    model: chatModel,
    messages: [{ role: "user", content: "Reply with exactly OK." }],
    max_tokens: 8,
    stream: true,
    stream_options: { include_usage: true },
  });
  if (!response.ok) {
    assert.fail(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }

  const frames = (await response.text())
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6));
  assert.ok(frames.includes("[DONE]"), "stream did not terminate with [DONE]");
  const payloads = frames
    .filter((frame) => frame !== "[DONE]")
    .map((frame) => JSON.parse(frame) as Record<string, unknown>);
  assert.ok(payloads.length > 0);
  assert.ok(payloads.some((payload) => payload.usage !== undefined && payload.usage !== null));
});

test("live tool-call round trip", { skip: skipUnless(toolModel, "INFRON_TOOL_TEST_MODEL") }, async () => {
  assert.ok(toolModel);
  const tools = [
    {
      type: "function",
      function: {
        name: "lookup_code",
        description: "Retrieve a short code",
        parameters: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    },
  ];
  const question = {
    role: "user",
    content: "Use lookup_code to retrieve alpha, then reply with the code only.",
  };
  const first = await responseJson(
    await postChat({
      model: toolModel,
      messages: [question],
      tools,
      tool_choice: { type: "function", function: { name: "lookup_code" } },
      max_tokens: 256,
    }),
  );
  const assistant = (first.choices as Array<{ message: Record<string, unknown> }>)[0]?.message;
  assert.ok(assistant);
  const toolCalls = assistant.tool_calls as Array<{ id: string }> | undefined;
  assert.ok(toolCalls?.[0]?.id, "the model did not call the tool");

  const second = await responseJson(
    await postChat({
      model: toolModel,
      messages: [
        question,
        assistant,
        { role: "tool", tool_call_id: toolCalls[0].id, content: '{"code":"ALPHA-42"}' },
      ],
      tools,
      max_tokens: 256,
    }),
  );
  const content = (second.choices as Array<{ message: { content?: string } }>)[0]?.message.content;
  assert.match(content ?? "", /ALPHA-42/i);
});

test("live reasoning model accepts reasoning effort and returns reasoning text", { skip: skipUnless(reasoningModel, "INFRON_REASONING_TEST_MODEL") }, async () => {
  assert.ok(reasoningModel);
  const payload = await responseJson(
    await postChat({
      model: reasoningModel,
      messages: [{ role: "user", content: "What is 17 plus 25?" }],
      reasoning: { effort: "low" },
      max_tokens: 1024,
    }),
  );
  const message = (payload.choices as Array<{ message: Record<string, unknown> }>)[0]?.message;
  assert.ok(message);
  assert.ok(
    typeof message.reasoning_content === "string" || typeof message.reasoning === "string",
    "response contained neither reasoning_content nor reasoning",
  );
});
