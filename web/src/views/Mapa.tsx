import { ArrowLeft } from 'lucide-react'
import { lazy, Suspense, useMemo } from 'react'
import { Hint } from '@/components/Hint'
import { Skeleton } from '@/components/ui/skeleton'
import { useApi, useMeta, type Summary } from '@/lib/api'
import { colorOf, nameOf } from '@/lib/candidates'
import { setExtra, setFilters, useUrl, type Filters } from '@/lib/filters'
import { fmtDur, fmtInt, fmtPct } from '@/lib/format'
import type { MapPoint } from './MapCanvas'

const MapCanvas = lazy(() => import('./MapCanvas'))

interface Row {
  k: string | number; secoes: number; aptos: number; comparecimento: number; abstencoes: number; brancos: number; nulos: number
  validos: number; atraso_medio: number | null; duracao_media: number | null; votos: Record<string, number>
}
type Metric = 'vencedor' | 'margem' | 'pct' | 'abst' | 'atraso'
const METRICS: { id: Metric; label: string; hint: string }[] = [
  { id: 'vencedor', label: 'Vencedor', hint: 'Candidato mais votado em cada região (cada candidato com sua cor fixa).' },
  { id: 'margem', label: 'Margem A × B', hint: '% de A nos votos de A + B. Escala divergente centrada em 50%: mesma intensidade para os dois lados.' },
  { id: 'pct', label: '% de um candidato', hint: '% do candidato escolhido sobre os votos válidos.' },
  { id: 'abst', label: 'Abstenção', hint: 'Abstenções ÷ eleitores aptos.' },
  { id: 'atraso', label: 'Horário médio de encerramento', hint: 'Atraso médio, em minutos, em relação às 17h de Brasília.' },
]

const lerp = (a: number[], b: number[], t: number) => a.map((x, i) => Math.round(x + (b[i] - x) * t))
const hex = (c: number[]) => '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('')
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const WHITE = [245, 245, 245]
const seq = (t: number, base: string) => hex(lerp(WHITE, rgb(base), Math.min(1, Math.max(0, t))))
const div = (t: number, a: string, b: string) => (t >= 0.5 ? hex(lerp(WHITE, rgb(a), Math.min(1, (t - 0.5) * 2))) : hex(lerp(WHITE, rgb(b), Math.min(1, (0.5 - t) * 2))))

