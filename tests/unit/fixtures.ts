// Trimmed samples of the public /models response and real error bodies,
// with request ids replaced by placeholders.

export const KIMI = {
  id: "moonshotai/kimi-k2.6",
  object: "model",
  display_name: "Moonshot: Kimi K2.6",
  category_type: "LLM",
  supported_endpoint_types: ["openai"],
  input_modalities: ["text", "image"],
  output_modalities: ["text"],
  supports_streaming: true,
  supports_function_calling: true,
  supports_vision: true,
  supports_json_mode: true,
  deprecated: false,
  is_display_only: false,
  context_length: 262144,
  max_input_tokens: 262144,
  max_output_tokens: 262144,
  min_prompt_price: 0.44695,
  min_completion_price: 1.85655,
  providers: [
    { provider_slug: "alibaba/cn/flex", service_tier: "flex", prompt_price: 0.44695, completion_price: 1.85655, context_length: 256000 },
    { provider_slug: "inceptron", service_tier: "standard", prompt_price: 0.65, completion_price: 3.41, context_length: 256000 },
    { provider_slug: "siliconflow", service_tier: "standard", prompt_price: 0.77, completion_price: 4, context_length: 262000 },
  ],
};

export const FREE_FLASH = {
  id: "qwen/qwen3.8-flash:free",
  display_name: "Qwen: Qwen3.8 Flash (Free)",
  category_type: "LLM",
  supported_endpoint_types: ["openai"],
  input_modalities: ["text", "image", "video"],
  output_modalities: ["text"],
  supports_streaming: true,
  supports_function_calling: true,
  supports_vision: true,
  supports_json_mode: true,
  deprecated: false,
  is_display_only: false,
  context_length: null,
  max_input_tokens: null,
  max_output_tokens: null,
  min_prompt_price: 0,
  min_completion_price: 0,
  providers: [
    { provider_slug: "infron/cn", service_tier: "standard", prompt_price: 0, completion_price: 0, context_length: null },
  ],
};

export const GEMINI_IMAGE_MIXED_CASE = {
  id: "google/gemini-2.5-flash-image",
  display_name: "Google: Gemini 2.5 flash image",
  category_type: "LLM",
  supported_endpoint_types: ["gemini", "openai"],
  input_modalities: ["Text", "Image"],
  output_modalities: ["Text"],
  supports_streaming: true,
  supports_function_calling: true,
  supports_vision: true,
  supports_json_mode: true,
  deprecated: false,
  is_display_only: false,
  context_length: 32800,
  max_input_tokens: 32800,
  max_output_tokens: 32800,
  min_prompt_price: 0.225,
  min_completion_price: 22.5,
  providers: [
    { provider_slug: "google-vertex", service_tier: "standard", prompt_price: 0.225, completion_price: 22.5, context_length: 32800 },
  ],
};

export const CODEX_RESPONSES_ONLY = {
  id: "openai/gpt-5-codex",
  display_name: "OpenAI: Gpt 5 codex",
  category_type: "LLM",
  supported_endpoint_types: ["openai-response"],
  input_modalities: ["text"],
  output_modalities: ["text"],
  supports_streaming: true,
  supports_function_calling: true,
  supports_vision: false,
  supports_json_mode: false,
  deprecated: false,
  is_display_only: false,
  context_length: 400000,
  max_input_tokens: 400000,
  max_output_tokens: 128000,
  min_prompt_price: 0.9375,
  min_completion_price: 7.5,
  providers: [
    { provider_slug: "azure", service_tier: "standard", prompt_price: 0.9375, completion_price: 7.5, context_length: 400000 },
  ],
};

export const EMBEDDING = {
  id: "thenlper/gte-base",
  display_name: "Thenlper: Gte Base",
  category_type: "Embeddings",
  supported_endpoint_types: ["openai"],
  input_modalities: ["text"],
  output_modalities: ["text"],
  supports_streaming: true,
  supports_function_calling: false,
  supports_vision: false,
  supports_json_mode: false,
  deprecated: false,
  is_display_only: false,
  context_length: 512,
  max_input_tokens: 512,
  max_output_tokens: 512,
  min_prompt_price: 0.005,
  min_completion_price: null,
  providers: [
    { provider_slug: "deepinfra", service_tier: "standard", prompt_price: 0.005, completion_price: null, context_length: 512 },
  ],
};

export const QWEN_THINKING = {
  id: "qwen/qwen3-vl-235b-a22b-thinking",
  display_name: "Qwen: Qwen3 VL 235B A22B Thinking",
  category_type: "LLM",
  supported_endpoint_types: ["openai"],
  input_modalities: ["text"],
  output_modalities: ["text"],
  supports_streaming: true,
  supports_function_calling: true,
  supports_vision: true,
  supports_json_mode: true,
  deprecated: false,
  is_display_only: false,
  context_length: 262100,
  max_input_tokens: 262100,
  max_output_tokens: 32800,
  min_prompt_price: 0.5,
  min_completion_price: 2.5,
  providers: [
    { provider_slug: "atlas-cloud", service_tier: "standard", prompt_price: 0.5, completion_price: 2.5, context_length: 128000 },
  ],
};

export const CATALOG = {
  data: [KIMI, FREE_FLASH, GEMINI_IMAGE_MIXED_CASE, CODEX_RESPONSES_ONLY, EMBEDDING, QWEN_THINKING],
  success: true,
};

export const ERROR_NO_TOKEN =
  '{"error":{"message":"No token provided (request id: req-test)","type":"infron_ai_error"}}';
export const ERROR_TOKEN_UNAVAILABLE =
  '{"error":{"message":"The token status is not available (request id: req-test)","type":"infron_ai_error"}}';
export const ERROR_INVALID_TEXT =
  '{"error":{"message":"Invalid text request (request id: req-test)","type":"infron_ai_error","param":"","code":"invalid_text_request"}}';
export const ERROR_UPSTREAM_NUMERIC_CODE =
  '{"error":{"message":"max_completion_tokens is too large: 400000","type":"BadRequestError","param":"max_completion_tokens","code":400}}';
export const ERROR_NO_PROVIDER =
  '{"error":{"message":"No available providers for model vendor/unknown-model (request id: req-test)","type":"infron_ai_error"}}';
export const ERROR_CREDITS =
  '{"error":{"message":"Your current credits have been used up and we are unable to process further rquests (request id: req-test)","type":"infron_ai_error"}}';
export const ERROR_FREE_BALANCE =
  '{"error":{"message":"Free model requires account balance greater than $4.999999. (request id: req-test)","type":"infron_ai_error"}}';

export const BALANCE_OK = '{"account_name":"user@example.test","credit_balance":9.99}';
