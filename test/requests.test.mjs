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

/** The call returned an error (and never threw); returns it after the shared checks. */
async function failed(promise, check = () => {}) {
  const result = await promise
  assert.equal(result.data, null)
  assert.ok(result.error instanceof SendBunnyError, String(result.error))
  assert.ok(!result.error.message.includes(KEY), "message must not contain the key")
  check(result.error)
  return result.error
}

/** The call succeeded; returns its data. */
async function succeeded(promise) {
  const result = await promise
  assert.equal(result.error, null, result.error?.message)
  return result.data
}

const TEXT_EMAIL = { from: "a@acme.test", to: "b@example.com", subject: "x", text: "x" }

describe("emails.send", () => {
  it("posts the email with the key, and returns its ids as data", async () => {
    const { sb, calls } = client(() => json(200, { id: "em_1", messageId: "<m1@acme.test>" }))
    const result = await sb.emails.send({ from: "Acme <hello@acme.test>", to: "ana@example.com", subject: "Hi", html: "<p>Hi</p>" })
    assert.deepEqual(result, { data: { id: "em_1", messageId: "<m1@acme.test>" }, error: null })
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
    await succeeded(
      sb.emails.send({
        from: "hello@acme.test",
        to: ["a@example.com", "b@example.com"],
        cc: "c@example.com",
        replyTo: "help@acme.test",
        templateAlias: "welcome",
        data: { name: "Ana" },
      }),
    )
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
    const payload = { ...TEXT_EMAIL, bcc: ["hidden@example.com"], attachments: [{ filename: "a.pdf" }] }
    await failed(sb.emails.send(payload), (e) => {
      assert.equal(e.code, "validation_error")
      assert.equal(e.status, 400)
    })
    assert.deepEqual(calls[0].body.bcc, ["hidden@example.com"])
    assert.deepEqual(calls[0].body.attachments, [{ filename: "a.pdf" }])
  })

  it("checks the basics before sending anything, without throwing", async () => {
    const { sb, calls } = client()
    for (const params of [
      { ...TEXT_EMAIL, to: 42 },
      { ...TEXT_EMAIL, cc: 42 },
      { ...TEXT_EMAIL, from: undefined },
      { ...TEXT_EMAIL, to: undefined },
      { ...TEXT_EMAIL, react: "not an element" },
      undefined,
    ]) {
      await failed(sb.emails.send(params), (e) => assert.equal(e.code, "validation_error"))
    }
    assert.equal(calls.length, 0)
  })

  it("says how to add React Email when its renderer is not installed", async () => {
    const { sb, calls } = client()
    const element = { type: () => null, props: { name: "Ana" }, key: null }
    await failed(sb.emails.send({ from: "a@acme.test", to: "b@example.com", subject: "x", react: element }), (e) => {
      assert.equal(e.code, "config")
      assert.match(e.message, /npm install react-email/)
    })
    assert.equal(calls.length, 0)
  })
})

describe("emails.get and emails.list", () => {
  const EMAIL = { id: "em_1", messageId: "m1", rootDomain: "acme.test", subject: "Hi", status: "delivered", htmlKey: "bodies/em_1.html", textKey: null, inboxMessageId: null }

  it("gets one email, with its body when asked, without storage details", async () => {
    const { sb, calls } = client(() => json(200, { email: { ...EMAIL, html: "<p>Hi</p>", text: "Hi" } }))
    const email = await succeeded(sb.emails.get("em 1/x", { includeBody: true }))
    assert.equal(calls[0].input, `${URL_}/emails/em%201%2Fx?include=body`)
    assert.equal(calls[0].init.method, "GET")
    assert.equal(calls[0].init.body, undefined)
    assert.equal(email.html, "<p>Hi</p>")
    assert.equal(email.status, "delivered")
    assert.ok(!("htmlKey" in email) && !("textKey" in email) && !("inboxMessageId" in email))
    await succeeded(sb.emails.get("em_1"))
    assert.equal(calls[1].input, `${URL_}/emails/em_1`)
  })

  it("answers not_found for an unknown email", async () => {
    const { sb } = client(() => json(404, { error: "Not found" }))
    await failed(sb.emails.get("nope"), (e) => {
      assert.equal(e.code, "not_found")
      assert.equal(e.uncertain, false)
    })
    await failed(sb.emails.get(""), (e) => assert.equal(e.code, "validation_error"))
  })

  it("lists a page of the log for the client's domain", async () => {
    const { sb, calls } = client(() => json(200, { emails: [EMAIL], cursor: "next" }), { domain: "acme.test" })
    const page = await succeeded(sb.emails.list({ limit: 10 }))
    assert.equal(calls[0].input, `${URL_}/emails?root=acme.test&limit=10`)
    assert.equal(page.cursor, "next")
    assert.equal(page.emails.length, 1)
    assert.ok(!("htmlKey" in page.emails[0]))
    await succeeded(sb.emails.list({ domain: "other.test", cursor: "next" }))
    assert.equal(calls[1].input, `${URL_}/emails?root=other.test&cursor=next`)
  })

  it("needs a domain to list", async () => {
    const { sb, calls } = client()
    await failed(sb.emails.list(), (e) => {
      assert.equal(e.code, "validation_error")
      assert.match(e.message, /domain/)
    })
    assert.equal(calls.length, 0)
  })
})

