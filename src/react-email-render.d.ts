// The part of React Email's renderer (an optional add-on) this SDK uses.
// Only for building this package: it is not installed with it.
declare module "@react-email/render" {
  export function render(node: unknown, options?: { plainText?: boolean; pretty?: boolean }): Promise<string> | string
  export function toPlainText(html: string): string
}
