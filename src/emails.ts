import { resolveDomain } from "./config.js"
import { validationError } from "./errors.js"
import { withQuery, type RequestOptions, type Transport } from "./http.js"
import { isReactElement, renderReactEmail, type ReactEmailElement } from "./react.js"
import { attempt, type SendBunnyResult } from "./result.js"

/** One address, or several. */
export type Recipients = string | readonly string[]

/** Values for a template's placeholders (at most 64 KB as JSON). */
export type TemplateData = Record<string, unknown>

interface SendEmailCommon {
  /** The sender: `"hello@acme.com"` or `"Acme <hello@acme.com>"`. Must be an address your key may send from. */
  from: string
  /** Sender name; wins over a name written into `from`. */
  fromName?: string
  /** Who receives it (`to` and `cc` together: at most 50). */
  to: Recipients
  cc?: Recipients
  /** Where replies go (at most 10). */
  replyTo?: Recipients
  /**
   * Makes this a marketing email for that topic (see your topics in
   * SendBunny): it then goes to one person, and carries their own
   * unsubscribe link.
   */
  topicId?: string
}

type Body =
  | { html: string; text?: string; react?: never }
  | { text: string; html?: string; react?: never }
  | {
      /**
       * A React Email component, like `<WelcomeEmail name="Ana" />`. Turned
       * into HTML (and a text version, unless you give `text`) on your
       * server. Needs `npm install @react-email/render`.
       */
      react: ReactEmailElement
      text?: string
      html?: never
    }

/** An email written in your code: HTML, text, or a React Email component. */
export type SendEmailContent = SendEmailCommon &
  Body & {
    subject: string
    templateId?: never
    templateAlias?: never
    data?: never
  }

type TemplateRef = { templateId: string; templateAlias?: never } | { templateAlias: string; templateId?: never }

/** An email from a template designed in SendBunny. */
export type SendEmailTemplate = SendEmailCommon &
  TemplateRef & {
    /** Values for the template's placeholders. */
    data?: TemplateData
    /** Replaces the template's own subject. */
    subject?: string
    html?: never
    text?: never
    react?: never
  }

export type SendEmailParams = SendEmailContent | SendEmailTemplate

export interface SendEmailResult {
  /** SendBunny's id for this email: use it with `emails.get`, and find it in the sent-email log. */
  id: string
  /** The Message-ID the email carries. */
  messageId: string
}

/** A sent email, as `emails.get` and `emails.list` return it. */
export interface Email {
  id: string
  messageId: string
  /** The sending domain it belongs to. */
  rootDomain: string
  from: string
  fromName: string | null
  to: string[]
  cc: string[]
  replyTo: string[]
  subject: string
  templateId: string | null
  templateAlias: string | null
  /** Where it came from, like `"transactional"`. */
  source: string
  /** Its latest state, like `"queued"`, `"sent"`, `"delivered"`, `"bounced"` or `"failed"`. */
  status: string | null
  /** When its state last changed (ISO 8601). */
  lastEventAt: string | null
  /** When it was sent (ISO 8601). */
  createdAt: string
  /** When SendBunny forgets it (Unix seconds), if it does. */
  expiresAt: number | null
  /** The inbox conversation it belongs to, if any. */
  threadId: string | null
  /** With `includeBody: true`: the HTML that was sent. */
  html?: string | null
  /** With `includeBody: true`: the text that was sent. */
  text?: string | null
}

export interface GetEmailOptions extends RequestOptions {
  /** Also return the email's `html` and `text`. */
  includeBody?: boolean
}

export interface ListEmailsParams {
  /** Sending domain, like `acme.com`. Defaults to the client's `domain`. */
  domain?: string
  /** How many per page, 1 to 50 (default 25). */
  limit?: number
  /** The `cursor` from the previous page. */
  cursor?: string
}

export interface EmailList {
  /** Newest first. A page can hold fewer than `limit`, even none, while `cursor` goes on. */
  emails: Email[]
  /** Pass it as `cursor` for the next page; null on the last one. */
  cursor: string | null
}

