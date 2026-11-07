import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { SendBunny, SendBunnyError, VERSION } from "../dist/esm/index.js"
import { KEY, URL_, fakeFetch, json } from "./helpers.mjs"

/**
 * A fetch that never answers until aborted. A real request holds a socket
 * open, which keeps Node running; AbortSignal.timeout alone does not, so this
 * holds a timer for the same effect.
 */
function hangingFetch(_input, init) {
  const keepAlive = setInterval(() => {}, 1000)
  return new Promise((_resolve, reject) =>
    init.signal.addEventListener("abort", () => {
      clearInterval(keepAlive)
      reject(init.signal.reason)
    }),
  )
}

function client(answer, extra = {}) {
  const f = fakeFetch(answer)
  return { sb: new SendBunny({ url: URL_, apiKey: KEY, fetch: f.fetch, ...extra }), calls: f.calls }
}

async function failure(promise, check) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof SendBunnyError, String(err))
    assert.ok(!err.message.includes(KEY), "message must not contain the key")
    check(err)
    return true
  })
}

describe("emails.send", () => {
  it("posts the email with the key, and returns its ids", async () => {
    const { sb, calls } = client(() => json(200, { id: "em_1", messageId: "<m1@acme.test>" }))
    const result = await sb.emails.send({ from: "Acme <hello@acme.test>", to: "ana@example.com", subject: "Hi", html: "<p>Hi</p>" })
    assert.deepEqual(result, { id: "em_1", messageId: "<m1@acme.test>" })
    assert.equal(calls.length, 1)
    const [{ input, init, body }] = calls
    assert.equal(input, `${URL_}/emails`)
    assert.equal(init.method, "POST")
    assert.equal(init.redirect, "manual")
    assert.equal(init.headers["x-api-key"], KEY)
    assert.equal(init.headers["content-type"], "application/json")
    assert.equal(init.headers["user-agent"], `sendbunny-node/${VERSION}`)
    assert.ok(init.signal instanceof AbortSignal)
    assert.deepEqual(body, { from: "Acme <hello@acme.test>", to: ["ana@example.com"], subject: "Hi", html: "<p>Hi</p>" })
  })

  it("sends a template with its data, lists stay lists", async () => {
    const { sb, calls } = client(() => json(200, { id: "em_2", messageId: "<m2@acme.test>" }))
    await sb.emails.send({
      from: "hello@acme.test",
      to: ["a@example.com", "b@example.com"],
      cc: "c@example.com",
      replyTo: "help@acme.test",
      templateAlias: "welcome",
      data: { name: "Ana" },
    })
    assert.deepEqual(calls[0].body, {
      from: "hello@acme.test",
      to: ["a@example.com", "b@example.com"],
      cc: ["c@example.com"],
      replyTo: ["help@acme.test"],
      templateAlias: "welcome",
      data: { name: "Ana" },
    })
  })

  it("passes unknown fields on, so SendBunny can refuse the ones it does not support", async () => {
    const { sb, calls } = client(() => json(400, { error: "'bcc' is not supported yet" }))
    const payload = { from: "a@acme.test", to: "b@example.com", subject: "x", text: "x", bcc: ["hidden@example.com"], attachments: [{ filename: "a.pdf" }] }
    await failure(sb.emails.send(payload), (e) => assert.equal(e.status, 400))
    assert.deepEqual(calls[0].body.bcc, ["hidden@example.com"])
    assert.deepEqual(calls[0].body.attachments, [{ filename: "a.pdf" }])
  })

  it("checks the basics before sending anything", async () => {
    const { sb, calls } = client()
    await failure(sb.emails.send({ from: "a@acme.test", to: 42, subject: "x", text: "x" }), (e) => assert.equal(e.code, "config"))
    await failure(sb.emails.send({ from: "a@acme.test", to: "b@example.com", cc: 42, subject: "x", text: "x" }), (e) => assert.equal(e.code, "config"))
    await failure(sb.emails.send({ to: "a@example.com", subject: "x", text: "x" }), (e) => assert.equal(e.code, "config"))
    await failure(sb.emails.send({ from: "a@acme.test", subject: "x", text: "x" }), (e) => assert.equal(e.code, "config"))
    await failure(sb.emails.send(undefined), (e) => assert.equal(e.code, "config"))
    assert.equal(calls.length, 0)
  })
})

