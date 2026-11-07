// The parts of React Email (an optional add-on) this SDK uses. Only for
// building this package: neither is installed with it.
declare module "@react-email/render" {
  export function render(node: unknown, options?: { plainText?: boolean; pretty?: boolean }): Promise<string> | string
  export function toPlainText(html: string): string
}

declare module "react-email" {
  export function render(node: unknown, options?: { plainText?: boolean; pretty?: boolean }): Promise<string> | string
  export function toPlainText(html: string): string
}
