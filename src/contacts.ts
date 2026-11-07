import { resolveDomain } from "./config.js"
import { validationError } from "./errors.js"
import { withQuery, type RequestOptions, type Transport } from "./http.js"
import { attempt, type SendBunnyResult } from "./result.js"

/**
 * For someone new to the domain:
 * - `subscribed`: they agreed to hear from you (with double opt-in on, they
 *   are asked to confirm first);
 * - `never_subscribed`: a customer or contact who never asked for marketing email.
 */
export type NewContactStatus = "subscribed" | "never_subscribed"

/** Where someone stands with your domain. */
export type ContactStatus = "subscribed" | "waiting" | "unsubscribed" | "never_subscribed" | "blocked"

/** How someone agreed to hear from you. */
export interface ContactConsent {
  how: "form" | "customer" | "event" | "other"
  /** The words beside the tick box, or a short note. */
  note?: string
}

export interface CreateContactParams {
  email: string
  name?: string
  /** Sending domain the contact belongs to, like `acme.com`. Defaults to the client's `domain`. */
  domain?: string
  /**
   * Needed for someone new to the domain; without it nothing is written.
   * Never changes the subscription of someone already there.
   */
  status?: NewContactStatus
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

/** What `contacts.create` did. */
export interface CreateContactResult {
  email: string
  /** A new person: SendBunny had no record of this address before. */
  created: boolean
  /** New to this domain: `status` decided how they started. */
  newToDomain: boolean
  /** Added to the list given. */
  addedToList: boolean
  /** They had unsubscribed, and stay unsubscribed. */
  stayedUnsubscribed: boolean
  consent: {
    /** Their consent now, in SendBunny's short form. */
    status: string
    /** Asked to confirm by email first (double opt-in). */
    waitingToConfirm: boolean
    /** Consent changes that were refused, with the reason (a "no" never quietly turns into a "yes"). */
    refused: string[]
  }
}

/** A contact, as `contacts.get` and `contacts.list` return it. */
export interface Contact {
  email: string
  /** The sending domain this record belongs to. */
  rootDomain: string
  name: string | null
  status: ContactStatus
  /** Why they are blocked, when `status` is `"blocked"`. */
  blockedReason?: "bounced" | "complained" | "blocked_by_you"
  /** Field values by field slug. */
  fields: Record<string, unknown>
  /** Values that no longer fit their field's type, to fix. */
  fieldsNeedingFix?: Record<string, unknown>
  /** ISO 8601 dates of their latest email, open and click. */
  lastSentAt: string | null
  lastOpenedAt: string | null
  lastClickedAt: string | null
  createdAt: string | null
  /** From `contacts.get`: the lists they are on. */
  lists?: { listId: string; unsubscribedAt: string | null }[]
}

/** One contact: their email, or `{ email, domain }`. */
export type ContactRef = string | { email: string; domain?: string }

export interface UpdateContactParams {
  email: string
  /** Defaults to the client's `domain`. */
  domain?: string
  /** A new name; an empty string removes it. */
  name?: string
  /** Field values to change by slug; `null` clears one. Fields not given stay as they are. */
  fields?: Record<string, unknown>
}

export interface UpdateContactResult {
  email: string
  /** False when the values given were already there. */
  changed: boolean
}

export interface ListContactsParams {
  /** Defaults to the client's `domain`. */
  domain?: string
  /** How many per page, 1 to 50 (default 25). */
  limit?: number
  /** The `cursor` from the previous page. */
  cursor?: string
}

export interface ContactList {
  /** Oldest first. */
  contacts: Contact[]
  /** Pass it as `cursor` for the next page; null on the last one. */
  cursor: string | null
}

/** Your contacts. */
export class Contacts {
  readonly #http: Transport
  readonly #domain: string | undefined

  /** @internal */
  constructor(http: Transport, domain: string | undefined) {
    this.#http = http
    this.#domain = domain
  }