describe("errors", () => {
  it("passes on SendBunny's own message and status", async () => {
    const { sb } = client(() => json(400, { error: "'to' contains an invalid address: ana@" }, { "x-amzn-requestid": "req-1" }))
    await failure(sb.emails.send({ from: "a@acme.test", to: "ana@", subject: "x", text: "x" }), (e) => {
      assert.equal(e.code, "api")
      assert.equal(e.status, 400)
      assert.equal(e.message, "'to' contains an invalid address: ana@")
      assert.equal(e.requestId, "req-1")
      assert.deepEqual(e.body, { error: "'to' contains an invalid address: ana@" })
      assert.equal(e.uncertain, false)
    })
  })

  it("explains a refused key when the answer has no message", async () => {
    const { sb } = client(() => json(403, { message: "Forbidden" }))
    await failure(sb.emails.send({ from: "a@acme.test", to: "b@example.com", subject: "x", text: "x" }), (e) => {
      assert.equal(e.code, "api")
      assert.match(e.message, /API key/)
      assert.equal(e.uncertain, false)
    })
  })

  it("reports Retry-After in seconds", async () => {
    const { sb } = client(() => json(429, { error: "Slow down" }, { "retry-after": "7" }))
    await failure(sb.events.track({ email: "a@example.com", event: "x", domain: "acme.test" }), (e) => {
      assert.equal(e.status, 429)
      assert.equal(e.retryAfter, 7)
    })
  })

  it("does not retry: one failed send is one request", async () => {
    const { sb, calls } = client(() => json(503, { error: "Busy" }))
    await failure(sb.emails.send({ from: "a@acme.test", to: "b@example.com", subject: "x", text: "x" }), (e) => assert.equal(e.status, 503))
    assert.equal(calls.length, 1)
  })

  it("marks a server error on a send as uncertain: the email may have gone out", async () => {
    const answers = [
      () => json(504, { message: "Endpoint request timed out" }),
      () => json(500, { error: "Something broke" }),
      () => new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    ]
    for (const answer of answers) {
      const { sb } = client(answer)
      await failure(sb.emails.send({ from: "a@acme.test", to: "b@example.com", subject: "x", text: "x" }), (e) => {
        assert.equal(e.code, "api")
        assert.equal(e.uncertain, true)
        assert.ok(e.status >= 500)
      })
    }
  })

  it("points a non-JSON 404 at the address, and a non-JSON success is not SendBunny", async () => {
    const { sb } = client(() => new Response("<html>Not found</html>", { status: 404 }))
    await failure(sb.emails.send({ from: "a@acme.test", to: "b@example.com", subject: "x", text: "x" }), (e) => {
      assert.equal(e.code, "api")
      assert.equal(e.status, 404)
      assert.match(e.message, /SENDBUNNY_URL/)
    })
    const ok = client(() => new Response("hello", { status: 200 }))
    await failure(ok.sb.emails.send({ from: "a@acme.test", to: "b@example.com", subject: "x", text: "x" }), (e) => assert.equal(e.code, "bad_response"))
  })

  it("never follows a redirect", async () => {
    const { sb, calls } = client(() => new Response(null, { status: 302, headers: { location: "https://evil.test/collect" } }))
    await failure(sb.emails.send({ from: "a@acme.test", to: "b@example.com", subject: "x", text: "x" }), (e) => {
      assert.equal(e.code, "bad_response")
      assert.equal(e.status, 302)
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].init.redirect, "manual")
  })

  it("reports an unreachable address once, without retrying", async () => {
    let n = 0
    const sb = new SendBunny({
      url: URL_,
      apiKey: KEY,
      fetch: async () => {
        n++
        throw new TypeError("fetch failed")
      },
    })
    await failure(sb.emails.send({ from: "a@acme.test", to: "b@example.com", subject: "x", text: "x" }), (e) => {
      assert.equal(e.code, "network")
      assert.equal(e.uncertain, true)
      assert.match(e.message, /mail\.acme\.test/)
      assert.ok(e.cause instanceof TypeError)
    })
    assert.equal(n, 1)
  })

  it("times out, and says the request may have gone through", async () => {
    const hang = hangingFetch
    const sb = new SendBunny({ url: URL_, apiKey: KEY, fetch: hang, timeoutMs: 30 })
    await failure(sb.emails.send({ from: "a@acme.test", to: "b@example.com", subject: "x", text: "x" }), (e) => {
      assert.equal(e.code, "timeout")
      assert.equal(e.uncertain, true)
      assert.match(e.message, /may still have gone through/)
    })
    await failure(sb.emails.send({ from: "a@acme.test", to: "b@example.com", subject: "x", text: "x" }, { timeoutMs: 10 }), (e) =>
      assert.equal(e.code, "timeout"),
    )
  })

  it("stops when your own signal aborts", async () => {
    const hang = hangingFetch
    const sb = new SendBunny({ url: URL_, apiKey: KEY, fetch: hang })
    const controller = new AbortController()
    const pending = sb.emails.send({ from: "a@acme.test", to: "b@example.com", subject: "x", text: "x" }, { signal: controller.signal })
    controller.abort()
    await failure(pending, (e) => assert.equal(e.code, "aborted"))
  })
})

