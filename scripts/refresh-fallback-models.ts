import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MODELS_URL } from "../src/config.js";
import { parseModelCatalog, type InfronModel } from "../src/infron-api.js";
import {
  isChatModel,
  REASONING_DESCRIPTION_PATTERN,
} from "../src/model-mapping.js";

// Keeps only what the mapper reads. Descriptions shrink to the detected
// reasoning keyword and providers to the smallest context length.
function trim(model: InfronModel): InfronModel {
  const providerContexts = (model.providers ?? [])
    .map((provider) => provider.context_length)
    .filter((value): value is number => value !== undefined);
  const keyword = REASONING_DESCRIPTION_PATTERN.exec(model.description ?? "");
  const inputs = model.input_modalities?.filter(
    (entry) => entry === "text" || entry === "image",
  );
  const trimmed: InfronModel = {
    id: model.id,
    display_name: model.display_name,
    description: keyword?.[0].toLowerCase(),
    category_type: model.category_type,
    supported_endpoint_types: ["openai"],
    input_modalities: inputs && inputs.length > 0 ? inputs : undefined,
    output_modalities: model.output_modalities ? ["text"] : undefined,
    supports_streaming: model.supports_streaming,
    supports_vision: model.supports_vision,
    supports_json_mode: model.supports_json_mode,
    context_length: model.context_length,
    max_input_tokens: model.max_input_tokens,
    max_output_tokens: model.max_output_tokens,
    min_prompt_price: model.min_prompt_price,
    min_completion_price: model.min_completion_price,
    providers:
      providerContexts.length > 0
        ? [{ context_length: Math.min(...providerContexts) }]
        : undefined,
  };
  return JSON.parse(JSON.stringify(trimmed)) as InfronModel;
}

const response = await fetch(MODELS_URL, {
  headers: { Accept: "application/json" },
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`/models returned HTTP ${response.status}`);

const parsed = parseModelCatalog((await response.json()) as unknown);
if (!parsed) throw new Error("Infron returned an invalid model catalog");
const models = [
  ...new Map(
    parsed.models.filter(isChatModel).map((model) => [model.id, model]),
  ).values(),
]
  .sort((a, b) => a.id.localeCompare(b.id))
  .map(trim);
if (models.length === 0) throw new Error("Infron catalog has no chat models");
const refreshedOn = new Date().toISOString().slice(0, 10);
const output =
  `import type { InfronModel } from "./infron-api.js";\n\n` +
  `export const FALLBACK_SOURCE_URL = ${JSON.stringify(MODELS_URL)};\n` +
  `export const FALLBACK_REFRESHED_ON = ${JSON.stringify(refreshedOn)};\n\n` +
  `// Refreshed with npm run catalog:refresh on ${refreshedOn}.\n` +
  `export const FALLBACK_MODELS: InfronModel[] = [\n` +
  models.map((model) => `  ${JSON.stringify(model)},`).join("\n") +
  `\n];\n`;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await writeFile(resolve(root, "src", "fallback-models.ts"), output, "utf8");
console.log(`Wrote ${models.length} fallback models refreshed on ${refreshedOn}`);
