import { useQueries } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, Columns3, Download } from 'lucide-react'
import { useMemo, useRef, type ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { getJson, qs, useApi, useMeta, type Summary } from '@/lib/api'
import { colorOf, nameOf } from '@/lib/candidates'
import { setDetail, setExtra, useUrl, type Filters } from '@/lib/filters'
import { fmtDur, fmtInt, fmtNum, fmtPct, fmtTime } from '@/lib/format'
import { useLocalStorage, useMedia } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { EmptyState, ErrorState } from './Overview'

const PAGE = 200
interface Row {
  uf: string; municipio: string; zona: number; secao: number; local: string | null; endereco: string | null; bairro: string | null
  abertura: string | null; encerramento: string | null; bu_recebido: string | null; duracao_min: number | null; atraso: number | null
  transmissao: number | null; aptos: number; comparecimento: number; abst_pct: number | null; brancos: number; nulos: number; bn_pct: number | null
  tipo_urna: string; n_agregadas: number; venc: number | null; margem: number | null; [k: string]: unknown
}
interface Page { total: number; offset: number; rows: Row[] }

interface Col { id: string; label: string; w: number; sort?: string; right?: boolean; cell: (r: Row) => ReactNode; def?: boolean }

const COLS: Col[] = [
  { id: 'uf', label: 'UF', w: 48, sort: 'uf', cell: (r) => r.uf, def: true },
  { id: 'municipio', label: 'Município', w: 160, sort: 'municipio', cell: (r) => r.municipio, def: true },
  { id: 'zona', label: 'Zona', w: 56, sort: 'zona', right: true, cell: (r) => r.zona, def: true },
  { id: 'secao', label: 'Seção', w: 64, sort: 'secao', right: true, cell: (r) => r.secao, def: true },
  { id: 'local', label: 'Local de votação', w: 240, sort: 'local', cell: (r) => r.local ?? '—', def: true },
  { id: 'endereco', label: 'Endereço', w: 240, cell: (r) => [r.endereco, r.bairro].filter(Boolean).join(' · ') || '—' },
  { id: 'abertura', label: 'Abertura', w: 72, sort: 'abertura', right: true, cell: (r) => fmtTime(r.abertura), def: true },
  { id: 'encerramento', label: 'Encerr.', w: 72, sort: 'encerramento', right: true, cell: (r) => fmtTime(r.encerramento), def: true },
  { id: 'duracao', label: 'Duração', w: 80, sort: 'duracao', right: true, cell: (r) => fmtDur(r.duracao_min) },
  { id: 'atraso', label: 'Atraso 17h', w: 84, sort: 'atraso', right: true, cell: (r) => (r.atraso == null ? '—' : r.atraso > 0 ? `+${fmtDur(r.atraso)}` : '—'), def: true },
  { id: 'bu', label: 'BU recebido', w: 88, sort: 'bu', right: true, cell: (r) => fmtTime(r.bu_recebido) },
  { id: 'transmissao', label: 'Transm.', w: 80, sort: 'transmissao', right: true, cell: (r) => fmtDur(r.transmissao) },
  { id: 'aptos', label: 'Aptos', w: 72, sort: 'aptos', right: true, cell: (r) => fmtInt(r.aptos), def: true },
  { id: 'comparecimento', label: 'Compar.', w: 76, sort: 'comparecimento', right: true, cell: (r) => fmtInt(r.comparecimento), def: true },
  { id: 'abst_pct', label: 'Abst. %', w: 70, sort: 'abst_pct', right: true, cell: (r) => fmtPct(r.abst_pct, 1), def: true },
  { id: 'bn_pct', label: 'Br+Nul %', w: 78, sort: 'bn_pct', right: true, cell: (r) => fmtPct(r.bn_pct, 1) },
  { id: 'brancos', label: 'Brancos', w: 70, sort: 'brancos', right: true, cell: (r) => fmtInt(r.brancos) },
  { id: 'nulos', label: 'Nulos', w: 64, sort: 'nulos', right: true, cell: (r) => fmtInt(r.nulos) },
  { id: 'tipo_urna', label: 'Urna', w: 80, cell: (r) => r.tipo_urna },
  { id: 'agregadas', label: 'Agreg.', w: 60, right: true, cell: (r) => (r.n_agregadas ? r.n_agregadas : '—') },
  { id: 'margem', label: 'Margem p.p.', w: 92, sort: 'margem', right: true, cell: (r) => fmtNum(r.margem, 1) },
]

export function Secoes({ f }: { f: Filters }) {
  const meta = useMeta().data
  const { ex } = useUrl()
  const sort = ex.sort ?? 'uf'
  const dir = ex.dir === 'desc' ? 'desc' : 'asc'
  const mobile = useMedia('(max-width: 767px)')
  const sum = useApi<Summary>('summary', f).data
  const topCands = (sum?.votos ?? []).slice(0, f.cargo === 1 ? 4 : 3)
  const cIds = topCands.map((c) => c.nr).join(',')
  const [vis, setVis] = useLocalStorage<string[]>('cols', COLS.filter((c) => c.def).map((c) => c.id))
  const cols = COLS.filter((c) => vis.includes(c.id))
  const gridCols = [...cols.map((c) => c.w), ...topCands.map(() => 92)].map((w) => `${w}px`).join(' ')
  const totalW = cols.reduce((a, c) => a + c.w, 0) + topCands.length * 92

  const pageUrl = (p: number) => `/api/secoes?${qs(f, { sort, dir, c: cIds || undefined, limit: PAGE, offset: p * PAGE })}`
  const first = useApi<Page>('secoes', f, { sort, dir, c: cIds || undefined, limit: PAGE, offset: 0 }, !!sum)
  const total = first.data?.total ?? 0

  const scroller = useRef<HTMLDivElement>(null)
  const rowH = mobile ? 112 : 34
  const virt = useVirtualizer({ count: total, getScrollElement: () => scroller.current, estimateSize: () => rowH, overscan: 14 })
  const items = virt.getVirtualItems()
  const pages = useMemo(() => {
    const s = new Set<number>()
    if (items.length) { s.add(Math.floor(items[0].index / PAGE)); s.add(Math.floor(items[items.length - 1].index / PAGE)) }
    return [...s]
  }, [items.length ? items[0].index : 0, items.length ? items[items.length - 1].index : 0])
  const results = useQueries({
    queries: pages.map((p) => ({ queryKey: [pageUrl(p).replace(/^\/api\//, '/api/')], queryFn: ({ signal }: { signal: AbortSignal }) => getJson<Page>(pageUrl(p), signal), staleTime: 5 * 60_000, enabled: !!sum })),
  })
  const byPage = new Map<number, Page>()
  pages.forEach((p, i) => { const d = results[i].data; if (d) byPage.set(p, d) })
  const rowAt = (i: number) => byPage.get(Math.floor(i / PAGE))?.rows[i % PAGE] ?? (Math.floor(i / PAGE) === 0 ? first.data?.rows[i] : undefined)

  if (first.isError) return <ErrorState msg={(first.error as Error).message} />
  if (first.data && total === 0) return <EmptyState />

  const exportUrl = (fmt: string) => `/api/export?${qs(f, { fmt, sort, dir })}`
  const toggleSort = (s: string) => setExtra({ sort: s, dir: sort === s && dir === 'asc' ? 'desc' : 'asc' })
  const voteCell = (r: Row, i: number) => fmtInt(r[`v${i}`] as number | null)

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[420px] flex-col rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
        <span className="tabular-nums"><b>{first.isPending ? '…' : fmtInt(total)}</b> seções</span>
        <span className="text-muted-foreground">· ordenado por {COLS.find((c) => c.sort === sort)?.label ?? sort} ({dir === 'asc' ? 'crescente' : 'decrescente'})</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Popover>
            <PopoverTrigger className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><Columns3 className="size-3.5" aria-hidden />Colunas</PopoverTrigger>
            <PopoverContent align="end" className="max-h-80 w-56 overflow-auto p-2">
              {COLS.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted">
                  <input type="checkbox" className="accent-[var(--primary)]" checked={vis.includes(c.id)} onChange={() => setVis(vis.includes(c.id) ? vis.filter((x) => x !== c.id) : [...vis, c.id])} />
                  {c.label}
                </label>
              ))}
            </PopoverContent>
          </Popover>
          <a href={exportUrl('csv')} download className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><Download className="size-3.5" aria-hidden />CSV</a>
          <a href={exportUrl('parquet')} download className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><Download className="size-3.5" aria-hidden />Parquet</a>
        </div>
      </div>

      <div ref={scroller} className="relative flex-1 overflow-auto" role="table" aria-label="Seções eleitorais" aria-rowcount={total}>
        {!mobile && (
          <div role="row" className="sticky top-0 z-10 grid border-b bg-muted/80 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur"
            style={{ gridTemplateColumns: gridCols, width: totalW, minWidth: '100%' }}>
            {cols.map((c) => (
              <button key={c.id} role="columnheader" type="button" disabled={!c.sort} onClick={() => c.sort && toggleSort(c.sort)}
                aria-sort={c.sort === sort ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                className={cn('flex h-8 items-center gap-1 px-2 focus-visible:outline-2 focus-visible:outline-ring', c.right && 'justify-end', c.sort && 'hover:text-foreground')}>
                {c.label}{c.sort === sort && (dir === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
              </button>
            ))}
            {topCands.map((c) => (
              <div key={c.nr} role="columnheader" className="flex h-8 items-center justify-end gap-1 truncate px-2" title={nameOf(meta, f.cargo, c.escopo, c.nr)}>
                <i className="size-2 shrink-0 rounded-sm" style={{ background: colorOf(c.nr) }} aria-hidden />
                <span className="truncate">{nameOf(meta, f.cargo, c.escopo, c.nr).split(' ')[0]}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ height: virt.getTotalSize(), width: mobile ? '100%' : totalW, minWidth: '100%', position: 'relative' }}>
          {items.map((v) => {
            const r = rowAt(v.index)
            const style = { position: 'absolute' as const, top: 0, left: 0, width: '100%', height: v.size, transform: `translateY(${v.start}px)` }
            if (!r) return <div key={v.key} style={style} className="p-1.5"><Skeleton className="h-full w-full" /></div>
            const open = () => setDetail(`${r.uf}.${r.zona}.${r.secao}`)
            if (mobile) {
              return (
                <button key={v.key} type="button" onClick={open} style={style} aria-rowindex={v.index + 2}
                  className="block border-b px-3 py-2 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                  <div className="truncate text-sm font-medium">{r.local ?? 'Local não informado'}</div>
                  <div className="truncate text-muted-foreground">{r.municipio} · {r.uf} · zona {r.zona} · seção {r.secao}</div>
                  <div className="mt-1 tabular-nums">{fmtTime(r.abertura)}–{fmtTime(r.encerramento)} · {fmtInt(r.comparecimento)}/{fmtInt(r.aptos)} compareceram ({fmtPct(100 - (r.abst_pct ?? 0), 0)})</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 tabular-nums">
                    {topCands.map((c, i) => <span key={c.nr}><i className="mr-1 inline-block size-2 rounded-sm" style={{ background: colorOf(c.nr) }} aria-hidden />{nameOf(meta, f.cargo, c.escopo, c.nr).split(' ')[0]} {voteCell(r, i)}</span>)}
                  </div>
                </button>
              )
            }
            return (
              <div key={v.key} role="row" aria-rowindex={v.index + 2} tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()}
                style={{ ...style, gridTemplateColumns: gridCols }}
                className="grid cursor-pointer items-center border-b text-xs tabular-nums hover:bg-muted/70 focus-visible:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                {cols.map((c) => <div key={c.id} role="cell" className={cn('truncate px-2', c.right && 'text-right')} title={typeof c.cell(r) === 'string' ? (c.cell(r) as string) : undefined}>{c.cell(r)}</div>)}
                {topCands.map((c, i) => <div key={c.nr} role="cell" className="px-2 text-right">{voteCell(r, i)}</div>)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
