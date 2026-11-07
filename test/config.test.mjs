import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { inspect } from "node:util"
import { SendBunny, SendBunnyError, VERSION } from "../dist/esm/index.js"
import { KEY, NO_ENV, URL_, withEnv } from "./helpers.mjs"

function configFailure(fn, pattern) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof SendBunnyError)
    assert.equal(err.code, "config")
    if (pattern) assert.match(err.message, pattern)
    return true
  })
}

describe("settings", () => {
  it("reads SENDBUNNY_URL and SENDBUNNY_API_KEY", async () => {
    await withEnv({ ...NO_ENV, SENDBUNNY_URL: "https://mail.acme.test", SENDBUNNY_API_KEY: KEY }, () => {
      assert.equal(new SendBunny().url, URL_)
    })
  })

  it("prefers options over the environment", async () => {
    await withEnv({ ...NO_ENV, SENDBUNNY_URL: "https://env.acme.test", SENDBUNNY_API_KEY: KEY }, () => {
      assert.equal(new SendBunny({ url: "https://opt.acme.test/api/v1" }).url, "https://opt.acme.test/api/v1")
    })
  })

  it("says what is missing", async () => {
    await withEnv(NO_ENV, () => {
      configFailure(() => new SendBunny(), /SENDBUNNY_URL/)
      configFailure(() => new SendBunny({ url: URL_ }), /SENDBUNNY_API_KEY/)
    })
  })

  it("accepts the install address with or without /api/v1, and trims", () => {
    for (const url of ["https://mail.acme.test", "https://mail.acme.test/", "https://mail.acme.test/api/v1", " https://mail.acme.test/api/v1/ \n"]) {
      assert.equal(new SendBunny({ url, apiKey: KEY }).url, URL_)
    }
  })

  it("refuses plain http, except on localhost", () => {
    configFailure(() => new SendBunny({ url: "http://mail.acme.test", apiKey: KEY }), /https/)
    assert.equal(new SendBunny({ url: "http://localhost:3000", apiKey: KEY }).url, "http://localhost:3000/api/v1")
    assert.equal(new SendBunny({ url: "http://127.0.0.1:3000", apiKey: KEY }).url, "http://127.0.0.1:3000/api/v1")
  })

  it("refuses addresses with a password, a query, another path or another scheme", () => {
    configFailure(() => new SendBunny({ url: "https://user:pass@mail.acme.test", apiKey: KEY }))
    configFailure(() => new SendBunny({ url: "https://mail.acme.test/api/v1?x=1", apiKey: KEY }))
    configFailure(() => new SendBunny({ url: "https://mail.acme.test/other", apiKey: KEY }))
    configFailure(() => new SendBunny({ url: "ftp://mail.acme.test", apiKey: KEY }))
    configFailure(() => new SendBunny({ url: "not a url", apiKey: KEY }))
  })

  it("never repeats a key pasted into the wrong setting", () => {
    for (const fn of [
      () => new SendBunny({ url: KEY, apiKey: KEY }),
      () => new SendBunny({ url: `${KEY}x y`, apiKey: KEY }),
      () => new SendBunny({ url: URL_, apiKey: `${KEY} extra` }),
      () => new SendBunny({ url: URL_, apiKey: KEY.slice(0, 10) }),
    ]) {
      assert.throws(fn, (err) => {
        assert.equal(err.code, "config")
        assert.ok(!err.message.includes(KEY.slice(2, 12)), err.message)
        return true
      })
    }
  })

  it("spots a webhook secret or an address in the key setting", () => {
    configFailure(() => new SendBunny({ url: URL_, apiKey: "whsec_abc" }), /webhook signing secret/)
    configFailure(() => new SendBunny({ url: URL_, apiKey: "https://mail.acme.test" }), /web address/)
  })

  it("checks timeoutMs and domain", () => {
    configFailure(() => new SendBunny({ url: URL_, apiKey: KEY, timeoutMs: 0 }), /timeoutMs/)
    configFailure(() => new SendBunny({ url: URL_, apiKey: KEY, timeoutMs: Number.NaN }), /timeoutMs/)
    configFailure(() => new SendBunny({ url: URL_, apiKey: KEY, domain: "not a domain" }), /domain/)
    new SendBunny({ url: URL_, apiKey: KEY, domain: "Acme.COM" })
  })

  it("refuses to start in a web page", () => {
    globalThis.window = {}
    globalThis.document = {}
    try {
      configFailure(() => new SendBunny({ url: URL_, apiKey: KEY }), /server only/)
    } finally {
      delete globalThis.window
      delete globalThis.document
    }
  })
})

describe("the key stays secret", () => {
  const client = new SendBunny({ url: URL_, apiKey: KEY, webhookSecret: "whsec_c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0" })
  const views = [
    inspect(client),
    inspect(client, { showHidden: true, depth: Infinity }),
    inspect(client, { customInspect: false, showHidden: true, depth: Infinity }),
    inspect(client.emails, { showHidden: true, depth: Infinity }),
    inspect(client.contacts, { customInspect: false, showHidden: true, depth: Infinity }),
    inspect(client.webhooks, { customInspect: false, showHidden: true, depth: Infinity }),
    JSON.stringify(client),
    JSON.stringify(client.emails),
    String(client),
    Object.keys(client).join(","),
  ]
  for (const [i, view] of views.entries()) {
    it(`is not in view ${i + 1}`, () => {
      assert.ok(!view.includes(KEY), view)
      assert.ok(!view.includes("c2VjcmV0"), view)
    })
  }
})

describe("package", () => {
  it("VERSION matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
    assert.equal(VERSION, pkg.version)
  })

  it("has no runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
    assert.deepEqual(pkg.dependencies ?? {}, {})
    assert.deepEqual(pkg.peerDependencies ?? {}, {})
    assert.deepEqual(pkg.optionalDependencies ?? {}, {})
    for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
      assert.equal(pkg.scripts?.[hook], undefined, `${hook} script must not exist`)
    }
  })
})
