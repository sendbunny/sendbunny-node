/**
 * Webhook checks. SendBunny signs every webhook request the Standard Webhooks
 * way (https://www.standardwebhooks.com): headers `webhook-id`,
 * `webhook-timestamp` and `webhook-signature`, the signature being
 * `v1,` + base64 HMAC-SHA256 of `<id>.<timestamp>.<raw body>`. After a secret
 * is rotated, both secrets sign for a day (space-separated signatures).
 */
import { SendBunnyError, configError } from "./errors.js"
import { readEnv } from "./runtime.js"

export type WebhookEventType =
  | "email.sent"
  | "email.delivered"
  | "email.delivery_delayed"
  | "email.bounced"
  | "email.complained"
  | "email.opened"
  | "email.clicked"
  | "email.failed"
  | "subscription.confirmed"
  | "subscription.resubscribed"
  | "subscription.topic_on"
  | "subscription.topic_off"
  | "subscription.unsubscribed_all"
  | "webhook.test"

export interface WebhookEvent {
  /** Stable for this event: a repeat delivery carries the same id, so drop ids you have seen. */
  id: string
  /** What happened. New types may be added; ignore ones you don't handle. */
  type: WebhookEventType | (string & {})
  /** When it happened (ISO 8601), not when it was sent. */
  timestamp: string
  /** The sending domain it belongs to. */
  domain: string
  data: Record<string, unknown>
}

/** Request headers: a `Headers` object, or a plain object such as Node's `req.headers`. */
export type WebhookHeaders =
  | { get(name: string): string | null | undefined }
  | Record<string, string | readonly string[] | undefined>

/** The request body exactly as received: a string, a Buffer/Uint8Array, or an ArrayBuffer. */
export type WebhookBody = string | Uint8Array | ArrayBuffer

export interface VerifyWebhookOptions {
  /** The webhook's signing secret (`whsec_...`). Default: SENDBUNNY_WEBHOOK_SECRET. */
  secret?: string
  /** How far the request's timestamp may be from now, in seconds (default 300). */
  toleranceSeconds?: number
}

const DEFAULT_TOLERANCE_SECONDS = 300
const MAX_TOLERANCE_SECONDS = 3600
/** SendBunny sends one or two; reading a few more costs nothing, reading thousands would. */
const MAX_SIGNATURES = 10
const SIGNATURE_BYTES = 32

function signatureError(message: string): SendBunnyError {
  return new SendBunnyError(message, { code: "webhook_signature" })
}

function payloadError(message: string): SendBunnyError {
  return new SendBunnyError(message, { code: "webhook_payload" })
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null
  let binary: string
  try {
    binary = atob(value)
  } catch {
    return null
  }
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function secretBytes(raw: string | undefined): Uint8Array<ArrayBuffer> {
  const value = raw?.trim()
  if (!value) {
    throw configError(
      "Missing webhook secret. Set SENDBUNNY_WEBHOOK_SECRET (or pass `secret`). It is on the webhook's page in SendBunny and starts with whsec_.",
    )
  }
  if (/^sb[A-Za-z0-9]{18,126}$/.test(value)) {
    throw configError("The webhook secret holds an API key. Use the webhook's own signing secret, which starts with whsec_.")
  }
  const bytes = decodeBase64(value.startsWith("whsec_") ? value.slice("whsec_".length) : value)
  if (!bytes || bytes.length < 16) {
    throw configError("The webhook secret does not look right. Copy it again from the webhook's page in SendBunny; it starts with whsec_.")
  }
  return bytes
}

function bodyBytes(body: unknown): Uint8Array<ArrayBuffer> {
  if (typeof body === "string") return new TextEncoder().encode(body)
  if (ArrayBuffer.isView(body)) {
    // A copy: the check must not depend on a buffer the caller can still change.
    return new Uint8Array(new Uint8Array(body.buffer, body.byteOffset, body.byteLength))
  }
  if (body instanceof ArrayBuffer || Object.prototype.toString.call(body) === "[object ArrayBuffer]") {
    return new Uint8Array((body as ArrayBuffer).slice(0))
  }
  throw configError(
    "Pass the raw request body exactly as received (a string or bytes), not parsed JSON: parsing changes the bytes, so the signature cannot be checked. In Express use express.raw({ type: \"application/json\" }); in a Fetch-style handler use await request.text().",
  )
}

function readHeader(headers: WebhookHeaders, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined
  const getter = (headers as { get?: unknown }).get
  if (typeof getter === "function") {
    const value = (getter as (n: string) => unknown).call(headers, name)
    return typeof value === "string" ? value : undefined
  }
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== name) continue
    if (typeof value === "string") return value
    if (Array.isArray(value) && typeof value[0] === "string") return value[0]
  }
  return undefined
}

