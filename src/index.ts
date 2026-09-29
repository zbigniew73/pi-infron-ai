import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { infronOAuth } from "./auth.js";
import {
  API_KEY_ENV,
  BASE_URL,
  LOG_PREFIX,
  PROVIDER_ID,
  PROVIDER_LABEL,
  REQUEST_TIMEOUT_MS,
} from "./config.js";
import { registerErrorDecoder } from "./errors.js";
import { FALLBACK_MODELS } from "./fallback-models.js";
import { fetchModels, type FetchModelsOptions } from "./infron-api.js";
import { toProviderModel, type ProviderModel } from "./model-mapping.js";
import { registerStatusCommand } from "./status-command.js";

export interface RegistrationOptions {
  fetchOptions?: Omit<FetchModelsOptions, "signal" | "apiKey">;
}

function isOffline(): boolean {
  return /^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? "");
}

function mapModels(models: typeof FALLBACK_MODELS): ProviderModel[] {
  return models.map(toProviderModel).filter((model) => model !== null);
}

export async function registerInfron(
  pi: ExtensionAPI,
  options: RegistrationOptions = {},
): Promise<void> {
  // The catalog is public; a key is sent only when one is in the environment.
  const discovered = isOffline()
    ? null
    : await fetchModels({
        ...options.fetchOptions,
        apiKey: process.env[API_KEY_ENV],
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
  if (!discovered && !isOffline()) {
    console.error(
      `${LOG_PREFIX} live model discovery failed. Registering the bundled ` +
        `fallback catalog instead.`,
    );
  } else if (
    discovered &&
    (discovered.rejectedEntries > 0 || discovered.duplicateEntries > 0)
  ) {
    console.warn(
      `${LOG_PREFIX} ignored ${discovered.rejectedEntries} malformed and ` +
        `${discovered.duplicateEntries} duplicate model entries`,
    );
  }

  let models = mapModels(discovered?.models ?? FALLBACK_MODELS);
  if (models.length === 0 && discovered) {
    console.error(
      `${LOG_PREFIX} live discovery returned no Pi-compatible chat models. ` +
        `Registering the bundled fallback catalog instead.`,
    );
    models = mapModels(FALLBACK_MODELS);
  }

  pi.registerProvider(PROVIDER_ID, {
    name: PROVIDER_LABEL,
    baseUrl: BASE_URL,
    apiKey: `$${API_KEY_ENV}`,
    authHeader: true,
    api: "openai-completions",
    models,
    oauth: infronOAuth,
  });

  registerErrorDecoder(pi);
  registerStatusCommand(
    pi,
    models.map((model) => model.id),
  );
}

export default function infron(pi: ExtensionAPI): Promise<void> {
  return registerInfron(pi);
}
