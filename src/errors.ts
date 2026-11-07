/**
 * What kind of failure a {@link SendBunnyError} is.
 *
 * - `config`: a setting is missing or wrong (fix your code or environment).
 * - `network`: SendBunny could not be reached.
 * - `timeout`: no answer in time. A write may still have gone through.
 * - `aborted`: your own `AbortSignal` cancelled the call.
 * - `api`: SendBunny answered with an error; see `status` and `message`.
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

/**
 * The one error type this SDK throws. Its message never contains your API key
 * or webhook secret.
 */
export class SendBunnyError extends Error {
  override readonly name = "SendBunnyError"
  readonly code: SendBunnyErrorCode
  readonly status: number | null
  readonly retryAfter: number | null
  readonly requestId: string | null
  readonly body: unknown

  constructor(message: string, init: SendBunnyErrorInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause })
    this.code = init.code
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
