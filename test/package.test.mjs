// The package works for both module systems, through its published entry points.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { describe, it } from "node:test"

const require = createRequire(import.meta.url)

describe("entry points", () => {
  it("import works", async () => {
    const mod = await import("sendbunny")
    assert.equal(typeof mod.SendBunny, "function")
    assert.equal(typeof mod.verifyWebhook, "function")
    assert.equal(typeof mod.SendBunnyError, "function")
  })

  it("require works", () => {
    const mod = require("sendbunny")
    assert.equal(typeof mod.SendBunny, "function")
    assert.equal(typeof mod.verifyWebhook, "function")
    assert.equal(typeof mod.SendBunnyError, "function")
  })

  it("errors from require and import are the same kind of thing", async () => {
    const { SendBunny, SendBunnyError } = require("sendbunny")
    assert.throws(() => new SendBunny({ url: "", apiKey: "" }), (e) => e instanceof SendBunnyError && e.code === "config")
  })
})