function addressList(value: unknown, field: string): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return [...value]
  throw validationError(`emails.send: \`${field}\` must be an address or a list of addresses.`)
}

/** Transactional email. */
export class Emails {
  readonly #http: Transport
  readonly #domain: string | undefined

  /** @internal */
  constructor(http: Transport, domain: string | undefined) {
    this.#http = http
    this.#domain = domain
  }

  /**
   * Send one email: written in your code (`subject` plus `html`, `text` or
   * `react`), or from a template (`templateAlias` or `templateId`, with
   * `data`).
   *
   * Fields this SDK does not know are passed on unchanged, so SendBunny can
   * refuse the ones it does not support yet (like `bcc` and `attachments`)
   * instead of the email going out without them.
   *
   * Never retried automatically. If `error.uncertain` is true, the email may
   * still have gone out: check in SendBunny before sending again.
   */
  send(params: SendEmailParams, options?: RequestOptions): Promise<SendBunnyResult<SendEmailResult>> {
    return attempt(async () => {
      if (!params || typeof params !== "object") throw validationError("emails.send needs the email's details.")
      if (typeof params.from !== "string" || !params.from.trim()) throw validationError("emails.send needs `from`.")
      if (params.to === undefined || params.to === null) throw validationError("emails.send needs `to`: an address or a list of addresses.")
      const { to, cc, replyTo, react, ...rest } = params as SendEmailParams & Record<string, unknown>
      const recipients = {
        to: addressList(to, "to"),
        ...(cc === undefined ? {} : { cc: addressList(cc, "cc") }),
        ...(replyTo === undefined ? {} : { replyTo: addressList(replyTo, "replyTo") }),
      }
      let content: Record<string, unknown> = rest
      if (react !== undefined) {
        if (!isReactElement(react)) throw validationError("emails.send: `react` must be a React element, like <WelcomeEmail />.")
        if (rest.html !== undefined) throw validationError("emails.send: give `react` or `html`, not both.")
        const rendered = await renderReactEmail(react)
        content = { ...rest, html: rendered.html, text: typeof rest.text === "string" ? rest.text : rendered.text }
      }
      return this.#http.request<SendEmailResult>(
        "POST",
        "/emails",
        { ...content, ...recipients },
        options,
      )
    })
  }

  /** One sent email by its `id` (or its Message-ID). */
  get(id: string, options: GetEmailOptions = {}): Promise<SendBunnyResult<Email>> {
    return attempt(async () => {
      if (typeof id !== "string" || !id.trim()) throw validationError("emails.get needs the email's id.")
      const { includeBody, ...requestOptions } = options
      const path = withQuery(`/emails/${encodeURIComponent(id.trim())}`, { include: includeBody ? "body" : undefined })
      const answer = await this.#http.request<{ email: Email }>("GET", path, undefined, requestOptions)
      return clean(answer.email)
    })
  }

  /** The sent-email log, newest first, a page at a time. */
  list(params: ListEmailsParams = {}, options?: RequestOptions): Promise<SendBunnyResult<EmailList>> {
    return attempt(async () => {
      const domain = resolveDomain(params.domain, true) ?? this.#domain
      if (!domain) throw validationError("emails.list needs a domain: pass `domain` (like acme.com), or set it once with new SendBunny({ domain }).")
      const path = withQuery("/emails", { root: domain, limit: params.limit, cursor: params.cursor })
      const answer = await this.#http.request<{ emails: Email[]; cursor: string | null }>("GET", path, undefined, options)
      return { emails: (answer.emails ?? []).map(clean), cursor: answer.cursor ?? null }
    })
  }
}

/** Leaves out SendBunny's storage details, which are no use to an app. */
function clean(email: Email): Email {
  const { htmlKey: _h, textKey: _t, inboxMessageId: _i, ...rest } = email as Email & Record<string, unknown>
  return rest as Email
}
