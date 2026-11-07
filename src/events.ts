import { resolveDomain } from "./config.js"
import { validationError } from "./errors.js"
import type { RequestOptions, Transport } from "./http.js"
import { attempt, type SendBunnyResult } from "./result.js"

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
  /** Automations this event started. */
  entered: number
  /** Runs that were waiting for this event and moved on. */
  resumed: number
  /** Runs that ended because this event was their goal. */
  goals: number
}

/** Things that happen in your app, which can start automations (SendBunny Premium). */
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
   * ends runs whose goal it is. Automations are part of SendBunny Premium; on
   * Free the error's code is `premium_required`.
   *
   * Never retried automatically: a repeat could start an automation twice.
   */
  track(params: TrackEventParams, options?: RequestOptions): Promise<SendBunnyResult<TrackEventResult>> {
    return attempt(async () => {
      if (!params || typeof params !== "object") throw validationError("events.track needs the event's details.")
      if (typeof params.email !== "string" || !params.email.trim()) throw validationError("events.track needs `email`.")
      if (typeof params.event !== "string" || !params.event.trim()) throw validationError("events.track needs `event`, like \"trial_started\".")
      const domain = resolveDomain(params.domain, true) ?? this.#domain
      if (!domain) {
        throw validationError("events.track needs a domain: pass `domain` (like acme.com), or set it once with new SendBunny({ domain }).")
      }
      const answer = await this.#http.request<TrackEventResult & { ok?: true }>(
        "POST",
        "/events",
        { rootDomain: domain, email: params.email, name: params.event, data: params.data },
        options,
      )
      const { ok: _ok, ...result } = answer
      return result
    })
  }
}
