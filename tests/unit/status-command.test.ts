import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  registerStatusCommand,
  selectProbeModel,
  type BalanceFunction,
  type ProbeFunction,
} from "../../src/status-command.js";
import { validateApiKey } from "../../src/infron-api.js";
import { BALANCE_OK } from "./fixtures.js";

type Handler = (args: string, context: unknown) => Promise<void>;

function capture(
  probe: ProbeFunction,
  balance: BalanceFunction,
  modelIds: readonly string[] = ["vendor/model"],
): Handler {
  let handler: Handler | undefined;
  let name = "";
  const pi = {
    registerCommand: (value: string, options: { handler: Handler }) => {
      name = value;
      handler = options.handler;
    },
  } as unknown as ExtensionAPI;
  registerStatusCommand(pi, modelIds, probe, balance);
  assert.equal(name, "infron");
  assert.ok(handler);
  return handler;
}

function context(apiKey: string | undefined, notices: Array<[string, string]>, model?: unknown) {
  return {
    modelRegistry: { getApiKeyForProvider: async () => apiKey },
    model,
    ui: { notify: (message: string, level: string) => notices.push([message, level]) },
  };
}

test("selectProbeModel uses explicit, current, then stable catalog order", () => {
  const ids = ["z/model", "b/model", "a/model"];
  assert.equal(selectProbeModel(" custom/model ", "z/model", ids), "custom/model");
  assert.equal(selectProbeModel(undefined, "z/model", ids), "z/model");
  assert.equal(selectProbeModel(undefined, "other/model", ids), "a/model");
  assert.equal(selectProbeModel(undefined, undefined, []), undefined);
});

test("/infron explains missing credentials without network calls", async () => {
  let called = false;
  const handler = capture(
    async () => {
      called = true;
      return { ok: true, detail: "unexpected" };
    },
    async () => {
      called = true;
      return { status: "valid", detail: "unexpected" };
    },
  );
  const notices: Array<[string, string]> = [];
  await handler("", context(undefined, notices));
  assert.equal(called, false);
  assert.match(notices[0]?.[0] ?? "", /Run \/login/);
  assert.match(notices[0]?.[0] ?? "", /INFRON_API_KEY/);
  assert.equal(notices[0]?.[1], "warning");
});

function withEnvKey<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.INFRON_API_KEY;
  if (value === undefined) delete process.env.INFRON_API_KEY;
  else process.env.INFRON_API_KEY = value;
  return run().finally(() => {
    if (previous === undefined) delete process.env.INFRON_API_KEY;
    else process.env.INFRON_API_KEY = previous;
  });
}

const STORED = "Infron AI: key from stored /login credentials";

test("/infron reports status and probe in one notice without leaking the account e-mail", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(BALANCE_OK, { status: 200 }));
  let inputs: [string, string] | undefined;
  const handler = capture(async (key, model) => {
    inputs = [key, model];
    return { ok: true, status: 200, detail: `${model}: completion probe succeeded` };
  }, (key) => validateApiKey(key));
  const notices: Array<[string, string]> = [];
  await withEnvKey(undefined, () =>
    handler("", context("stored-key", notices, { provider: "infron", id: "vendor/model" })),
  );
  assert.deepEqual(inputs, ["stored-key", "vendor/model"]);
  assert.deepEqual(notices, [
    [
      `${STORED}, credit balance $9.9967, 1 models registered\n` +
        "Infron AI probe: vendor/model: completion probe succeeded",
      "info",
    ],
  ]);
  const all = JSON.stringify(notices);
  assert.doesNotMatch(all, /@|user|example\.test|account_name/);
  assert.doesNotMatch(all, /stored-key/);
});

