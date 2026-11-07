/**
 * What kind of failure a {@link SendBunnyError} is.
 *
 * - `config`: a setting is missing or wrong (fix your code or environment).
 * - `network`: SendBunny could not be reached.
 * - `timeout`: no answer in time. A write may still have gone through.
 * - `aborted`: your own `AbortSignal` cancelled the call.
 * - `api`: SendBunny answered with an error; see `status` and `message`.
 *   A server error (status 500 and up) on a send may still have sent it:
 *   see `uncertain`.
 * - `bad_response`: the answer was not one a SendBunny install sends
 *   (usually `SENDBUNNY_URL` points somewhere else).
 * - `webhook_signature`: a webhook's signature or timestamp did not check out.
 * - `webhook_payload`: a webhook's body was not SendBunny events.
 */
export type SendBunnyErrorCode =
  | "config"
  | "network"
  | "timeout"
  | "aborted"
  | "api"
  | "bad_response"
  | "webhook_signature"
  | "webhook_payload"

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
 * The one error type this SDK throws. Its message never contains your API key
 * or webhook secret.
 */
export class SendBunnyError extends Error {
  override readonly name = "SendBunnyError"
  readonly code: SendBunnyErrorCode
  /**
   * True when SendBunny may still have carried out the request even though
   * the call failed: no answer in time, a dropped connection, or a server
   * error on a send. Do not simply repeat it (an email could go out twice);
   * check in SendBunny first.
   */
  readonly uncertain: boolean
  readonly status: number | null
  readonly retryAfter: number | null
  readonly requestId: string | null
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

/** @internal */
export function configError(message: string): SendBunnyError {
  return new SendBunnyError(message, { code: "config" })
}
