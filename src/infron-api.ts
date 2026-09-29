import {
  BALANCE_URL,
  BASE_URL,
  MODELS_URL,
  REQUEST_TIMEOUT_MS,
} from "./config.js";

export interface InfronProvider {
  provider_slug?: string;
  service_tier?: string;
  prompt_price?: number;
  completion_price?: number;
  context_length?: number;
}

export interface InfronModel {
  id: string;
  display_name?: string;
  description?: string;
  category_type?: string;
  supported_endpoint_types?: string[];
  input_modalities?: string[];
  output_modalities?: string[];
  supports_streaming?: boolean;
  supports_function_calling?: boolean;
  supports_vision?: boolean;
  supports_json_mode?: boolean;
  deprecated?: boolean;
  is_display_only?: boolean;
  context_length?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  min_prompt_price?: number;
  min_completion_price?: number;
  providers?: InfronProvider[];
}

export interface CatalogParseResult {
  models: InfronModel[];
  rejectedEntries: number;
  duplicateEntries: number;
}

export interface FetchModelsOptions {
  signal?: AbortSignal;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface InfronError {
  message: string;
  type?: string;
  code?: string | number;
  param?: string;
  requestId?: string;
}

export interface ProbeResult {
  ok: boolean;
  status?: number;
  error?: InfronError;
  detail: string;
}

export type ApiKeyValidationStatus = "valid" | "invalid" | "indeterminate";

export interface ApiKeyValidationResult {
  status: ApiKeyValidationStatus;
  httpStatus?: number;
  creditBalance?: number;
  error?: InfronError;
  detail: string;
}

export interface RequestOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const REQUEST_ID_PATTERN = /\s*\(request id:\s*([^)\s]+)\)/i;
const PROBE_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function optionalPrice(
  record: Record<string, unknown>,
  key: string,
): { valid: boolean; value?: number } {
  const raw = record[key];
  if (raw === undefined || raw === null) return { valid: true };
  const value = nonNegativeNumber(raw);
  return value === undefined ? { valid: false } : { valid: true, value };
}

function optionalString(
  value: unknown,
  maxLength = 256,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function lowercaseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0 && entry.length <= 64);
  return values.length > 0 ? [...new Set(values)] : undefined;
}

function parseProviders(value: unknown): InfronProvider[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const providers: InfronProvider[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const provider: InfronProvider = {};
    const slug = optionalString(entry.provider_slug);
    const tier = optionalString(entry.service_tier);
    const promptPrice = nonNegativeNumber(entry.prompt_price);
    const completionPrice = nonNegativeNumber(entry.completion_price);
    const contextLength = positiveInteger(entry.context_length);
    if (slug) provider.provider_slug = slug;
    if (tier) provider.service_tier = tier;
    if (promptPrice !== undefined) provider.prompt_price = promptPrice;
    if (completionPrice !== undefined) provider.completion_price = completionPrice;
    if (contextLength !== undefined) provider.context_length = contextLength;
    providers.push(provider);
  }
  return providers.length > 0 ? providers : undefined;
}

function parseModel(value: unknown): InfronModel | null {
  if (!isRecord(value)) return null;
  const id = optionalString(value.id);
  if (!id || !MODEL_ID_PATTERN.test(id)) return null;

  const promptPrice = optionalPrice(value, "min_prompt_price");
  const completionPrice = optionalPrice(value, "min_completion_price");
  if (!promptPrice.valid || !completionPrice.valid) return null;

  const model: InfronModel = { id };
  const strings = {
    display_name: optionalString(value.display_name),
    description: optionalString(value.description, 8000),
    category_type: optionalString(value.category_type, 64),
  };
  const arrays = {
    supported_endpoint_types: lowercaseStringArray(value.supported_endpoint_types),
    input_modalities: lowercaseStringArray(value.input_modalities),
    output_modalities: lowercaseStringArray(value.output_modalities),
  };
  const flags = {
    supports_streaming: optionalBoolean(value.supports_streaming),
    supports_function_calling: optionalBoolean(value.supports_function_calling),
    supports_vision: optionalBoolean(value.supports_vision),
    supports_json_mode: optionalBoolean(value.supports_json_mode),
    deprecated: optionalBoolean(value.deprecated),
    is_display_only: optionalBoolean(value.is_display_only),
  };
  const limits = {
    context_length: positiveInteger(value.context_length),
    max_input_tokens: positiveInteger(value.max_input_tokens),
    max_output_tokens: positiveInteger(value.max_output_tokens),
  };
  for (const source of [strings, arrays, flags, limits]) {
    for (const [key, entry] of Object.entries(source)) {
      if (entry !== undefined) Object.assign(model, { [key]: entry });
    }
  }
  if (promptPrice.value !== undefined) model.min_prompt_price = promptPrice.value;
  if (completionPrice.value !== undefined) {
    model.min_completion_price = completionPrice.value;
  }
  const providers = parseProviders(value.providers);
  if (providers) model.providers = providers;
  return model;
}

