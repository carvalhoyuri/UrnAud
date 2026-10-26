import { useEffect, useState } from 'react'
import { Hint } from '@/components/Hint'
import { Slider } from '@/components/ui/slider'
import { useApi, useMeta } from '@/lib/api'
import { setFilters, type Filters, type Range } from '@/lib/filters'

interface Props {
  field: string
  label: string
  hint?: string
  f: Filters
  fmt: (v: number) => string
  step?: number
  bins?: number
}
interface Hist { min: number; max: number; bins: number; counts: number[] }

/** Slider de intervalo com histograma embutido (o histograma ignora o próprio filtro, mas respeita os demais). */
export function RangeHist({ field, label, hint, f, fmt, step = 1, bins = 32 }: Props) {
  const meta = useMeta().data
  const rng = meta?.ranges[field]
  const { data } = useApi<Hist>(`histogram/${field}`, f, { bins }, !!rng)
  const lo = rng?.[0] ?? 0, hi = rng?.[1] ?? 1
  const cur: Range = f.r[field] ?? [null, null]
  const shown: [number, number] = [cur[0] ?? lo, cur[1] ?? hi]
  const [drag, setDrag] = useState<[number, number] | null>(null)
  useEffect(() => setDrag(null), [cur[0], cur[1]])
  const v = drag ?? shown
  const max = Math.max(1, ...(data?.counts ?? [1]))

  const commit = (a: number, b: number) => {
    const r = { ...f.r }
    if (a <= lo && b >= hi) delete r[field]
    else r[field] = [a <= lo ? null : a, b >= hi ? null : b]
    setFilters({ r })
  }
  if (!rng) return null
  const active = !!f.r[field]
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 font-medium">{label}{hint && <Hint text={hint} />}</span>
        <span className="tabular-nums text-muted-foreground">
          {active ? `${fmt(v[0])} – ${fmt(v[1])}` : 'todos'}
        </span>
      </div>
      <div className="relative">
        <div className="flex h-9 items-end gap-px" aria-hidden>
          {(data?.counts ?? Array.from({ length: bins }, () => 0)).map((c, i, a) => {
            const x = lo + ((i + 0.5) / a.length) * (hi - lo)
            const inside = x >= v[0] && x <= v[1]
            return <div key={i} className={`flex-1 rounded-t-[1px] ${inside ? 'bg-foreground/55' : 'bg-foreground/15'}`} style={{ height: `${Math.max(2, (c / max) * 100)}%` }} />
          })}
        </div>
        <Slider
          aria-label={label}
          min={lo}
          max={hi}
          step={step}
          value={v}
          onValueChange={(x) => Array.isArray(x) && setDrag([x[0], x[1]])}
          onValueCommitted={(x) => Array.isArray(x) && commit(x[0], x[1])}
          className="mt-1"
        />
      </div>
    </div>
  )
}
