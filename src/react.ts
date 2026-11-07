// Turns a React Email element into the email's HTML and text.
import { SendBunnyError } from "./errors.js"

/**
 * A React element, such as `<WelcomeEmail name="Ana" />`. Described by
 * shape so this package does not need React's types.
 */
export interface ReactEmailElement {
  type: unknown
  props: unknown
  key: unknown
}

export function isReactElement(value: unknown): value is ReactEmailElement {
  return typeof value === "object" && value !== null && "type" in value && "props" in value
}

interface Renderer {
  render(node: unknown, options?: { plainText?: boolean }): Promise<string> | string
  toPlainText?(html: string): string
}

/**
 * React Email's renderer, from the app's own install: `@react-email/render`,
 * or `react-email`, which includes it. Nothing is loaded unless an email uses
 * `react`. The imports stay real import() calls for bundlers, so the app's
 * own copy is used.
 */
async function loadRenderer(): Promise<Renderer> {
  try {
    return await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "@react-email/render")
  } catch (first) {
    try {
      const all: Partial<Renderer> = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "react-email")
      if (typeof all.render === "function") return all as Renderer
    } catch {
      // Not installed either: explained below.
    }
    throw new SendBunnyError("To send a React email, add React Email to your app: npm install react-email", {
      code: "config",
      cause: first,
    })
  }
}

export async function renderReactEmail(element: ReactEmailElement): Promise<{ html: string; text: string }> {
  const renderer = await loadRenderer()
  try {
    const html = await renderer.render(element)
    const text = typeof renderer.toPlainText === "function" ? renderer.toPlainText(html) : await renderer.render(element, { plainText: true })
    return { html, text }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new SendBunnyError(`Your React email could not be turned into HTML: ${detail}`, { code: "render_error", cause })
  }
}