describe("contacts.add", () => {
  it("needs a domain, from the call or the client", async () => {
    const { sb, calls } = client(() => json(200, { contact: { email: "ana@example.com" } }))
    await failure(sb.contacts.add({ email: "ana@example.com", status: "subscribed" }), (e) => {
      assert.equal(e.code, "config")
      assert.match(e.message, /domain/)
    })
    await failure(sb.contacts.add({ email: "ana@example.com", domain: 123 }), (e) => assert.equal(e.code, "config"))
    await failure(sb.contacts.add({ email: "ana@example.com", domain: "acme.test", lists: "lst_1" }), (e) => assert.equal(e.code, "config"))
    assert.equal(calls.length, 0)
  })

  it("sends the contact and returns it", async () => {
    const { sb, calls } = client(() => json(200, { contact: { email: "ana@example.com", name: "Ana" } }), { domain: "Acme.Test" })
    const contact = await sb.contacts.add({
      email: "ana@example.com",
      name: "Ana",
      status: "subscribed",
      agreed: { how: "form", note: "Send me news" },
      listId: "lst_1",
      fields: { plan: "Pro" },
    })
    assert.deepEqual(contact, { email: "ana@example.com", name: "Ana" })
    assert.equal(calls[0].input, `${URL_}/contacts`)
    assert.deepEqual(calls[0].body, {
      email: "ana@example.com",
      name: "Ana",
      rootDomain: "acme.test",
      status: "subscribed",
      listId: "lst_1",
      fields: { plan: "Pro" },
      agreed: { how: "form", note: "Send me news" },
    })
  })
})

describe("events.track", () => {
  it("sends the event under SendBunny's field names", async () => {
    const { sb, calls } = client(() => json(200, { ok: true, entered: 1, resumed: 0, goals: 0 }))
    const result = await sb.events.track({ email: "ana@example.com", event: "trial_started", data: { plan: "Pro" }, domain: "acme.test" })
    assert.deepEqual(result, { ok: true, entered: 1, resumed: 0, goals: 0 })
    assert.equal(calls[0].input, `${URL_}/events`)
    assert.deepEqual(calls[0].body, { rootDomain: "acme.test", email: "ana@example.com", name: "trial_started", data: { plan: "Pro" } })
  })

  it("checks email and event first", async () => {
    const { sb, calls } = client()
    await failure(sb.events.track({ event: "x", domain: "acme.test" }), (e) => assert.equal(e.code, "config"))
    await failure(sb.events.track({ email: "a@example.com", domain: "acme.test" }), (e) => assert.equal(e.code, "config"))
    await failure(sb.events.track({ email: "a@example.com", event: "x", domain: 123 }), (e) => assert.equal(e.code, "config"))
    assert.equal(calls.length, 0)
  })
})