function signedContent(id: string, timestamp: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const prefix = new TextEncoder().encode(`${id}.${timestamp}.`)
  const out = new Uint8Array(prefix.length + body.length)
  out.set(prefix, 0)
  out.set(body, prefix.length)
  return out
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseEvents(bytes: Uint8Array): WebhookEvent[] {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw payloadError("The webhook's body is not UTF-8 text.")
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw payloadError("The webhook's body is not JSON.")
  }
  // One event per request, or { events: [...] } for a batched webhook.
  const events: unknown[] = isObject(data) && Array.isArray(data.events) ? data.events : [data]
  for (const event of events) {
    if (
      !isObject(event) ||
      typeof event.id !== "string" ||
      typeof event.type !== "string" ||
      typeof event.timestamp !== "string" ||
      typeof event.domain !== "string" ||
      !isObject(event.data)
    ) {
      throw payloadError("The webhook's body is not SendBunny events.")
    }
  }
  return events as WebhookEvent[]
}

/**
 * Check that a webhook request really came from your SendBunny install, and
 * return its events (always a list, whether the webhook sends one event per
 * request or batches them).
 *
 * Throws a {@link SendBunnyError} with code `webhook_signature` when the
 * signature is missing or wrong, or the request is older than
 * `toleranceSeconds` (a replay). Answer such requests with status 400.
 */
export async function verifyWebhook(
  body: WebhookBody,
  headers: WebhookHeaders,
  options: VerifyWebhookOptions = {},
): Promise<WebhookEvent[]> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle
  if (!subtle) throw configError("This runtime has no Web Crypto (crypto.subtle). Use Node 20.3 or later.")

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS
  if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > MAX_TOLERANCE_SECONDS) {
    throw configError(`toleranceSeconds must be between 1 and ${MAX_TOLERANCE_SECONDS}.`)
  }
  const key = secretBytes(options.secret ?? readEnv("SENDBUNNY_WEBHOOK_SECRET"))
  const bytes = bodyBytes(body)

  const id = readHeader(headers, "webhook-id")?.trim()
  const timestamp = readHeader(headers, "webhook-timestamp")?.trim()
  const signatures = readHeader(headers, "webhook-signature")?.trim()
  if (!id || !timestamp || !signatures) {
    throw signatureError("This request has no SendBunny signature (webhook-id, webhook-timestamp and webhook-signature headers), so it was refused.")
  }
  if (!/^\d{1,12}$/.test(timestamp)) throw signatureError("The webhook's timestamp is not valid, so it was refused.")
  const age = Math.floor(Date.now() / 1000) - Number(timestamp)
  if (Math.abs(age) > tolerance) {
    throw signatureError(
      `The webhook's timestamp is more than ${tolerance} seconds from now, so it was refused (it may be a replay). If this keeps happening, check your server's clock.`,
    )
  }

  const hmacKey = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["verify"])
  const content = signedContent(id, timestamp, bytes)
  let valid = false
  for (const candidate of signatures.split(/\s+/).slice(0, MAX_SIGNATURES)) {
    const comma = candidate.indexOf(",")
    if (comma < 1 || candidate.slice(0, comma) !== "v1") continue
    const signature = decodeBase64(candidate.slice(comma + 1))
    if (!signature || signature.length !== SIGNATURE_BYTES) continue
    // subtle.verify compares in constant time, so timing reveals nothing.
    if (await subtle.verify("HMAC", hmacKey, signature, content)) {
      valid = true
      break
    }
  }
  if (!valid) {
    throw signatureError(
      "The webhook's signature does not match, so it was refused. Check that SENDBUNNY_WEBHOOK_SECRET is this webhook's current secret and that you pass the raw body unchanged.",
    )
  }
  return parseEvents(bytes)
}

/** Webhook checks with the client's secret. */
export class Webhooks {
  readonly #secret: string | undefined

  /** @internal */
  constructor(secret: string | undefined) {
    this.#secret = secret
  }

  /** See {@link verifyWebhook}. Uses the client's `webhookSecret`, then SENDBUNNY_WEBHOOK_SECRET. */
  verify(body: WebhookBody, headers: WebhookHeaders, options: VerifyWebhookOptions = {}): Promise<WebhookEvent[]> {
    return verifyWebhook(body, headers, { ...options, secret: options.secret ?? this.#secret })
  }
}
