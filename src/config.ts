/** @internal Checks the settings before anything is sent. */
import { configError } from "./errors.js"

const API_PATH = "/api/v1"

/** Keys are `sb` plus letters and digits, 20 to 128 characters in all. */
const API_KEY_PATTERN = /^sb[A-Za-z0-9]{18,126}$/

export const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 600_000

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  )
}

/**
 * The install's API address, from `https://mail.acme.com` or
 * `https://mail.acme.com/api/v1`. HTTPS only (plain HTTP for localhost).
 *
 * Error messages never repeat the value: if someone pastes their API key
 * here by mistake, it must not end up in a log.
 */
export function resolveBaseUrl(raw: string | undefined): string {
  const value = raw?.trim()
  if (!value) {
    throw configError(
      "Missing SendBunny address. Set SENDBUNNY_URL (or pass `url`) to your install's address, shown as \"HTTP API base URL\" on its API keys page.",
    )
  }
  if (API_KEY_PATTERN.test(value)) {
    throw configError("SENDBUNNY_URL holds what looks like an API key. Put the key in SENDBUNNY_API_KEY and your install's address in SENDBUNNY_URL.")
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw configError("SENDBUNNY_URL is not a web address. It should look like https://mail.acme.com/api/v1.")
  }
  if (url.username || url.password) {
    throw configError("SENDBUNNY_URL must not contain a user name or password.")
  }
  if (url.search || url.hash) {
    throw configError("SENDBUNNY_URL must not contain ? or #. Use your install's address, like https://mail.acme.com/api/v1.")
  }
  const local = isLoopback(url.hostname)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw configError("SENDBUNNY_URL must start with https:// so your API key is never sent unencrypted.")
  }
  const path = url.pathname.replace(/\/+$/, "")
  if (path !== "" && path !== API_PATH) {
    throw configError(`SENDBUNNY_URL should be your install's address, ending in ${API_PATH} or nothing, like https://mail.acme.com${API_PATH}.`)
  }
  return `${url.origin}${API_PATH}`
}

/** The API key, checked for shape only. The value is never repeated in an error. */
export function resolveApiKey(raw: string | undefined): string {
  const value = raw?.trim()
  if (!value) {
    throw configError("Missing API key. Set SENDBUNNY_API_KEY (or pass `apiKey`). Create one on your install's API keys page.")
  }
  if (value.startsWith("whsec_")) {
    throw configError("SENDBUNNY_API_KEY holds a webhook signing secret (whsec_...). Use an API key from the API keys page instead.")
  }
  if (/^https?:\/\//i.test(value)) {
    throw configError("SENDBUNNY_API_KEY holds a web address. Put the address in SENDBUNNY_URL and the key in SENDBUNNY_API_KEY.")
  }
  if (!API_KEY_PATTERN.test(value)) {
    throw configError("SENDBUNNY_API_KEY does not look like a SendBunny API key (it starts with \"sb\" and has only letters and digits). Check for a missing character or a stray space.")
  }
  return value
}

export function resolveTimeout(raw: number | undefined, fallback = DEFAULT_TIMEOUT_MS): number {
  if (raw === undefined) return fallback
  if (!Number.isFinite(raw) || raw <= 0 || raw > MAX_TIMEOUT_MS) {
    throw configError(`timeoutMs must be a number of milliseconds between 1 and ${MAX_TIMEOUT_MS}.`)
  }
  return Math.ceil(raw)
}

/** A sending domain such as `acme.com`, lowercased. */
export function resolveDomain(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== "string") throw configError("domain must be your sending domain, like acme.com.")
  const value = raw.trim().toLowerCase()
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
    throw configError("domain must be your sending domain, like acme.com.")
  }
  return value
}
