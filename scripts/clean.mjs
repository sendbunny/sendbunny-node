// Removes the build output so a stale file can never be published.
import { rmSync } from "node:fs"

rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true })
