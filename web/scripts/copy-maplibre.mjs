// O MapLibre 6 carrega o worker como módulo separado; copiamos para public/ e apontamos com setWorkerUrl.
import { cpSync, mkdirSync } from 'node:fs'

mkdirSync('public/maplibre', { recursive: true })
for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  cpSync(`node_modules/maplibre-gl/dist/${f}`, `public/maplibre/${f}`)
}
