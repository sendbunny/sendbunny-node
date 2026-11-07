import { resolveApiKey, resolveBaseUrl, resolveDomain } from "./config.js"
import { Contacts } from "./contacts.js"
import { configError } from "./errors.js"
import { Emails } from "./emails.js"
import { Events } from "./events.js"
import { Transport, type FetchLike } from "./http.js"
import { isBrowser, readEnv } from "./runtime.js"
import { Webhooks } from "./webhooks.js"

export interface SendBunnyOptions {
  /**
   * Your install's address, like `https://mail.acme.com/api/v1` (shown as
   * "HTTP API base URL" on its API keys page). Default: SENDBUNNY_URL.
   */
  url?: string
  /** An API key from your install's API keys page. Default: SENDBUNNY_API_KEY. */
  apiKey?: string
  /** Your sending domain, like `acme.com`, used by contacts and events when a call does not name one. */
  domain?: string
  /** A webhook's signing secret (`whsec_...`). Default: SENDBUNNY_WEBHOOK_SECRET. */
  webhookSecret?: string
  /** Give up on a call after this many milliseconds (default 30000). */
  timeoutMs?: number
  /** A fetch to use instead of the built-in one. */
  fetch?: FetchLike
}

const INSPECT = Symbol.for("nodejs.util.inspect.custom")

/**
 * The SendBunny client. Server-side only: it refuses to start in a web page,
 * because an API key there is readable by every visitor.
 *
 * ```ts
 * const sendbunny = new SendBunny() // reads SENDBUNNY_URL and SENDBUNNY_API_KEY
 * await sendbunny.emails.send({ from: "hello@acme.com", to: "ana@example.com", subject: "Hi", text: "Hello!" })
 * ```
 */
export class SendBunny {
  readonly emails: Emails
  readonly contacts: Contacts
  readonly events: Events
  readonly webhooks: Webhooks
  readonly #transport: Transport

  constructor(options: SendBunnyOptions = {}) {
    if (isBrowser()) {
      throw configError(
        "SendBunny runs on your server only. In a web page your API key would be visible to every visitor. Call SendBunny from your backend, or use a SendBunny form for sign-ups.",
      )
    }
    this.#transport = new Transport({
      baseUrl: resolveBaseUrl(options.url ?? readEnv("SENDBUNNY_URL")),
      apiKey: resolveApiKey(options.apiKey ?? readEnv("SENDBUNNY_API_KEY")),
      timeoutMs: options.timeoutMs,
      fetch: options.fetch,
    })
    const domain = resolveDomain(options.domain)
    this.emails = new Emails(this.#transport)
    this.contacts = new Contacts(this.#transport, domain)
    this.events = new Events(this.#transport, domain)
    this.webhooks = new Webhooks(options.webhookSecret)
  }

  /** The API address this client talks to. */
  get url(): string {
    return this.#transport.baseUrl
  }

  /** Shown by console.log: the address, never the key. */
  [INSPECT](): string {
    return `SendBunny { url: '${this.url}' }`
  }

  toJSON(): { url: string } {
    return { url: this.url }
  }
}
