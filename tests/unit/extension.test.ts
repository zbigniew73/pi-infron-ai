import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { FALLBACK_MODELS } from "../../src/fallback-models.js";
import { registerInfron } from "../../src/index.js";
import { CATALOG, EMBEDDING, CODEX_RESPONSES_ONLY } from "./fixtures.js";

interface RegistrationCapture {
  providerId?: string;
  provider?: Record<string, unknown>;
  command?: string;
  event?: string;
}

function fakePi(capture: RegistrationCapture): ExtensionAPI {
  return {
    registerProvider: (id: string, provider: Record<string, unknown>) => {
      capture.providerId = id;
      capture.provider = provider;
    },
    registerCommand: (name: string) => {
      capture.command = name;
    },
    on: (event: string) => {
      capture.event = event;
    },
  } as unknown as ExtensionAPI;
}

function liveCatalog(payload: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

test("registerInfron wires the filtered live catalog into Pi", async () => {
  const capture: RegistrationCapture = {};
  await registerInfron(fakePi(capture), {
    fetchOptions: { fetchImpl: liveCatalog(CATALOG) },
  });

  assert.equal(capture.providerId, "infron");
  assert.equal(capture.provider?.name, "Infron AI");
  assert.equal(capture.provider?.baseUrl, "https://llm.onerouter.pro/v1");
  assert.equal(capture.provider?.apiKey, "$INFRON_API_KEY");
  assert.equal(capture.provider?.authHeader, true);
  assert.equal(capture.provider?.api, "openai-completions");
  assert.equal(capture.command, "infron");
  assert.equal(capture.event, "message_end");
  assert.equal(typeof capture.provider?.oauth, "object");
  const models = capture.provider?.models as Array<{ id: string }>;
  assert.deepEqual(models.map((model) => model.id), [
    "moonshotai/kimi-k2.6",
    "qwen/qwen3.8-flash:free",
    "google/gemini-2.5-flash-image",
    "qwen/qwen3-vl-235b-a22b-thinking",
  ]);
});

test("registerInfron discovers without a key when INFRON_API_KEY is unset", async () => {
  const previous = process.env.INFRON_API_KEY;
  delete process.env.INFRON_API_KEY;
  let auth: string | undefined = "unset";
  try {
    const capture: RegistrationCapture = {};
    await registerInfron(fakePi(capture), {
      fetchOptions: {
        fetchImpl: async (_input, init) => {
          auth = (init?.headers as Record<string, string>).Authorization;
          return liveCatalog(CATALOG)("");
        },
      },
    });
    assert.equal(auth, undefined);
    assert.equal((capture.provider?.models as unknown[]).length, 4);
  } finally {
    if (previous !== undefined) process.env.INFRON_API_KEY = previous;
  }
});

test("registerInfron uses the fallback for network and schema failures", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const fetchImpl of [
    async () => Promise.reject(new Error("offline")),
    async () => new Response('{"unexpected":true}', { status: 200 }),
    async () => new Response("not-json", { status: 200 }),
    async () => new Response("{}", { status: 503 }),
  ] satisfies Array<typeof fetch>) {
    const capture: RegistrationCapture = {};
    await registerInfron(fakePi(capture), { fetchOptions: { fetchImpl } });
    const models = capture.provider?.models as Array<{ id: string }>;
    assert.equal(models.length, FALLBACK_MODELS.length);
  }
});

test("registerInfron falls back when discovery has no usable chat models", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const capture: RegistrationCapture = {};
  await registerInfron(fakePi(capture), {
    fetchOptions: { fetchImpl: liveCatalog({ data: [EMBEDDING, CODEX_RESPONSES_ONLY] }) },
  });
  const models = capture.provider?.models as Array<{ id: string }>;
  assert.equal(models.length, FALLBACK_MODELS.length);
  assert.match(String(errors.mock.calls[0]?.arguments[0]), /no Pi-compatible chat models/);
});

test("registerInfron warns about malformed and duplicate entries", async (t) => {
  const warnings = t.mock.method(console, "warn", () => {});
  const capture: RegistrationCapture = {};
  await registerInfron(fakePi(capture), {
    fetchOptions: {
      fetchImpl: liveCatalog({ data: [...CATALOG.data, CATALOG.data[0], { id: 42 }] }),
    },
  });
  assert.match(String(warnings.mock.calls[0]?.arguments[0]), /ignored 1 malformed and 1 duplicate/);
});

test("PI_OFFLINE skips all discovery network access", async () => {
  const previous = process.env.PI_OFFLINE;
  process.env.PI_OFFLINE = "true";
  let called = false;
  try {
    const capture: RegistrationCapture = {};
    await registerInfron(fakePi(capture), {
      fetchOptions: {
        fetchImpl: async () => {
          called = true;
          throw new Error("must not be called");
        },
      },
    });
    const models = capture.provider?.models as Array<{ id: string }>;
    assert.equal(called, false);
    assert.equal(models.length, FALLBACK_MODELS.length);
  } finally {
    if (previous === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previous;
  }
});
