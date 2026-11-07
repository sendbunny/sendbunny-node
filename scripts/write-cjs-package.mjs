// dist/cjs holds CommonJS files inside a "type": "module" package. This
// marker tells Node (and TypeScript) to read that folder as CommonJS.
import { writeFileSync } from "node:fs"

writeFileSync(new URL("../dist/cjs/package.json", import.meta.url), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`)
