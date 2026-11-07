/** @internal Where this code runs, read defensively: no runtime is assumed. */

type EnvSource = {
  process?: { env?: Record<string, string | undefined> }
  Deno?: { env?: { get(name: string): string | undefined } }
  window?: unknown
  document?: unknown
}

const g = globalThis as unknown as EnvSource

/**
 * An environment variable, where the runtime has them (Node, Bun, Deno with
 * env access). Never throws: Deno without `--allow-env` and runtimes with no
 * environment (Cloudflare Workers) simply give `undefined`.
 */
export function readEnv(name: string): string | undefined {
  try {
    const value = g.process?.env?.[name]
    if (typeof value === "string") return value
  } catch {
    // No access to process.env here.
  }
  try {
    const value = g.Deno?.env?.get(name)
    if (typeof value === "string") return value
  } catch {
    // Deno without env permission.
  }
  return undefined
}

/**
 * True in a web page. An API key in page code is readable by every visitor,
 * so the client refuses to start there.
 */
export function isBrowser(): boolean {
  return typeof g.window !== "undefined" && typeof g.document !== "undefined"
}
