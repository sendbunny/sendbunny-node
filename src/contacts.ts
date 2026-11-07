import { configError } from "./errors.js"
import type { RequestOptions, Transport } from "./http.js"

/**
 * For someone new to the domain:
 * - `subscribed`: they agreed to hear from you (with double opt-in on, they
 *   are asked to confirm first);
 * - `never_subscribed`: a customer or contact who never asked for marketing email.
 */
export type ContactStatus = "subscribed" | "never_subscribed"

/** How someone agreed to hear from you. */
export interface ContactConsent {
  how: "form" | "customer" | "event" | "other"
  /** The words beside the tick box, or a short note. */
  note?: string
}

export interface AddContactParams {
  email: string
  name?: string
  /** Sending domain the contact belongs to, like `acme.com`. Defaults to the client's `domain`. */
  domain?: string
  /**
   * Needed for someone new to the domain; without it nothing is written.
   * Never changes the subscription of someone already there.
   */
  status?: ContactStatus
  /** A list to add them to. */
  listId?: string
  /** More lists to add them to. */
  lists?: readonly string[]
  /** Field values by field slug, like `{ plan: "Pro" }`. */
  fields?: Record<string, unknown>
  /** With `status: "subscribed"`: how they agreed. */
  agreed?: ContactConsent
  /** Topic id to on (`true`) or off (`false`). */
  topics?: Record<string, boolean>
  /** Send the double opt-in confirmation email. */
  confirm?: boolean
}

/** A contact as SendBunny stores it. */
export type Contact = Record<string, unknown>

/** Your audience. */
export class Contacts {
  readonly #http: Transport
  readonly #domain: string | undefined

  /** @internal */
  constructor(http: Transport, domain: string | undefined) {
    this.#http = http
    this.#domain = domain
  }

  /**
   * Add a contact, or update one already in the domain (name, the fields
   * given, and lists). Someone who unsubscribed stays unsubscribed.
   */
  async add(params: AddContactParams, options?: RequestOptions): Promise<Contact> {
    if (!params || typeof params !== "object") throw configError("contacts.add needs the contact's details.")
    if (typeof params.email !== "string" || !params.email.trim()) throw configError("contacts.add needs `email`.")
    const domain = params.domain ?? this.#domain
    if (!domain) {
      throw configError("contacts.add needs a domain: pass `domain` (like acme.com), or set it once with new SendBunny({ domain }).")
    }
    const answer = await this.#http.request<{ contact: Contact }>(
      "POST",
      "/contacts",
      {
        email: params.email,
        name: params.name,
        rootDomain: domain.trim().toLowerCase(),
        status: params.status,
        listId: params.listId,
        lists: params.lists === undefined ? undefined : [...params.lists],
        fields: params.fields,
        agreed: params.agreed,
        topics: params.topics,
        confirm: params.confirm,
      },
      options,
    )
    return answer.contact
  }
}
