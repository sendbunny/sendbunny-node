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

  it("instanceof SendBunnyError works across the require and import copies", async () => {
    const cjs = require("sendbunny")
    const esm = await import("sendbunny")
    assert.notEqual(cjs.SendBunnyError, esm.SendBunnyError, "two copies are loaded")
    for (const [from, to] of [[cjs, esm], [esm, cjs]]) {
      assert.throws(() => new from.SendBunny({ url: "", apiKey: "" }), (e) => e instanceof to.SendBunnyError && e instanceof Error && e.code === "config")
    }
    assert.ok(!(new Error("x") instanceof esm.SendBunnyError))
    assert.ok(!({ code: "config" } instanceof esm.SendBunnyError))
  })
})
