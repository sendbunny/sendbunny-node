import { configError } from "./errors.js"
import type { RequestOptions, Transport } from "./http.js"

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

type WithBody = { html: string; text?: string } | { html?: string; text: string }

/** An email written in your code. */
export type SendEmailContent = SendEmailCommon &
  WithBody & {
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
  }

export type SendEmailParams = SendEmailContent | SendEmailTemplate

export interface SendEmailResult {
  /** SendBunny's id for this email (see it in the sent-email log). */
  id: string
  /** The Message-ID the email carries. */
  messageId: string
}

function list(value: Recipients): string[] {
  return typeof value === "string" ? [value] : [...value]
}

/** Transactional email. */
export class Emails {
  readonly #http: Transport

  /** @internal */
  constructor(http: Transport) {
    this.#http = http
  }

  /**
   * Send one email, either written in your code (`subject` plus `html`
   * and/or `text`) or from a template (`templateAlias` or `templateId`, with
   * `data`).
   *
   * Never retried automatically. If it fails with code `timeout` or
   * `network`, the email may or may not have gone out: check the sent-email
   * log before sending it again.
   */
  async send(params: SendEmailParams, options?: RequestOptions): Promise<SendEmailResult> {
    if (!params || typeof params !== "object") throw configError("emails.send needs the email's details.")
    if (typeof params.from !== "string" || !params.from.trim()) throw configError("emails.send needs `from`.")
    if (params.to === undefined || params.to === null || (typeof params.to !== "string" && !Array.isArray(params.to))) {
      throw configError("emails.send needs `to`: an address or a list of addresses.")
    }
    return this.#http.request<SendEmailResult>(
      "POST",
      "/emails",
      {
        from: params.from,
        fromName: params.fromName,
        to: list(params.to),
        cc: params.cc === undefined ? undefined : list(params.cc),
        replyTo: params.replyTo === undefined ? undefined : list(params.replyTo),
        subject: params.subject,
        html: params.html,
        text: params.text,
        templateId: params.templateId,
        templateAlias: params.templateAlias,
        data: params.data,
        topicId: params.topicId,
      },
      options,
    )
  }
}
