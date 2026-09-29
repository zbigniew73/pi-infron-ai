import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  API_KEY_ENV,
  FREE_MODEL_MIN_BALANCE_USD,
  KEY_MANAGEMENT_URL,
  PROVIDER_ID,
  PROVIDER_LABEL,
} from "./config.js";
import { parseInfronError, type InfronError } from "./infron-api.js";

// Pi triggers auto-compaction + retry when an error message contains this marker.
const OVERFLOW_MARKER = "context_length_exceeded";
const OVERFLOW_PATTERN =
  /context\s*(length|window|limit)|input\s*length\s*exceed|exceeds?\s*(?:the\s*)?context|too\s*many\s*tokens|maximum\s*context/i;
const FREE_MODEL_PATTERN = /free model requires account balance/i;
const CREDITS_PATTERN = /credits?\b|insufficient\s*(balance|funds)/i;
const NO_PROVIDER_PATTERN = /no available providers? for model/i;
const DECODED_PREFIX = "Infron HTTP ";

/** Actionable advice for an Infron error, based on HTTP status and message text. */
export function guidanceFor(
  status: number | undefined,
  error: InfronError,
): string | undefined {
  const message = error.message;
  if (FREE_MODEL_PATTERN.test(message)) {
    return (
      `Free (:free) models require an account balance of at least ` +
      `$${FREE_MODEL_MIN_BALANCE_USD}. Top up your Infron credits or pick a paid model with /model`
    );
  }
  if (status === 401) {
    return (
      `The API key is missing or was rejected. Run /login and select ` +
      `"${PROVIDER_LABEL}", or check ${API_KEY_ENV} (/infron shows the status). ` +
      `Keys: ${KEY_MANAGEMENT_URL}`
    );
  }
  if (status === 402 || CREDITS_PATTERN.test(message)) {
    return "Your Infron credits are used up. Top up your account balance and retry";
  }
  if (status === 403) {
    return "Infron moderation rejected the request. Rephrase the input or pick another model with /model";
  }
  if (status === 408 || status === 429) {
    return "Infron timed out or rate-limited the request. Retry shortly";
  }
  if (NO_PROVIDER_PATTERN.test(message)) {
    return "This model id is unknown or currently unavailable on Infron. Pick another with /model";
  }
  if (status === 502 || status === 503) {
    return "The upstream provider is unavailable. Retry shortly or pick another model with /model";
  }
  if (status === 400) {
    return error.code === "invalid_text_request"
      ? "Infron rejected the request text. Check the prompt content and retry"
      : "The request was rejected. Reduce the context or report a compatibility issue if the request is otherwise valid";
  }
  return undefined;
}

export function formatInfronError(
  status: number | undefined,
  error: InfronError,
): string {
  const code = error.code === undefined ? "" : ` (${String(error.code)})`;
  const head = status === undefined ? "Infron error" : `${DECODED_PREFIX}${status}`;
  const guidance = guidanceFor(status, error);
  let text = `${head}${code}: ${error.message}`;
  if (guidance) text += `. ${guidance}`;
  if (error.requestId) text += ` (request id: ${error.requestId})`;
  return text;
}

/** Pi surfaces provider failures as "<status>: <body>"; rewrite them into actionable messages. */
export function registerErrorDecoder(pi: ExtensionAPI): void {
  pi.on("message_end", (event) => {
    const message = event.message;
    if (message.role !== "assistant" || message.stopReason !== "error") return;
    if (message.provider !== PROVIDER_ID) return;

    const decoded = decodeErrorMessage(message.errorMessage ?? "");
    if (!decoded) return;
    return { message: { ...message, errorMessage: decoded } };
  });
}

/** Returns the rewritten error message, or null to leave it unchanged. */
export function decodeErrorMessage(errorMessage: string): string | null {
  if (errorMessage.includes(OVERFLOW_MARKER)) return null;
  if (errorMessage.startsWith(DECODED_PREFIX)) return null;

  const match = /^(\d{3}):\s*([\s\S]*)$/.exec(errorMessage);
  const status = match ? Number(match[1]) : undefined;
  const error = parseInfronError(match ? match[2]! : errorMessage);
  const decoded = error ? formatInfronError(status, error) : null;

  if (OVERFLOW_PATTERN.test(errorMessage)) {
    return `${OVERFLOW_MARKER}: ${decoded ?? errorMessage}`;
  }
  return decoded;
}
