/**
 * What went wrong, as a short machine-readable code.
 *
 * Problems with your call or setup:
 * - `config`: a setting is missing or wrong (thrown by `new SendBunny()`).
 * - `validation_error`: the call's details are missing or wrong, or
 *   SendBunny refused them (status 400, 413 or 422).
 * - `render_error`: your React email could not be turned into HTML.
 *
 * Answers from SendBunny:
 * - `unauthorized`: the API key is wrong or revoked (401).
 * - `forbidden`: the key may not do this, or a firewall blocked it (403).
 * - `premium_required`: this needs SendBunny Premium (403).
 * - `not_found`: no such email, contact or address (404).
 * - `rate_limited`: too many requests; see `retryAfter` (429).
 * - `server_error`: SendBunny had a problem (500 and up). A write may still
 *   have been carried out: see `uncertain`.
 * - `api_error`: any other error answer; see `status`.
 *
 * Getting an answer at all:
 * - `network`: SendBunny could not be reached.
 * - `timeout`: no answer in time. A write may still have gone through.
 * - `aborted`: your own `AbortSignal` cancelled the call.
 * - `bad_response`: the answer was not one a SendBunny install sends
 *   (usually `SENDBUNNY_URL` points somewhere else).
 *
 * Webhooks (thrown by `webhooks.verify`):
 * - `webhook_signature`: the signature or timestamp did not check out.
 * - `webhook_payload`: the body was not SendBunny events.
 *
 * - `unexpected`: a bug; please report it.
 */
export type SendBunnyErrorCode =
  | "config"
  | "validation_error"
  | "render_error"
  | "unauthorized"
  | "forbidden"
  | "premium_required"
  | "not_found"
  | "rate_limited"
  | "server_error"
  | "api_error"
  | "network"
  | "timeout"
  | "aborted"
  | "bad_response"
  | "webhook_signature"
  | "webhook_payload"
  | "unexpected"

export interface SendBunnyErrorInit {
  code: SendBunnyErrorCode
  /** True when the request may still have been carried out. */
  uncertain?: boolean
  /** HTTP status SendBunny answered with, when it answered. */
  status?: number | null
  /** Seconds SendBunny asked you to wait before trying again. */
  retryAfter?: number | null
  /** The request's id, for support. */
  requestId?: string | null
  /** The parsed JSON answer, when there was one. */
  body?: unknown
  cause?: unknown
}

/** Marks errors from any copy of this package (an app can load both the import and the require copy). */
const BRAND = Symbol.for("sendbunny.SendBunnyError")

/**
 * The error every call returns as `error` (and `new SendBunny()` and
 * `webhooks.verify` throw). Its message never contains your API key or
 * webhook secret.
 */
export class SendBunnyError extends Error {
  override readonly name = "SendBunnyError"
  readonly code: SendBunnyErrorCode
  /**
   * True when SendBunny may still have carried out the request even though
   * the call failed: no answer in time, a dropped connection, or a server
   * error on a write. Do not simply repeat it (an email could go out twice);
   * check in SendBunny first.
   */
  readonly uncertain: boolean
  /** HTTP status SendBunny answered with, or null when there was no answer. */
  readonly status: number | null
  /** Seconds SendBunny asked you to wait before trying again, if it said. */
  readonly retryAfter: number | null
  /** The request's id, for support. */
  readonly requestId: string | null
  /** SendBunny's answer, parsed, when it sent JSON. */
  readonly body: unknown

  /** `instanceof` works across the import and require copies of this package. */
  static override [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[BRAND] === true
  }

  constructor(message: string, init: SendBunnyErrorInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause })
    Object.defineProperty(this, BRAND, { value: true })
    this.code = init.code
    this.uncertain = init.uncertain ?? false
    this.status = init.status ?? null
    this.retryAfter = init.retryAfter ?? null
    this.requestId = init.requestId ?? null
    this.body = init.body ?? null
  }
}

/** @internal A setting is missing or wrong. */
export function configError(message: string): SendBunnyError {
  return new SendBunnyError(message, { code: "config" })
}

/** @internal A call's details are missing or wrong. */
export function validationError(message: string): SendBunnyError {
  return new SendBunnyError(message, { code: "validation_error" })
}
