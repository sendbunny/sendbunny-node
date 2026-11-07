// The package works for both module systems, through its published entry points.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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

describe("release setup", () => {
  it("CI checks the package with the same npm the release uses", () => {
    const read = (file) => readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8")
    const pinned = (text) => [...text.matchAll(/npm@(\d+\.\d+\.\d+)/g)].map((m) => m[1])
    const release = pinned(read("release.yml"))
    assert.equal(release.length, 1, "release.yml installs one pinned npm")
    assert.deepEqual(pinned(read("ci.yml")), release, "ci.yml must install the npm that release.yml uses")
  })
})