describe("errors come back as values", () => {
  it("passes on SendBunny's own message, status and request id", async () => {
    const { sb } = client(() => json(400, { error: "'to' contains an invalid address: ana@" }, { "x-amzn-requestid": "req-1" }))
    await failed(sb.emails.send({ ...TEXT_EMAIL, to: "ana@" }), (e) => {
      assert.equal(e.code, "validation_error")
      assert.equal(e.status, 400)
      assert.equal(e.message, "'to' contains an invalid address: ana@")
      assert.equal(e.requestId, "req-1")
      assert.deepEqual(e.body, { error: "'to' contains an invalid address: ana@" })
      assert.equal(e.uncertain, false)
    })
  })

  it("names each kind of refusal", async () => {
    const cases = [
      [401, { error: "Invalid API key" }, "unauthorized"],
      [403, { message: "Forbidden" }, "forbidden"],
      [403, { error: "Automations are part of SendBunny Premium. Upgrade: https://sendbunny.co/upgrade", code: "premium_required" }, "premium_required"],
      [404, { error: "Not found" }, "not_found"],
      [409, { error: "Busy" }, "api_error"],
      [413, { error: "Too big" }, "validation_error"],
      [422, { error: "Bad" }, "validation_error"],
      [429, { error: "Slow down" }, "rate_limited"],
      [500, { error: "Internal error" }, "server_error"],
    ]
    for (const [status, body, code] of cases) {
      const { sb } = client(() => json(status, body))
      await failed(sb.emails.send(TEXT_EMAIL), (e) => {
        assert.equal(e.code, code, `status ${status}`)
        assert.equal(e.status, status)
      })
    }
  })

  it("explains a refused key when the answer has no message", async () => {
    const { sb } = client(() => json(403, { message: "Forbidden" }))
    await failed(sb.emails.send(TEXT_EMAIL), (e) => assert.match(e.message, /API key/))
  })

  it("reports Retry-After in seconds", async () => {
    const { sb } = client(() => json(429, { error: "Slow down" }, { "retry-after": "7" }))
    await failed(sb.events.track({ email: "a@example.com", event: "x", domain: "acme.test" }), (e) => {
      assert.equal(e.status, 429)
      assert.equal(e.retryAfter, 7)
    })
  })

  it("does not retry: one failed send is one request", async () => {
    const { sb, calls } = client(() => json(503, { error: "Busy" }))
    await failed(sb.emails.send(TEXT_EMAIL), (e) => assert.equal(e.status, 503))
    assert.equal(calls.length, 1)
  })

  it("marks a server error on a write as uncertain, but not on a read", async () => {
    const answers = [
      () => json(504, { message: "Endpoint request timed out" }),
      () => json(500, { error: "Something broke" }),
      () => new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    ]
    for (const answer of answers) {
      const { sb } = client(answer)
      await failed(sb.emails.send(TEXT_EMAIL), (e) => {
        assert.equal(e.code, "server_error")
        assert.equal(e.uncertain, true)
        assert.ok(e.status >= 500)
      })
      await failed(sb.emails.get("em_1"), (e) => assert.equal(e.uncertain, false))
    }
  })

  it("points a non-JSON 404 at the address, and a non-JSON success is not SendBunny", async () => {
    const { sb } = client(() => new Response("<html>Not found</html>", { status: 404 }))
    await failed(sb.emails.send(TEXT_EMAIL), (e) => {
      assert.equal(e.code, "not_found")
      assert.match(e.message, /SENDBUNNY_URL/)
    })
    const ok = client(() => new Response("hello", { status: 200 }))
    await failed(ok.sb.emails.send(TEXT_EMAIL), (e) => assert.equal(e.code, "bad_response"))
  })

  it("never follows a redirect", async () => {
    const { sb, calls } = client(() => new Response(null, { status: 302, headers: { location: "https://evil.test/collect" } }))
    await failed(sb.emails.send(TEXT_EMAIL), (e) => {
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
    await failed(sb.emails.send(TEXT_EMAIL), (e) => {
      assert.equal(e.code, "network")
      assert.equal(e.uncertain, true)
      assert.match(e.message, /mail\.acme\.test/)
      assert.ok(e.cause instanceof TypeError)
    })
    assert.equal(n, 1)
  })

  it("times out, and says the request may have gone through", async () => {
    const sb = new SendBunny({ url: URL_, apiKey: KEY, fetch: hangingFetch, timeoutMs: 30 })
    await failed(sb.emails.send(TEXT_EMAIL), (e) => {
      assert.equal(e.code, "timeout")
      assert.equal(e.uncertain, true)
      assert.match(e.message, /may still have gone through/)
    })
    await failed(sb.emails.send(TEXT_EMAIL, { timeoutMs: 10 }), (e) => assert.equal(e.code, "timeout"))
  })

  it("stops when your own signal aborts", async () => {
    const sb = new SendBunny({ url: URL_, apiKey: KEY, fetch: hangingFetch })
    const controller = new AbortController()
    const pending = sb.emails.send(TEXT_EMAIL, { signal: controller.signal })
    controller.abort()
    await failed(pending, (e) => assert.equal(e.code, "aborted"))
  })

  it("turns a surprise inside the SDK into an error value too", async () => {
    const sb = new SendBunny({ url: URL_, apiKey: KEY, fetch: async () => ({ status: 200, type: "basic", headers: new Headers(), text: async () => { throw new RangeError("odd") } }) })
    const e = await failed(sb.emails.send(TEXT_EMAIL))
    assert.equal(e.code, "network")
    const weird = new SendBunny({ url: URL_, apiKey: KEY, fetch: async () => json(200, { contact: null }), domain: "acme.test" })
    await failed(weird.contacts.create({ email: "a@example.com", status: "subscribed" }), (err) => assert.equal(err.code, "unexpected"))
  })
})

describe("contacts", () => {
  it("needs a domain, from the call or the client", async () => {
    const { sb, calls } = client(() => json(200, { contact: { ok: true, email: "ana@example.com" } }))
    await failed(sb.contacts.create({ email: "ana@example.com", status: "subscribed" }), (e) => {
      assert.equal(e.code, "validation_error")
      assert.match(e.message, /domain/)
    })
    await failed(sb.contacts.create({ email: "ana@example.com", domain: 123 }), (e) => assert.equal(e.code, "validation_error"))
    await failed(sb.contacts.create({ email: "ana@example.com", domain: "acme.test", lists: "lst_1" }), (e) => assert.equal(e.code, "validation_error"))
    await failed(sb.contacts.get("ana@example.com"), (e) => assert.equal(e.code, "validation_error"))
    assert.equal(calls.length, 0)
  })

  it("creates a contact and returns what happened", async () => {
    const answer = { ok: true, email: "ana@example.com", created: true, newToDomain: true, addedToList: true, stayedUnsubscribed: false, consent: { status: "S", waitingToConfirm: false, refused: [] } }
    const { sb, calls } = client(() => json(200, { contact: answer }), { domain: "Acme.Test" })
    const result = await succeeded(
      sb.contacts.create({
        email: "ana@example.com",
        name: "Ana",
        status: "subscribed",
        agreed: { how: "form", note: "Send me news" },
        listId: "lst_1",
        fields: { plan: "Pro" },
      }),
    )
    const { ok: _ok, ...expected } = answer
    assert.deepEqual(result, expected)
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

  it("gets, updates, lists and removes, with the email in the path", async () => {
    const contact = { email: "ana+x@example.com", rootDomain: "acme.test", name: "Ana", status: "subscribed", fields: {}, lists: [] }
    const { sb, calls } = client((input, init) => {
      if (init.method === "GET" && input.includes("/contacts/")) return json(200, { contact })
      if (init.method === "GET") return json(200, { contacts: [contact], cursor: null })
      if (init.method === "PATCH") return json(200, { contact: { ok: true, email: contact.email, changed: true } })
      return json(200, { deleted: true })
    }, { domain: "acme.test" })

    assert.deepEqual(await succeeded(sb.contacts.get("ana+x@example.com")), contact)
    assert.equal(calls[0].input, `${URL_}/contacts/ana%2Bx%40example.com?root=acme.test`)

    assert.deepEqual(await succeeded(sb.contacts.update({ email: "ana+x@example.com", name: "Ana B", fields: { plan: null } })), { email: contact.email, changed: true })
    assert.equal(calls[1].init.method, "PATCH")
    assert.equal(calls[1].input, `${URL_}/contacts/ana%2Bx%40example.com`)
    assert.deepEqual(calls[1].body, { rootDomain: "acme.test", name: "Ana B", fields: { plan: null } })

    const page = await succeeded(sb.contacts.list({ domain: "other.test", limit: 5 }))
    assert.deepEqual(page, { contacts: [contact], cursor: null })
    assert.equal(calls[2].input, `${URL_}/contacts?root=other.test&limit=5`)

    assert.deepEqual(await succeeded(sb.contacts.remove({ email: "ana+x@example.com", domain: "other.test" })), { deleted: true })
    assert.equal(calls[3].init.method, "DELETE")
    assert.equal(calls[3].input, `${URL_}/contacts/ana%2Bx%40example.com?root=other.test`)
  })

  it("marks a failed remove as uncertain, a failed get as not", async () => {
    const { sb } = client(() => json(502, { message: "Bad gateway" }), { domain: "acme.test" })
    await failed(sb.contacts.remove("ana@example.com"), (e) => assert.equal(e.uncertain, true))
    await failed(sb.contacts.get("ana@example.com"), (e) => assert.equal(e.uncertain, false))
  })
})

describe("events.track", () => {
  it("sends the event under SendBunny's field names", async () => {
    const { sb, calls } = client(() => json(200, { ok: true, entered: 1, resumed: 0, goals: 0 }))
    const result = await succeeded(sb.events.track({ email: "ana@example.com", event: "trial_started", data: { plan: "Pro" }, domain: "acme.test" }))
    assert.deepEqual(result, { entered: 1, resumed: 0, goals: 0 })
    assert.equal(calls[0].input, `${URL_}/events`)
    assert.deepEqual(calls[0].body, { rootDomain: "acme.test", email: "ana@example.com", name: "trial_started", data: { plan: "Pro" } })
  })

  it("checks email and event first", async () => {
    const { sb, calls } = client()
    await failed(sb.events.track({ event: "x", domain: "acme.test" }), (e) => assert.equal(e.code, "validation_error"))
    await failed(sb.events.track({ email: "a@example.com", domain: "acme.test" }), (e) => assert.equal(e.code, "validation_error"))
    await failed(sb.events.track({ email: "a@example.com", event: "x", domain: 123 }), (e) => assert.equal(e.code, "validation_error"))
    assert.equal(calls.length, 0)
  })

  it("names the Premium refusal on a Free install", async () => {
    const { sb } = client(() => json(403, { error: "Automations are part of SendBunny Premium. Upgrade: https://sendbunny.co/upgrade", code: "premium_required" }))
    await failed(sb.events.track({ email: "a@example.com", event: "x", domain: "acme.test" }), (e) => {
      assert.equal(e.code, "premium_required")
      assert.match(e.message, /Premium/)
    })
  })
})