  #domainFor(raw: unknown, method: string): string {
    const domain = resolveDomain(raw, true) ?? this.#domain
    if (!domain) {
      throw validationError(`contacts.${method} needs a domain: pass \`domain\` (like acme.com), or set it once with new SendBunny({ domain }).`)
    }
    return domain
  }

  #ref(ref: ContactRef, method: string): { email: string; domain: string } {
    const { email, domain } = typeof ref === "string" ? { email: ref, domain: undefined } : (ref ?? {}) as { email?: unknown; domain?: unknown }
    if (typeof email !== "string" || !email.trim()) throw validationError(`contacts.${method} needs the contact's email.`)
    return { email: email.trim(), domain: this.#domainFor(domain, method) }
  }

  /**
   * Add a contact, or update one already in the domain (name, the fields
   * given, and lists). Someone who unsubscribed stays unsubscribed.
   */
  create(params: CreateContactParams, options?: RequestOptions): Promise<SendBunnyResult<CreateContactResult>> {
    return attempt(async () => {
      if (!params || typeof params !== "object") throw validationError("contacts.create needs the contact's details.")
      if (typeof params.email !== "string" || !params.email.trim()) throw validationError("contacts.create needs `email`.")
      const domain = this.#domainFor(params.domain, "create")
      if (params.lists !== undefined && !Array.isArray(params.lists)) throw validationError("contacts.create: `lists` must be a list of list ids.")
      const answer = await this.#http.request<{ contact: CreateContactResult & { ok?: true } }>(
        "POST",
        "/contacts",
        {
          email: params.email,
          name: params.name,
          rootDomain: domain,
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
      const { ok: _ok, ...result } = answer.contact
      return result
    })
  }

  /** One contact, with the lists they are on. */
  get(ref: ContactRef, options?: RequestOptions): Promise<SendBunnyResult<Contact>> {
    return attempt(async () => {
      const { email, domain } = this.#ref(ref, "get")
      const answer = await this.#http.request<{ contact: Contact }>(
        "GET",
        withQuery(`/contacts/${encodeURIComponent(email)}`, { root: domain }),
        undefined,
        options,
      )
      return answer.contact
    })
  }

  /** Change a contact's name or field values. Their subscription never changes here. */
  update(params: UpdateContactParams, options?: RequestOptions): Promise<SendBunnyResult<UpdateContactResult>> {
    return attempt(async () => {
      if (!params || typeof params !== "object") throw validationError("contacts.update needs the contact's email and the changes.")
      const { email, domain } = this.#ref({ email: params.email, domain: params.domain }, "update")
      const answer = await this.#http.request<{ contact: UpdateContactResult & { ok?: true } }>(
        "PATCH",
        `/contacts/${encodeURIComponent(email)}`,
        { rootDomain: domain, name: params.name, fields: params.fields },
        options,
      )
      const { ok: _ok, ...result } = answer.contact
      return result
    })
  }

  /** Remove a contact from the domain. */
  remove(ref: ContactRef, options?: RequestOptions): Promise<SendBunnyResult<{ deleted: true }>> {
    return attempt(async () => {
      const { email, domain } = this.#ref(ref, "remove")
      await this.#http.request<{ deleted: true }>(
        "DELETE",
        withQuery(`/contacts/${encodeURIComponent(email)}`, { root: domain }),
        undefined,
        options,
      )
      return { deleted: true as const }
    })
  }

  /** Every contact in the domain, a page at a time. */
  list(params: ListContactsParams = {}, options?: RequestOptions): Promise<SendBunnyResult<ContactList>> {
    return attempt(async () => {
      const domain = this.#domainFor(params.domain, "list")
      const answer = await this.#http.request<{ contacts: Contact[]; cursor: string | null }>(
        "GET",
        withQuery("/contacts", { root: domain, limit: params.limit, cursor: params.cursor }),
        undefined,
        options,
      )
      return { contacts: answer.contacts ?? [], cursor: answer.cursor ?? null }
    })
  }
}
