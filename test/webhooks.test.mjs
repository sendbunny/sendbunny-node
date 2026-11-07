import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { SendBunny, SendBunnyError, verifyWebhook } from "../dist/esm/index.js"
import { KEY, URL_, newSecret, sign, signedHeaders, withEnv } from "./helpers.mjs"

const EVENT = { id: "evt_1", type: "email.delivered", timestamp: "2026-11-07T10:00:00.000Z", domain: "acme.test", data: { emailId: "em_1" } }
const BODY = JSON.stringify(EVENT)

async function refused(promise, code = "webhook_signature") {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof SendBunnyError, String(err))
    assert.equal(err.code, code)
    return true
  })
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

describe("verifyWebhook accepts genuine requests", () => {
  const secret = newSecret()

  it("returns the event as a list", async () => {
    assert.deepEqual(await verifyWebhook(BODY, signedHeaders(secret, BODY), { secret }), [EVENT])
  })

  it("returns every event of a batched webhook", async () => {
    const body = JSON.stringify({ events: [EVENT, { ...EVENT, id: "evt_2", type: "email.opened" }] })
    const events = await verifyWebhook(body, signedHeaders(secret, body), { secret })
    assert.deepEqual(events.map((e) => e.id), ["evt_1", "evt_2"])
  })

  it("takes the body as a string, Buffer, Uint8Array or ArrayBuffer", async () => {
    const headers = signedHeaders(secret, BODY)
    const buffer = Buffer.from(BODY)
    const bytes = new TextEncoder().encode(BODY)
    for (const body of [BODY, buffer, bytes, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)]) {
      assert.deepEqual(await verifyWebhook(body, headers, { secret }), [EVENT])
    }
  })

  it("keeps non-ASCII text intact", async () => {
    const body = JSON.stringify({ ...EVENT, data: { subject: "Grüße, 你好 👋" } })
    const [event] = await verifyWebhook(Buffer.from(body), signedHeaders(secret, body), { secret })
    assert.equal(event.data.subject, "Grüße, 你好 👋")
  })

  it("reads Headers objects, plain objects, mixed case and arrays", async () => {
    const h = signedHeaders(secret, BODY)
    const variants = [
      new Headers(h),
      { "Webhook-Id": h["webhook-id"], "WEBHOOK-TIMESTAMP": h["webhook-timestamp"], "webhook-signature": h["webhook-signature"] },
      { ...h, "webhook-id": [h["webhook-id"]] },
    ]
    for (const headers of variants) assert.deepEqual(await verifyWebhook(BODY, headers, { secret }), [EVENT])
  })

  it("accepts either secret while one is being rotated", async () => {
    const old = newSecret()
    const h = signedHeaders(secret, BODY)
    const ts = h["webhook-timestamp"]
    const both = `${sign(old, h["webhook-id"], ts, BODY)} ${h["webhook-signature"]}`
    assert.deepEqual(await verifyWebhook(BODY, { ...h, "webhook-signature": both }, { secret }), [EVENT])
    assert.deepEqual(await verifyWebhook(BODY, { ...h, "webhook-signature": both }, { secret: old }), [EVENT])
  })

  it("accepts the secret without its whsec_ prefix", async () => {
    assert.deepEqual(await verifyWebhook(BODY, signedHeaders(secret, BODY), { secret: secret.slice(6) }), [EVENT])
  })

  it("reads SENDBUNNY_WEBHOOK_SECRET, and the client's webhookSecret", async () => {
    await withEnv({ SENDBUNNY_WEBHOOK_SECRET: secret }, async () => {
      assert.deepEqual(await verifyWebhook(BODY, signedHeaders(secret, BODY)), [EVENT])
    })
    const sb = new SendBunny({ url: URL_, apiKey: KEY, webhookSecret: secret })
    assert.deepEqual(await sb.webhooks.verify(BODY, signedHeaders(secret, BODY)), [EVENT])
  })

  it("matches the published Standard Webhooks example", async () => {
    const realNow = Date.now
    Date.now = () => 1614265330 * 1000
    try {
      const body = '{"test": 2432232314}'
      const out = await verifyWebhook(
        body,
        {
          "webhook-id": "msg_p5jXN8AQM9LWM0D4loKWxJek",
          "webhook-timestamp": "1614265330",
          "webhook-signature": "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
        },
        // The public example secret from the Standard Webhooks specification, not a real one.
        { secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw" }, // gitleaks:allow
      ).catch((e) => e)
      // The signature checks out; the body is not a SendBunny event, which is the next check.
      assert.equal(out.code, "webhook_payload")
    } finally {
      Date.now = realNow
    }
  })
})

