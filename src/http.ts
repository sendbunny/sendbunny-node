/** @internal The one place a request leaves this SDK. */
import { DEFAULT_TIMEOUT_MS, resolveTimeout } from "./config.js"
import { SendBunnyError, configError } from "./errors.js"
import { VERSION } from "./version.js"

/** Options every call accepts. */
export interface RequestOptions {
  /** Cancel the call. */
  signal?: AbortSignal
  /** Give up after this many milliseconds (default: the client's `timeoutMs`). */
  timeoutMs?: number
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface TransportInit {
  baseUrl: string
  apiKey: string
  timeoutMs?: number
  fetch?: FetchLike
}

const INSPECT = Symbol.for("nodejs.util.inspect.custom")

function retryAfterSeconds(header: string | null): number | null {
  if (!header) return null
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return null
  return Math.max(0, Math.ceil((date - Date.now()) / 1000))
}

function requestIdOf(headers: Headers): string | null {
  return headers.get("x-amzn-requestid") ?? headers.get("apigw-requestid") ?? headers.get("x-amz-cf-id")
}

/**
 * Sends requests with the API key. Nothing here retries: SendBunny cannot yet
 * tell a repeated send from a new one, so an automatic retry could deliver
 * an email twice. Failures go back to the caller with a clear code instead.
 */
export class Transport {
  readonly #baseUrl: string
  readonly #apiKey: string
  readonly #timeoutMs: number
  readonly #fetch: FetchLike

  constructor(init: TransportInit) {
    this.#baseUrl = init.baseUrl
    this.#apiKey = init.apiKey
    this.#timeoutMs = resolveTimeout(init.timeoutMs, DEFAULT_TIMEOUT_MS)
    const f = init.fetch ?? (globalThis as { fetch?: FetchLike }).fetch
    if (typeof f !== "function") {
      throw configError("This runtime has no fetch. Use Node 20.3 or later, or pass `fetch` in the options.")
    }
    // Called as a plain function: some runtimes reject fetch called on another object.
    this.#fetch = (input, requestInit) => f(input, requestInit)
  }

  get baseUrl(): string {
    return this.#baseUrl
  }

  async request<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const timeoutMs = resolveTimeout(options.timeoutMs, this.#timeoutMs)
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": `sendbunny-node/${VERSION}`,
      "x-api-key": this.#apiKey,
    }
    if (body !== undefined) headers["content-type"] = "application/json"

    let response: Response
    let text: string
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // Never follow a redirect: the API key would travel with it.
        redirect: "manual",
        signal,
      })
      text = await response.text()
    } catch (cause) {
      if (options.signal?.aborted) {
        throw new SendBunnyError("The call was cancelled.", { code: "aborted", cause })
      }
      if (timeout.aborted) {
        throw new SendBunnyError(
          `No answer from SendBunny within ${timeoutMs / 1000} seconds. The request may still have gone through, so check before trying again.`,
          { code: "timeout", cause },
        )
      }
      throw new SendBunnyError(
        `Could not reach SendBunny at ${new URL(this.#baseUrl).host}. Check SENDBUNNY_URL and your network. The request may still have gone through if the connection dropped mid-way.`,
        { code: "network", cause },
      )
    }

    const status = response.status
    const requestId = requestIdOf(response.headers)

    if (response.type === "opaqueredirect" || (status >= 300 && status < 400)) {
      throw new SendBunnyError(
        "SendBunny's address answered with a redirect, which this SDK never follows so your API key goes nowhere else. Set SENDBUNNY_URL to your install's final address.",
        { code: "bad_response", status, requestId },
      )
    }

    let data: unknown
    let isJson = false
    if (text) {
      try {
        data = JSON.parse(text)
        isJson = true
      } catch {
        data = undefined
      }
    }

    if (status < 200 || status >= 300) {
      const serverMessage =
        isJson && data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : null
      throw new SendBunnyError(serverMessage ?? `SendBunny answered with status ${status}.`, {
        code: isJson ? "api" : "bad_response",
        status,
        retryAfter: retryAfterSeconds(response.headers.get("retry-after")),
        requestId,
        body: isJson ? data : null,
      })
    }

    if (!isJson || data === null || typeof data !== "object") {
      throw new SendBunnyError(
        "SendBunny's answer was not what an install sends. Check that SENDBUNNY_URL is your SendBunny install's address.",
        { code: "bad_response", status, requestId },
      )
    }
    return data as T
  }

  /** Shown by console.log: the address, never the key. */
  [INSPECT](): string {
    return `Transport { baseUrl: '${this.#baseUrl}' }`
  }

  toJSON(): { baseUrl: string } {
    return { baseUrl: this.#baseUrl }
  }
}
