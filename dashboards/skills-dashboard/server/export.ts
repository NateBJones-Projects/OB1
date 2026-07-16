import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanAll } from './scanner.ts'
import type { MatrixPayload } from './types.ts'

/**
 * Bake a SANITIZED snapshot for static (Vercel) deploys: absolute local paths
 * are reduced to home-relative form, and the payload is marked non-live
 * (llmAvailable=false) since a static host can neither scan nor enrich.
 */
function sanitize(payload: MatrixPayload): MatrixPayload {
  const home = os.homedir()
  const relativize = (p: string) => (p.startsWith(home) ? `~${p.slice(home.length)}` : path.basename(p))
  return {
    ...payload,
    llmAvailable: false,
    rows: payload.rows.map((row) => ({
      ...row,
      installs: Object.fromEntries(
        Object.entries(row.installs).map(([harness, details]) => [
          harness,
          details.map((d) => ({
            ...d,
            sourcePath: relativize(d.sourcePath),
            dirPath: relativize(d.dirPath),
          })),
        ]),
      ),
    })),
  }
}

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'skills.json')
mkdirSync(path.dirname(outPath), { recursive: true })
const snapshot = sanitize(scanAll().payload)
writeFileSync(outPath, JSON.stringify(snapshot, null, 2))
console.log(`wrote ${outPath} — ${snapshot.rows.length} rows, scanned ${snapshot.scannedAt}`)
