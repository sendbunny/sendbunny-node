import { configError } from "./errors.js"
import type { RequestOptions, Transport } from "./http.js"

export interface TrackEventParams {
  /** The contact it happened to. */
  email: string
  /** What happened, like `trial_started` (letters, digits and `_ . : -`, at most 64). */
  event: string
  /** Details, available to the automation's emails (kept 90 days, at most 8 KB). */
  data?: Record<string, unknown>
  /** Sending domain, like `acme.com`. Defaults to the client's `domain`. */
  domain?: string
}

export interface TrackEventResult {
  ok: true
  /** Automations this event started. */
  entered: number
  /** Runs that were waiting for this event and moved on. */
  resumed: number
  /** Runs that ended because this event was their goal. */
  goals: number
  [key: string]: unknown
}

/** Things that happen in your app, which can start automations. */
export class Events {
  readonly #http: Transport
  readonly #domain: string | undefined

  /** @internal */
  constructor(http: Transport, domain: string | undefined) {
    this.#http = http
    this.#domain = domain
  }

  /**
   * Tell SendBunny something happened for a contact. It starts automations
   * with that event as their trigger, moves on people waiting for it, and
   * ends runs whose goal it is.
   *
   * Never retried automatically: a repeat could start an automation twice.
   */
  async track(params: TrackEventParams, options?: RequestOptions): Promise<TrackEventResult> {
    if (!params || typeof params !== "object") throw configError("events.track needs the event's details.")
    if (typeof params.email !== "string" || !params.email.trim()) throw configError("events.track needs `email`.")
    if (typeof params.event !== "string" || !params.event.trim()) throw configError("events.track needs `event`, like \"trial_started\".")
    const domain = params.domain ?? this.#domain
    if (!domain) {
      throw configError("events.track needs a domain: pass `domain` (like acme.com), or set it once with new SendBunny({ domain }).")
    }
    return this.#http.request<TrackEventResult>(
      "POST",
      "/events",
      { rootDomain: domain.trim().toLowerCase(), email: params.email, name: params.event, data: params.data },
      options,
    )
  }
}
