// Checks what `npm publish` would upload: only the built files, nothing that
// looks like a secret, and a sane size. Runs in CI and before every release.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const MAX_UNPACKED_BYTES = 150_000
const ALWAYS = new Set(["package.json", "README.md", "LICENSE"])
const BUILT = /^dist\/(esm|cjs)\/[a-z-]+\.(js|d\.ts)$/
const CJS_MARKER = "dist/cjs/package.json"
const SECRET_LIKE = [
  { name: "a SendBunny API key", pattern: /\bsb[A-Za-z0-9]{40}\b/ },
  { name: "a webhook secret", pattern: /whsec_[A-Za-z0-9+/]{30,}/ },
  { name: "a private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "an npm token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: "a GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "an AWS access key", pattern: /\bA(KIA|SIA)[A-Z0-9]{16}\b/ },
]

const npm = process.platform === "win32" ? "npm.cmd" : "npm"
// npm 10 and 11 print a list holding one report; npm 12 prints an object keyed
// by package name. The release runs npm 12, so both must work.
const packed = JSON.parse(execFileSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" }))
const report = Array.isArray(packed) ? packed[0] : Object.values(packed ?? {})[0]
if (!report || !Array.isArray(report.files)) {
  console.error("Package check failed: could not read the output of `npm pack --json`. Its format may have changed: update scripts/check-pack.mjs.")
  process.exit(1)
}
const problems = []

for (const { path } of report.files) {
  if (ALWAYS.has(path) || path === CJS_MARKER || BUILT.test(path)) continue
  problems.push(`unexpected file in the package: ${path}`)
}
for (const required of ["package.json", "README.md", "LICENSE", "dist/esm/index.js", "dist/esm/index.d.ts", "dist/cjs/index.js", "dist/cjs/index.d.ts", CJS_MARKER]) {
  if (!report.files.some((f) => f.path === required)) problems.push(`missing from the package: ${required}`)
}
for (const { path } of report.files) {
  const text = readFileSync(path, "utf8")
  for (const { name, pattern } of SECRET_LIKE) {
    if (pattern.test(text)) problems.push(`${path} contains something that looks like ${name}`)
  }
}
if (report.unpackedSize > MAX_UNPACKED_BYTES) {
  problems.push(`package is ${report.unpackedSize} bytes unpacked, over the ${MAX_UNPACKED_BYTES} budget`)
}

if (problems.length) {
  console.error(`Package check failed:\n- ${problems.join("\n- ")}`)
  process.exit(1)
}
console.log(`Package check passed: ${report.files.length} files, ${report.unpackedSize} bytes unpacked, ${report.name}@${report.version}.`)
