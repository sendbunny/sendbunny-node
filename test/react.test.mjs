// React Email support, with a stand-in renderer installed next to a copy of
// the built package, as in an app that ran `npm install @react-email/render`.
import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"
import { pathToFileURL } from "node:url"
import { KEY, URL_, fakeFetch, json } from "./helpers.mjs"

const root = new URL("..", import.meta.url).pathname
let app
let esm
let cjs

// Plain text is "TEXT:" plus the name; HTML wraps it. A component named "Broken" fails.
const RENDERER = `
function body(el) {
  if (el.props && el.props.name === "Broken") throw new Error("Broken is not a component")
  return "<p>Hi " + el.props.name + "</p>"
}
async function render(el, options) {
  const html = body(el)
  return options && options.plainText ? "TEXT:" + el.props.name : html
}
function toPlainText(html) { return "TEXT:" + html.replace(/<[^>]+>/g, "") }
`

before(() => {
  app = mkdtempSync(join(tmpdir(), "sendbunny-react-"))
  const pkg = join(app, "node_modules", "sendbunny")
  mkdirSync(pkg, { recursive: true })
  cpSync(join(root, "dist"), join(pkg, "dist"), { recursive: true })
  cpSync(join(root, "package.json"), join(pkg, "package.json"))
  const renderer = join(app, "node_modules", "@react-email", "render")
  mkdirSync(renderer, { recursive: true })
  writeFileSync(
    join(renderer, "package.json"),
    JSON.stringify({ name: "@react-email/render", version: "0.0.0-test", exports: { import: "./index.mjs", require: "./index.cjs" } }),
  )
  writeFileSync(join(renderer, "index.mjs"), `${RENDERER}\nexport { render, toPlainText }\n`)
  writeFileSync(join(renderer, "index.cjs"), `${RENDERER}\nmodule.exports = { render, toPlainText }\n`)
})

after(() => rmSync(app, { recursive: true, force: true }))

const element = (name) => ({ type: () => null, props: { name }, key: null })

for (const kind of ["import", "require"]) {
  describe(`react, through ${kind}`, () => {
    before(async () => {
      const entry = join(app, "node_modules", "sendbunny")
      if (kind === "import") esm = await import(pathToFileURL(join(entry, "dist", "esm", "index.js")).href)
      else cjs = createRequire(join(app, "index.js"))("sendbunny")
    })

    const sdk = () => (kind === "import" ? esm : cjs)

    it("sends the rendered HTML and a text version", async () => {
      const f = fakeFetch(() => json(200, { id: "em_1", messageId: "m1" }))
      const sb = new (sdk().SendBunny)({ url: URL_, apiKey: KEY, fetch: f.fetch })
      const { data, error } = await sb.emails.send({ from: "a@acme.test", to: "b@example.com", subject: "Welcome", react: element("Ana") })
      assert.equal(error, null)
      assert.equal(data.id, "em_1")
      assert.deepEqual(f.calls[0].body, { from: "a@acme.test", to: ["b@example.com"], subject: "Welcome", html: "<p>Hi Ana</p>", text: "TEXT:Hi Ana" })
    })

    it("keeps your own text version", async () => {
      const f = fakeFetch(() => json(200, { id: "em_2", messageId: "m2" }))
      const sb = new (sdk().SendBunny)({ url: URL_, apiKey: KEY, fetch: f.fetch })
      await sb.emails.send({ from: "a@acme.test", to: "b@example.com", subject: "Welcome", react: element("Ana"), text: "Hello Ana" })
      assert.equal(f.calls[0].body.text, "Hello Ana")
      assert.equal(f.calls[0].body.html, "<p>Hi Ana</p>")
    })

    it("refuses react with html, and reports a component that fails", async () => {
      const f = fakeFetch()
      const sb = new (sdk().SendBunny)({ url: URL_, apiKey: KEY, fetch: f.fetch })
      const both = await sb.emails.send({ from: "a@acme.test", to: "b@example.com", subject: "x", react: element("Ana"), html: "<p>x</p>" })
      assert.equal(both.error.code, "validation_error")
      const broken = await sb.emails.send({ from: "a@acme.test", to: "b@example.com", subject: "x", react: element("Broken") })
      assert.equal(broken.error.code, "render_error")
      assert.match(broken.error.message, /Broken is not a component/)
      assert.equal(f.calls.length, 0)
    })
  })
}
