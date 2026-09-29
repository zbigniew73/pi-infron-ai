export const PROVIDER_ID = "infron";
export const PROVIDER_LABEL = "Infron AI";
export const DEFAULT_BASE_URL = "https://llm.onerouter.pro/v1";
export const BASE_URL = (
  process.env.INFRON_BASE_URL?.trim() || DEFAULT_BASE_URL
).replace(/\/+$/, "");
export const MODELS_URL = `${BASE_URL}/models`;
export const BALANCE_URL = `${BASE_URL}/balance`;
export const API_KEY_ENV = "INFRON_API_KEY";
export const KEY_MANAGEMENT_URL = "https://infron.ai/dashboard/apiKeys";
export const LOG_PREFIX = "[pi-infron]";
export const REQUEST_TIMEOUT_MS = 5000;
export const DEFAULT_CONTEXT_WINDOW = 128000;
export const DEFAULT_MAX_TOKENS = 4096;
export const MAX_TOKENS_CAP = 65536;
export const FREE_MODEL_MIN_BALANCE_USD = 5;
