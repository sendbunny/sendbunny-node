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

/**
 * Renders with `@react-email/render`, which the app installs only if it uses
 * React Email; nothing is loaded otherwise.
 */
export async function renderReactEmail(element: ReactEmailElement): Promise<{ html: string; text: string }> {
  let renderer: typeof import("@react-email/render")
  try {
    // Left as a real import() for bundlers, so the app's own copy is used.
    renderer = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "@react-email/render")
  } catch (cause) {
    throw new SendBunnyError(
      "To send a React email, install React Email's renderer in your app: npm install @react-email/render",
      { code: "config", cause },
    )
  }
  try {
    const html = await renderer.render(element)
    const text = typeof renderer.toPlainText === "function" ? renderer.toPlainText(html) : await renderer.render(element, { plainText: true })
    return { html, text }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new SendBunnyError(`Your React email could not be turned into HTML: ${detail}`, { code: "render_error", cause })
  }
}