describe("verifyWebhook refuses forged or replayed requests", () => {
  const secret = newSecret()

  it("refuses the wrong secret", async () => {
    await refused(verifyWebhook(BODY, signedHeaders(newSecret(), BODY), { secret }))
  })

  it("refuses a changed body", async () => {
    const h = signedHeaders(secret, BODY)
    await refused(verifyWebhook(BODY.replace("delivered", "bounced"), h, { secret }))
    await refused(verifyWebhook(`${BODY} `, h, { secret }))
  })

  it("refuses a changed id or timestamp", async () => {
    const h = signedHeaders(secret, BODY)
    await refused(verifyWebhook(BODY, { ...h, "webhook-id": "msg_other" }, { secret }))
    await refused(verifyWebhook(BODY, { ...h, "webhook-timestamp": String(Number(h["webhook-timestamp"]) - 1) }, { secret }))
  })

  it("refuses old and future requests (replays)", async () => {
    await refused(verifyWebhook(BODY, signedHeaders(secret, BODY, { timestamp: nowSeconds() - 301 }), { secret }))
    await refused(verifyWebhook(BODY, signedHeaders(secret, BODY, { timestamp: nowSeconds() + 301 }), { secret }))
    assert.deepEqual(await verifyWebhook(BODY, signedHeaders(secret, BODY, { timestamp: nowSeconds() - 200 }), { secret }), [EVENT])
    await refused(verifyWebhook(BODY, signedHeaders(secret, BODY, { timestamp: nowSeconds() - 200 }), { secret, toleranceSeconds: 60 }))
  })

  it("refuses missing or malformed headers", async () => {
    const h = signedHeaders(secret, BODY)
    for (const name of Object.keys(h)) {
      const { [name]: _gone, ...rest } = h
      await refused(verifyWebhook(BODY, rest, { secret }))
    }
    await refused(verifyWebhook(BODY, { ...h, "webhook-timestamp": "soon" }, { secret }))
    await refused(verifyWebhook(BODY, { ...h, "webhook-signature": "v2,abc" }, { secret }))
    await refused(verifyWebhook(BODY, { ...h, "webhook-signature": h["webhook-signature"].replace("v1,", "") }, { secret }))
    await refused(verifyWebhook(BODY, { ...h, "webhook-signature": "v1,!!!not-base64!!!" }, { secret }))
    await refused(verifyWebhook(BODY, {}, { secret }))
  })

  it("does not read more than a handful of signatures", async () => {
    const h = signedHeaders(secret, BODY)
    const junk = Array.from({ length: 10 }, () => `v1,${Buffer.alloc(32).toString("base64")}`).join(" ")
    await refused(verifyWebhook(BODY, { ...h, "webhook-signature": `${junk} ${h["webhook-signature"]}` }, { secret }))
  })

  it("refuses a parsed body, with a hint", async () => {
    await assert.rejects(verifyWebhook(EVENT, signedHeaders(secret, BODY), { secret }), (err) => {
      assert.equal(err.code, "config")
      assert.match(err.message, /raw request body/)
      return true
    })
  })

  it("explains a missing or wrong secret without repeating it", async () => {
    await withEnv({ SENDBUNNY_WEBHOOK_SECRET: undefined }, async () => {
      await refused(verifyWebhook(BODY, signedHeaders(secret, BODY)), "config")
    })
    await assert.rejects(verifyWebhook(BODY, signedHeaders(secret, BODY), { secret: KEY }), (err) => {
      assert.equal(err.code, "config")
      assert.ok(!err.message.includes(KEY))
      return true
    })
    await refused(verifyWebhook(BODY, signedHeaders(secret, BODY), { secret: "whsec_short" }), "config")
  })

  it("checks the signature before reading the body", async () => {
    await refused(verifyWebhook("not json", signedHeaders(newSecret(), "not json"), { secret }))
    await refused(verifyWebhook("not json", signedHeaders(secret, "not json"), { secret }), "webhook_payload")
    const notEvents = JSON.stringify({ hello: "world" })
    await refused(verifyWebhook(notEvents, signedHeaders(secret, notEvents), { secret }), "webhook_payload")
    for (const broken of [{ ...EVENT, domain: 7 }, { ...EVENT, data: "x" }, { ...EVENT, timestamp: undefined }]) {
      const body = JSON.stringify(broken)
      await refused(verifyWebhook(body, signedHeaders(secret, body), { secret }), "webhook_payload")
    }
  })
})
