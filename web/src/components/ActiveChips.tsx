import { X } from 'lucide-react'
import { labelCache } from '@/components/FacetList'
import { useMeta } from '@/lib/api'
import { nameOf } from '@/lib/candidates'
import { clearAll, hasFilters, setFilters, type Filters } from '@/lib/filters'
import { fmtClock, fmtDur, fmtInt, fmtNum } from '@/lib/format'

const RANGE_LABEL: Record<string, [string, (v: number) => string]> = {
  abertura: ['Abertura', fmtClock], encerramento: ['Encerramento', fmtClock], duracao: ['Duração', fmtDur], bu: ['BU recebido', fmtClock],
  aptos: ['Aptos', fmtInt], comp_pct: ['Comparecimento', (v) => fmtNum(v, 0) + '%'], abst_pct: ['Abstenção', (v) => fmtNum(v, 0) + '%'],
  bn_pct: ['Brancos+nulos', (v) => fmtNum(v, 0) + '%'], biom_pct: ['Biometria s/ hab.', (v) => fmtNum(v, 0) + '%'], margem: ['Margem', (v) => fmtNum(v, 0) + ' p.p.'],
  atraso: ['Atraso 17h', fmtDur], transmissao: ['Transmissão', fmtDur], brancos_pct: ['Brancos', (v) => fmtNum(v, 0) + '%'], nulos_pct: ['Nulos', (v) => fmtNum(v, 0) + '%'],
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-muted/60 py-0.5 pl-2.5 pr-1 text-xs">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remover filtro ${label}`}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <X className="size-3" aria-hidden />
      </button>
    </span>
  )
}

export function ActiveChips({ f }: { f: Filters }) {
  const meta = useMeta().data
  if (!hasFilters(f)) return null
  const chips: { key: string; label: string; remove: () => void }[] = []
  f.uf.forEach((u) => chips.push({ key: 'uf' + u, label: u, remove: () => setFilters({ uf: f.uf.filter((x) => x !== u) }) }))
  f.mun.forEach((m) => chips.push({ key: 'm' + m, label: labelCache.get(`mun:${m}`) ?? `Município ${m}`, remove: () => setFilters({ mun: f.mun.filter((x) => x !== m) }) }))
  f.zona.forEach((z) => chips.push({ key: 'z' + z, label: `Zona ${z}`, remove: () => setFilters({ zona: f.zona.filter((x) => x !== z) }) }))
  f.local.forEach((l) => chips.push({ key: 'l' + l, label: labelCache.get(`local:${l}`) ?? 'Local de votação', remove: () => setFilters({ local: f.local.filter((x) => x !== l) }) }))
  f.secao.forEach((s) => chips.push({ key: 's' + s, label: `Seção ${s}`, remove: () => setFilters({ secao: f.secao.filter((x) => x !== s) }) }))
  f.venc.forEach((v) => chips.push({ key: 'v' + v, label: `Venceu: ${nameOf(meta, f.cargo, f.uf[0] ?? '', v)}`, remove: () => setFilters({ venc: f.venc.filter((x) => x !== v) }) }))
  f.tipo_urna.forEach((t) => chips.push({ key: 't' + t, label: `Urna ${t}`, remove: () => setFilters({ tipo_urna: f.tipo_urna.filter((x) => x !== t) }) }))
  if (f.agregada) chips.push({ key: 'ag', label: f.agregada === '1' ? 'Com agregadas' : 'Sem agregadas', remove: () => setFilters({ agregada: '' }) })
  if (f.depois17) chips.push({ key: 'd17', label: 'Encerrou >10 min após 17h', remove: () => setFilters({ depois17: false }) })
  if (f.q) chips.push({ key: 'q', label: `Busca: ${f.q}`, remove: () => setFilters({ q: '' }) })
  for (const [k, [a, b]] of Object.entries(f.r)) {
    const [name, fmt] = RANGE_LABEL[k] ?? [k, String]
    const txt = a != null && b != null ? `${fmt(a)} – ${fmt(b)}` : a != null ? `≥ ${fmt(a)}` : `≤ ${fmt(b!)}`
    chips.push({ key: 'r' + k, label: `${name}: ${txt}`, remove: () => { const r = { ...f.r }; delete r[k]; setFilters({ r }) } })
  }
  for (const [k, [a, b]] of Object.entries(f.cand)) {
    const nr = Number(k)
    const txt = a != null && b != null ? `${fmtNum(a, 0)}–${fmtNum(b, 0)}%` : a != null ? `≥ ${fmtNum(a, 0)}%` : `≤ ${fmtNum(b!, 0)}%`
    chips.push({ key: 'c' + k, label: `${nameOf(meta, f.cargo, f.uf[0] ?? '', nr)}: ${txt}`, remove: () => { const c = { ...f.cand }; delete c[nr]; setFilters({ cand: c }) } })
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtros ativos">
      {chips.map((c) => <Chip key={c.key} label={c.label} onRemove={c.remove} />)}
      <button type="button" onClick={clearAll} className="rounded px-2 py-0.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring">
        Limpar tudo
      </button>
    </div>
  )
}