/** Validate a /models payload without trusting any JSON shape. */
export function parseModelCatalog(payload: unknown): CatalogParseResult | null {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return null;

  const models: InfronModel[] = [];
  const seen = new Set<string>();
  let rejectedEntries = 0;
  let duplicateEntries = 0;
  for (const entry of payload.data) {
    const model = parseModel(entry);
    if (!model) {
      rejectedEntries += 1;
      continue;
    }
    if (seen.has(model.id)) {
      duplicateEntries += 1;
      continue;
    }
    seen.add(model.id);
    models.push(model);
  }
  return { models, rejectedEntries, duplicateEntries };
}

/** Fetch and validate the live model catalog. Returns null on any failure. */
export async function fetchModels(
  options: FetchModelsOptions = {},
): Promise<CatalogParseResult | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

  try {
    const response = await fetchImpl(MODELS_URL, {
      headers,
      signal: options.signal,
    });
    if (!response.ok) return null;
    const parsed = parseModelCatalog((await response.json()) as unknown);
    return parsed && parsed.models.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** Parse an OpenAI-shaped `{error: {...}}` body. `code` may be a string, a number, or absent. */
export function parseInfronError(body: string): InfronError | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.error)) return null;
  const raw = parsed.error;
  if (typeof raw.message !== "string" || raw.message.trim().length === 0) {
    return null;
  }

  const match = REQUEST_ID_PATTERN.exec(raw.message);
  const error: InfronError = {
    message: raw.message.replace(REQUEST_ID_PATTERN, "").trim(),
  };
  const requestId =
    optionalString(raw.request_id, 128) ??
    optionalString(parsed.request_id, 128) ??
    match?.[1];
  if (typeof raw.type === "string" && raw.type) error.type = raw.type;
  if (
    (typeof raw.code === "string" && raw.code) ||
    (typeof raw.code === "number" && Number.isFinite(raw.code))
  ) {
    error.code = raw.code;
  }
  if (typeof raw.param === "string" && raw.param) error.param = raw.param;
  if (requestId) error.requestId = requestId;
  return error;
}

function requestSignal(
  signal: AbortSignal | undefined,
  timeoutMs = REQUEST_TIMEOUT_MS,
): AbortSignal {
  return signal ?? AbortSignal.timeout(timeoutMs);
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

function safeBodyDetail(body: string): string {
  const compact = body.replace(/\s+/g, " ").trim();
  return compact.length > 0 ? compact.slice(0, 200) : "empty response body";
}

/** Run a minimal model-specific completion for the /infron diagnostic. */
export async function probeChatCompletion(
  apiKey: string,
  model: string,
  options: RequestOptions = {},
): Promise<ProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = requestSignal(options.signal, PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 1,
      }),
      signal,
    });
    const body = await response.text();
    if (response.ok) {
      try {
        const payload = JSON.parse(body) as unknown;
        if (!isRecord(payload) || !Array.isArray(payload.choices)) {
          return {
            ok: false,
            status: response.status,
            detail: `${model}: Infron returned malformed completion JSON`,
          };
        }
      } catch {
        return {
          ok: false,
          status: response.status,
          detail: `${model}: Infron returned invalid completion JSON`,
        };
      }
      return {
        ok: true,
        status: response.status,
        detail: `${model}: completion probe succeeded`,
      };
    }

    const error = parseInfronError(body);
    return {
      ok: false,
      status: response.status,
      error: error ?? undefined,
      detail: error
        ? `${model}: HTTP ${response.status}: ${error.message}`
        : `${model}: HTTP ${response.status}: ${safeBodyDetail(body)}`,
    };
  } catch (error) {
    const detail = isAbortError(error, signal)
      ? "request timed out or was aborted"
      : "network request failed";
    return { ok: false, detail: `${model}: ${detail}` };
  }
}

function creditBalance(payload: unknown): number | undefined {
  if (!isRecord(payload)) return undefined;
  const value = payload.credit_balance;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Validate a key via the balance endpoint without consuming model tokens. */
export async function validateApiKey(
  apiKey: string,
  options: RequestOptions = {},
): Promise<ApiKeyValidationResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = requestSignal(options.signal);
  try {
    const response = await fetchImpl(BALANCE_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal,
    });
    const body = await response.text();
    const error = parseInfronError(body);

    if (response.ok) {
      let balance: number | undefined;
      try {
        balance = creditBalance(JSON.parse(body) as unknown);
      } catch {
        balance = undefined;
      }
      if (balance !== undefined) {
        return {
          status: "valid",
          httpStatus: response.status,
          creditBalance: balance,
          detail: "Infron accepted the key",
        };
      }
      return {
        status: "indeterminate",
        httpStatus: response.status,
        detail: "Infron returned a malformed balance response",
      };
    }

    if (response.status === 401) {
      return {
        status: "invalid",
        httpStatus: response.status,
        error: error ?? undefined,
        detail: error?.message ?? "Infron rejected the API key",
      };
    }

    return {
      status: "indeterminate",
      httpStatus: response.status,
      error: error ?? undefined,
      detail: error
        ? `HTTP ${response.status}: ${error.message}`
        : `HTTP ${response.status}: ${safeBodyDetail(body)}`,
    };
  } catch (error) {
    const detail = isAbortError(error, signal)
      ? "validation timed out or was aborted"
      : "validation request failed";
    return { status: "indeterminate", detail };
  }
}
