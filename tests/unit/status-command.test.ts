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

test("/infron shows the credit balance without leaking the account e-mail", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(BALANCE_OK, { status: 200 }));
  let inputs: [string, string] | undefined;
  const handler = capture(async (key, model) => {
    inputs = [key, model];
    return { ok: true, status: 200, detail: `${model}: completion probe succeeded` };
  }, (key) => validateApiKey(key));
  const notices: Array<[string, string]> = [];
  const previous = process.env.INFRON_API_KEY;
  delete process.env.INFRON_API_KEY;
  try {
    await handler("", context("stored-key", notices, { provider: "infron", id: "vendor/model" }));
  } finally {
    if (previous !== undefined) process.env.INFRON_API_KEY = previous;
  }
  assert.deepEqual(inputs, ["stored-key", "vendor/model"]);
  assert.match(notices[0]?.[0] ?? "", /stored \/login credentials/);
  assert.match(notices[0]?.[0] ?? "", /credit balance \$9\.99/);
  assert.match(notices[1]?.[0] ?? "", /completion probe succeeded/);
  assert.equal(notices[1]?.[1], "info");
  const all = JSON.stringify(notices);
  assert.doesNotMatch(all, /@|user|example\.test|account_name/);
  assert.doesNotMatch(all, /stored-key/);
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
  const previous = process.env.INFRON_API_KEY;
  process.env.INFRON_API_KEY = "env-key";
  try {
    await handler("vendor/model:free", context("env-key", notices));
  } finally {
    if (previous === undefined) delete process.env.INFRON_API_KEY;
    else process.env.INFRON_API_KEY = previous;
  }
  assert.match(notices[0]?.[0] ?? "", /INFRON_API_KEY environment variable/);
  assert.match(notices[0]?.[0] ?? "", /\$1\.50/);
  const probe = notices[1]?.[0] ?? "";
  assert.match(probe, /vendor\/model:free: HTTP 402/);
  assert.match(probe, /request id: req-test/);
  assert.match(probe, /free models need an account balance of at least \$5/);
  assert.equal(notices[1]?.[1], "error");
});

test("/infron flags a rejected key and an unavailable balance", async () => {
  const notices: Array<[string, string]> = [];
  await capture(
    async () => ({ ok: false, detail: "x: HTTP 401: No token provided" }),
    async () => ({ status: "invalid", detail: "rejected" }),
  )("", context("key", notices));
  assert.match(notices[0]?.[0] ?? "", /key rejected by Infron/);
  assert.equal(notices[0]?.[1], "error");

  const later: Array<[string, string]> = [];
  await capture(
    async () => ({ ok: true, detail: "ok" }),
    async () => ({ status: "indeterminate", detail: "validation request failed" }),
    [],
  )("", context("key", later));
  assert.match(later[0]?.[0] ?? "", /balance unavailable \(validation request failed\)/);
  assert.match(later[1]?.[0] ?? "", /no usable model/);
});
