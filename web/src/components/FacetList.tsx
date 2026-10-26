import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useApi, useMeta, type Facet } from '@/lib/api'
import { fmtInt } from '@/lib/format'
import { toggle, type Filters } from '@/lib/filters'
import { useDebounced } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

interface Props {
  dim: 'uf' | 'mun' | 'zona' | 'local' | 'tipo_urna'
  f: Filters
  selected: (string | number)[]
  onChange: (v: any[]) => void
  searchable?: boolean
  placeholder?: string
  maxHeight?: number
  /** rótulo exibido para valores selecionados que não estão mais na lista */
  fallbackLabel?: (k: string | number) => string
}

export const labelCache = new Map<string, string>()

/** Lista de opções com contagem de seções (facetas). Opções com 0 seções ficam desabilitadas (exceto as já selecionadas). */
export function FacetList({ dim, f, selected, onChange, searchable, placeholder, maxHeight = 200, fallbackLabel }: Props) {
  const [s, setS] = useState('')
  const ds = useDebounced(s, 250)
  const { data, isPending } = useApi<Facet[]>(`facets/${dim}`, f, { s: ds || undefined, limit: 200 })
  const meta = useMeta().data

  const items = useMemo(() => {
    const base: Facet[] = [...(data ?? [])]
    if (dim === 'uf' && meta) {
      const have = new Set(base.map((x) => x.k))
      for (const u of meta.ufs) if (!have.has(u.uf)) base.push({ k: u.uf, label: u.uf, secoes: 0, aptos: 0 })
      base.sort((a, b) => String(a.k).localeCompare(String(b.k)))
    }
    const have = new Set(base.map((x) => String(x.k)))
    const missing: Facet[] = selected.filter((k) => !have.has(String(k))).map((k) => ({
      k, label: labelCache.get(`${dim}:${k}`) ?? fallbackLabel?.(k) ?? String(k), secoes: 0, aptos: 0,
    }))
    base.forEach((x) => labelCache.set(`${dim}:${x.k}`, x.label))
    return [...missing, ...base]
  }, [data, dim, meta, selected, fallbackLabel])

  const uf2name = (k: string) => meta?.ufs.find((u) => u.uf === k)?.nome ?? ''

  return (
    <div className="space-y-1.5">
      {searchable && (
        <label className="relative block">
          <span className="sr-only">{placeholder}</span>
          <Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" aria-hidden />
          <input
            value={s}
            onChange={(e) => setS(e.target.value)}
            placeholder={placeholder ?? 'Buscar…'}
            className="h-7 w-full rounded-md border bg-background pl-7 pr-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      )}
      <ul className="overflow-y-auto pr-1" style={{ maxHeight, minHeight: isPending ? 80 : undefined }}>
        {isPending && Array.from({ length: 4 }).map((_, i) => <li key={i}><Skeleton className="my-1 h-5 w-full" /></li>)}
        {items.map((it) => {
          const on = selected.some((x) => String(x) === String(it.k))
          const disabled = it.secoes === 0 && !on
          return (
            <li key={String(it.k)}>
              <label className={cn('flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted', disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent')}>
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--primary)]"
                  checked={on}
                  disabled={disabled}
                  onChange={() => onChange(toggle(selected as any[], it.k))}
                />
                <span className="min-w-0 flex-1 truncate" title={it.sub ? `${it.label} — ${it.sub}` : dim === 'uf' ? uf2name(String(it.k)) : it.label}>
                  {dim === 'uf' ? <><b className="font-medium">{it.k}</b> <span className="text-muted-foreground">{uf2name(String(it.k))}</span></> : it.label}
                  {it.sub && dim !== 'zona' && <span className="text-muted-foreground"> · {it.sub}</span>}
                </span>
                <span className="tabular-nums text-muted-foreground">{fmtInt(it.secoes)}</span>
              </label>
            </li>
          )
        })}
        {!isPending && items.length === 0 && <li className="px-1 py-2 text-xs text-muted-foreground">Nenhuma opção para o recorte atual.</li>}
      </ul>
    </div>
  )
}
