// Shared test helpers. Tests run against the built package (dist/), the same
// files that are published.
import { createHmac, randomBytes } from "node:crypto"

/** A made-up key in the right shape ("sb" plus letters and digits). Never a real one. */
export const KEY = "sbTESTkey0123456789abcdefghijABCDEFGHIJ0123"
export const URL_ = "https://mail.acme.test/api/v1"

/** A fetch that records calls and answers from a script. */
export function fakeFetch(answer = () => json(200, { ok: true })) {
  const calls = []
  const fetch = async (input, init) => {
    calls.push({ input, init, body: init.body === undefined ? undefined : JSON.parse(init.body) })
    return answer(input, init, calls.length)
  }
  return { fetch, calls }
}

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })
}

export function newSecret() {
  return `whsec_${randomBytes(32).toString("base64")}`
}

/** Signs the Standard Webhooks way, as a SendBunny install does. */
export function sign(secret, id, timestamp, body) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64")
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`
}

export function signedHeaders(secret, body, { id = "msg_test_1", timestamp = Math.floor(Date.now() / 1000) } = {}) {
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": sign(secret, id, timestamp, body),
  }
}

/** Runs fn with the given environment variables set, then restores them. */
export async function withEnv(vars, fn) {
  const saved = {}
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    return await fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

export const NO_ENV = { SENDBUNNY_URL: undefined, SENDBUNNY_API_KEY: undefined, SENDBUNNY_WEBHOOK_SECRET: undefined }
