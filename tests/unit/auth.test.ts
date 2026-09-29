import assert from "node:assert/strict";
import test from "node:test";
import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai";

import { createInfronOAuth } from "../../src/auth.js";

function callbacks(value: string): OAuthLoginCallbacks {
  return {
    onAuth: () => {},
    onDeviceCode: () => {},
    onPrompt: async () => value,
    onSelect: async () => undefined,
  };
}

test("login trims and stores a key only after positive validation", async () => {
  let validated = "";
  const oauth = createInfronOAuth(async (key) => {
    validated = key;
    return { status: "valid", detail: "accepted" };
  });
  const credentials = await oauth.login(callbacks("  key-value  "));
  assert.equal(validated, "key-value");
  assert.equal(credentials.access, "key-value");
  assert.equal(credentials.refresh, "key-value");
  assert.ok(credentials.expires > Date.now());
  assert.equal(oauth.getApiKey(credentials), "key-value");
  assert.equal(await oauth.refreshToken(credentials), credentials);
});

test("login rejects empty, invalid, and indeterminate keys", async () => {
  const valid = createInfronOAuth(async () => ({
    status: "valid",
    detail: "accepted",
  }));
  await assert.rejects(() => valid.login(callbacks("   ")), /No API key entered/);

  const invalid = createInfronOAuth(async () => ({
    status: "invalid",
    detail: "rejected",
  }));
  await assert.rejects(() => invalid.login(callbacks("key")), /rejected this key/);

  const unavailable = createInfronOAuth(async () => ({
    status: "indeterminate",
    detail: "service unavailable",
  }));
  await assert.rejects(
    () => unavailable.login(callbacks("key")),
    /Could not validate.*service unavailable/,
  );
});

test("default validator checks keys against the balance endpoint", async (t) => {
  const { validateApiKey } = await import("../../src/infron-api.js");
  const { BALANCE_OK } = await import("./fixtures.js");
  const responses: Record<string, Response> = {
    good: new Response(BALANCE_OK, { status: 200 }),
    bad: new Response('{"error":{"message":"The token status is not available","type":"infron_ai_error"}}', { status: 401 }),
  };
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    const key = (init?.headers as Record<string, string>).Authorization.slice(7);
    if (key === "down") throw new Error("offline");
    return responses[key]!;
  });
  const oauth = createInfronOAuth(validateApiKey);
  assert.equal((await oauth.login(callbacks("good"))).access, "good");
  await assert.rejects(() => oauth.login(callbacks("bad")), /Infron rejected this key/);
  await assert.rejects(() => oauth.login(callbacks("down")), /Could not validate.*Try again/);
});