test("/infron probes an explicitly named model", async () => {
  let probed = "";
  const notices: Array<[string, string]> = [];
  await withEnvKey(undefined, () =>
    capture(
      async (_key, model) => {
        probed = model;
        return { ok: true, detail: `${model}: completion probe succeeded` };
      },
      async () => ({ status: "valid", creditBalance: 12.3456, detail: "ok" }),
      ["a/model", "vendor/model"],
    )(" custom/model ", context("key", notices, { provider: "infron", id: "vendor/model" })),
  );
  assert.equal(probed, "custom/model");
  assert.deepEqual(notices, [
    [
      `${STORED}, credit balance $12.3456, 2 models registered\n` +
        "Infron AI probe: custom/model: completion probe succeeded",
      "info",
    ],
  ]);
});

test("/infron reports the environment key, probe guidance, and the free-model hint", async () => {
  const handler = capture(
    async (_key, model) => ({
      ok: false,
      status: 402,
      error: {
        message: "Free model requires account balance greater than $4.999999.",
        requestId: "req-test",
      },
      detail: `${model}: HTTP 402: Free model requires account balance greater than $4.999999.`,
    }),
    async () => ({ status: "valid", creditBalance: 1.5, detail: "ok" }),
  );
  const notices: Array<[string, string]> = [];
  await withEnvKey("env-key", () => handler("vendor/model:free", context("env-key", notices)));
  assert.deepEqual(notices, [
    [
      "Infron AI: key from INFRON_API_KEY environment variable, credit balance $1.5000, " +
        "1 models registered\n" +
        "Infron AI probe: vendor/model:free: HTTP 402: Free model requires account balance " +
        "greater than $4.999999.. Free (:free) models require an account balance of at least $5. " +
        "Top up your Infron credits or pick a paid model with /model (request id: req-test) " +
        "(free models need an account balance of at least $5)",
      "error",
    ],
  ]);
  assert.doesNotMatch(JSON.stringify(notices), /env-key/);
});

test("/infron flags a rejected key as an error even when the probe succeeds", async () => {
  const failed: Array<[string, string]> = [];
  await withEnvKey(undefined, () =>
    capture(
      async () => ({ ok: false, detail: "x: HTTP 401: No token provided" }),
      async () => ({ status: "invalid", detail: "rejected" }),
    )("", context("key", failed)),
  );
  assert.deepEqual(failed, [
    [
      `${STORED}, key rejected by Infron, 1 models registered\n` +
        "Infron AI probe: x: HTTP 401: No token provided",
      "error",
    ],
  ]);

  const passed: Array<[string, string]> = [];
  await withEnvKey(undefined, () =>
    capture(
      async () => ({ ok: true, detail: "ok" }),
      async () => ({ status: "invalid", detail: "rejected" }),
    )("", context("key", passed)),
  );
  assert.equal(passed.length, 1);
  assert.equal(passed[0]?.[1], "error");
});

test("/infron keeps an unavailable balance next to a successful probe", async () => {
  const notices: Array<[string, string]> = [];
  await withEnvKey(undefined, () =>
    capture(
      async () => ({ ok: true, detail: "vendor/model: completion probe succeeded" }),
      async () => ({ status: "indeterminate", detail: "validation request failed" }),
    )("", context("key", notices)),
  );
  assert.deepEqual(notices, [
    [
      `${STORED}, balance unavailable (validation request failed), 1 models registered\n` +
        "Infron AI probe: vendor/model: completion probe succeeded",
      "info",
    ],
  ]);
});

test("/infron keeps the status line when no model is usable", async () => {
  let probed = false;
  const notices: Array<[string, string]> = [];
  await withEnvKey(undefined, () =>
    capture(
      async () => {
        probed = true;
        return { ok: true, detail: "ok" };
      },
      async () => ({ status: "valid", creditBalance: 0.0012, detail: "ok" }),
      [],
    )("", context("key", notices)),
  );
  assert.equal(probed, false);
  assert.deepEqual(notices, [
    [
      `${STORED}, credit balance $0.0012, 0 models registered\n` +
        "Infron AI: no usable model is registered",
      "error",
    ],
  ]);
});