export function Mapa({ f }: { f: Filters }) {
  const meta = useMeta().data
  const { ex } = useUrl()
  const sum = useApi<Summary>('summary', f).data
  const metric = (ex.mm as Metric) || 'vencedor'
  const single = f.uf.length === 1 && f.uf[0] !== 'ZZ'
  const level = single ? 'mun' : 'uf'
  const rows = useApi<Row[]>(`map/${level}`, f)
  const topNr = (sum?.votos ?? []).slice(0, 2).map((v) => v.nr).sort((a, b) => a - b)
  const A = Number(ex.ma) || topNr[0] || 13
  const B = Number(ex.mb) || topNr[1] || 22
  const C = Number(ex.mc) || topNr[0] || 13
  const escopo = f.cargo === 1 ? 'BR' : f.uf[0] ?? ''
  const cands = (sum?.votos ?? []).filter((v) => f.cargo === 1 || v.escopo === escopo).slice(0, 15)
  const nm = (nr: number) => nameOf(meta, f.cargo, escopo, nr)

  const fills = useMemo(() => {
    const m = new Map<string | number, { color: string; tip: string; title?: string }>()
    const ufName = (k: string) => meta?.ufs.find((u) => u.uf === k)?.nome ?? k
    for (const r of rows.data ?? []) {
      const entries = Object.entries(r.votos).map(([nr, qt]) => [Number(nr), qt] as const).sort((a, b) => b[1] - a[1])
      const win = entries[0]
      const vv = r.validos || 1
      let color = '#d4d4d8', line = ''
      if (metric === 'vencedor' && win) { color = colorOf(win[0]); line = `${nm(win[0])} · ${fmtPct((100 * win[1]) / vv, 1)}` }
      else if (metric === 'margem') {
        const a = r.votos[A] ?? 0, b = r.votos[B] ?? 0
        if (a + b > 0) { const p = a / (a + b); color = div((p - 0.3) / 0.4, colorOf(A), colorOf(B)); line = `${nm(A)} ${fmtPct(100 * p, 1)} × ${nm(B)} ${fmtPct(100 * (1 - p), 1)}` }
      } else if (metric === 'pct') { const p = (r.votos[C] ?? 0) / vv; color = seq(p / 0.8, colorOf(C)); line = `${nm(C)}: ${fmtPct(100 * p, 1)}` }
      else if (metric === 'abst') { const p = r.abstencoes / (r.aptos || 1); color = seq((p - 0.1) / 0.3, '#52525b'); line = `Abstenção ${fmtPct(100 * p, 1)}` }
      else if (metric === 'atraso') { const x = r.atraso_medio ?? 0; color = seq(x / 60, '#7c3aed'); line = `Encerramento médio: ${x >= 0 ? '+' : ''}${fmtDur(x)} vs. 17h` }
      m.set(r.k, { color, title: level === 'uf' ? ufName(String(r.k)) : undefined, tip: `${line}<br/><span style="color:#555">${fmtInt(r.secoes)} seções · ${fmtInt(r.aptos)} aptos</span>` })
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.data, metric, A, B, C, meta, level])

  const pts = useApi<unknown[][]>('points', f, {}, f.uf.length > 0 || f.mun.length > 0)
  const points: MapPoint[] | null = f.uf.length || f.mun.length
    ? (pts.data ?? []).map((p) => ({ lon: p[0] as number, lat: p[1] as number, nome: p[2] as string, uf: p[3] as string, mun: p[4] as number, local: `${p[3]}.${p[4]}.${p[5]}.${p[6]}`, secoes: p[7] as number, aptos: p[8] as number, color: p[9] ? colorOf(p[9] as number) : '#71717a' }))
    : null

  const geoUrl = single ? `/geo/mun/${f.uf[0]}.json` : '/geo/uf.json'
  const selected = single ? f.mun : f.uf
  const onFeature = (k: string | number) => {
    if (level === 'uf') setFilters({ uf: [String(k)], mun: [], zona: [], local: [] })
    else setFilters({ mun: f.mun.includes(Number(k)) ? [] : [Number(k)], zona: [], local: [] })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label="Métrica do mapa">
          {METRICS.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={metric === m.id} onClick={() => setExtra({ mm: m.id })} title={m.hint}
              className={`rounded-md px-2.5 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring ${metric === m.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{m.label}</button>
          ))}
        </div>
        <Hint text={METRICS.find((m) => m.id === metric)!.hint} />
        {metric === 'margem' && (
          <span className="flex items-center gap-1 text-xs">
            <CandSelect value={A} onChange={(n) => setExtra({ ma: String(n) })} cands={cands} nm={nm} /> ×
            <CandSelect value={B} onChange={(n) => setExtra({ mb: String(n) })} cands={cands} nm={nm} />
          </span>
        )}
        {metric === 'pct' && <CandSelect value={C} onChange={(n) => setExtra({ mc: String(n) })} cands={cands} nm={nm} />}
        {f.uf.length > 0 && (
          <button type="button" onClick={() => setFilters({ uf: [], mun: [], zona: [], local: [] })}
            className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><ArrowLeft className="size-3.5" aria-hidden />Brasil</button>
        )}
      </div>
      <div className="relative h-[calc(100vh-15rem)] min-h-[420px] overflow-hidden rounded-xl border bg-card">
        <Suspense fallback={<Skeleton className="size-full" />}>
          <MapCanvas geoUrl={geoUrl} fills={fills} keyProp={level === 'uf' ? 'uf' : 'cd'} selected={selected} points={points} label={`Mapa coroplético por ${level === 'uf' ? 'UF' : 'município'}`}
            onFeature={onFeature} onPoint={(p) => setFilters({ uf: [p.uf], mun: [Number(p.mun)], local: [p.local] })} />
        </Suspense>
        <Legend metric={metric} A={A} B={B} C={C} nm={nm} cands={cands.slice(0, 8)} />
        {rows.isFetching && <div className="absolute left-3 top-3 rounded bg-background/90 px-2 py-1 text-xs shadow">Atualizando…</div>}
        <p className="pointer-events-none absolute bottom-1 left-3 text-[11px] text-muted-foreground">
          {level === 'uf' ? 'Clique em uma UF para ver os municípios.' : 'Clique em um município; aproxime para ver os locais de votação.'} O exterior não aparece no mapa.
        </p>
      </div>
    </div>
  )
}

function CandSelect({ value, onChange, cands, nm }: { value: number; onChange: (n: number) => void; cands: { nr: number }[]; nm: (n: number) => string }) {
  return (
    <select aria-label="Candidato" value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-7 rounded-md border bg-background px-1.5 text-xs">
      {[...cands].sort((a, b) => a.nr - b.nr).map((c) => <option key={c.nr} value={c.nr}>{nm(c.nr)} ({c.nr})</option>)}
    </select>
  )
}

function Legend({ metric, A, B, C, nm, cands }: { metric: Metric; A: number; B: number; C: number; nm: (n: number) => string; cands: { nr: number }[] }) {
  const grad = (stops: string[]) => `linear-gradient(90deg, ${stops.join(',')})`
  let body
  if (metric === 'vencedor') {
    body = <ul className="space-y-1">{cands.map((c) => <li key={c.nr} className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm" style={{ background: colorOf(c.nr) }} />{nm(c.nr)}</li>)}</ul>
  } else if (metric === 'margem') {
    body = (<><div className="h-2.5 w-44 rounded" style={{ background: grad([colorOf(B), '#f5f5f5', colorOf(A)]) }} />
      <div className="mt-0.5 flex w-44 justify-between tabular-nums"><span>{nm(B)} 70%</span><span>50%</span><span>{nm(A)} 70%</span></div></>)
  } else {
    const base = metric === 'pct' ? colorOf(C) : metric === 'abst' ? '#52525b' : '#7c3aed'
    const [lo, hi] = metric === 'pct' ? ['0%', '80%'] : metric === 'abst' ? ['10%', '40%'] : ['17h', '+60 min']
    body = (<><div className="h-2.5 w-44 rounded" style={{ background: grad(['#f5f5f5', base]) }} />
      <div className="mt-0.5 flex w-44 justify-between tabular-nums"><span>{lo}</span><span>{hi}</span></div>{metric === 'pct' && <div>{nm(C)}</div>}</>)
  }
  return <div className="absolute bottom-6 left-3 max-w-60 rounded-lg border bg-background/95 p-2.5 text-[11px] shadow-sm" aria-label="Legenda">{body}</div>
}
