import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  API_KEY_ENV,
  FREE_MODEL_MIN_BALANCE_USD,
  KEY_MANAGEMENT_URL,
  PROVIDER_ID,
  PROVIDER_LABEL,
} from "./config.js";
import { guidanceFor } from "./errors.js";
import { probeChatCompletion, validateApiKey } from "./infron-api.js";

export type ProbeFunction = typeof probeChatCompletion;
export type BalanceFunction = typeof validateApiKey;

export function selectProbeModel(
  requested: string | undefined,
  current: string | undefined,
  modelIds: readonly string[],
): string | undefined {
  const explicit = requested?.trim();
  if (explicit) return explicit;
  if (current && modelIds.includes(current)) return current;
  return [...modelIds].sort((left, right) => left.localeCompare(right))[0];
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** `/infron [model]`: credential source, credit balance, and a one-token completion probe. */
export function registerStatusCommand(
  pi: ExtensionAPI,
  modelIds: readonly string[],
  probe: ProbeFunction = probeChatCompletion,
  balance: BalanceFunction = validateApiKey,
): void {
  pi.registerCommand("infron", {
    description: `Show ${PROVIDER_LABEL} auth status, credit balance, and test the API`,
    handler: async (args, ctx) => {
      const apiKey = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER_ID);
      if (!apiKey) {
        ctx.ui.notify(
          `${PROVIDER_LABEL}: not configured. Run /login and select ` +
            `"${PROVIDER_LABEL}", or export ${API_KEY_ENV}. ` +
            `Get a key at ${KEY_MANAGEMENT_URL}`,
          "warning",
        );
        return;
      }

      const source =
        process.env[API_KEY_ENV] === apiKey
          ? `${API_KEY_ENV} environment variable`
          : "stored /login credentials";
      const account = await balance(apiKey);
      const balanceText =
        account.creditBalance !== undefined
          ? `credit balance ${formatUsd(account.creditBalance)}`
          : account.status === "invalid"
            ? "key rejected by Infron"
            : `balance unavailable (${account.detail})`;
      ctx.ui.notify(
        `${PROVIDER_LABEL}: key from ${source}, ${balanceText}, ` +
          `${modelIds.length} models registered`,
        account.status === "invalid" ? "error" : "info",
      );

      const currentModel =
        ctx.model?.provider === PROVIDER_ID ? ctx.model.id : undefined;
      const model = selectProbeModel(args, currentModel, modelIds);
      if (!model) {
        ctx.ui.notify(`${PROVIDER_LABEL}: no usable model is registered`, "error");
        return;
      }
      const result = await probe(apiKey, model);
      let detail = result.detail;
      if (result.error) {
        const guidance = guidanceFor(result.status, result.error);
        if (guidance) detail += `. ${guidance}`;
        if (result.error.requestId) {
          detail += ` (request id: ${result.error.requestId})`;
        }
      }
      if (model.endsWith(":free")) {
        detail +=
          ` (free models need an account balance of at least ` +
          `$${FREE_MODEL_MIN_BALANCE_USD})`;
      }
      ctx.ui.notify(
        `${PROVIDER_LABEL} probe: ${detail}`,
        result.ok ? "info" : "error",
      );
    },
  });
}
