import { useQuery } from '@tanstack/react-query'
import { Building2, MapPin, Vote } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { getJson } from '@/lib/api'
import { applyParams, setDetail } from '@/lib/filters'
import { useDebounced } from '@/lib/hooks'

interface Hit { type: 'mun' | 'local' | 'secao'; label: string; sub: string; params: Record<string, string | number> }

/** Busca global (Ctrl+K): município, local de votação ou "UF zona/seção" (ex.: AC 1/23). */
export function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (o: boolean) => void }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 200)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(!open) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, setOpen])
  const { data, isFetching } = useQuery({
    queryKey: ['search', dq], enabled: open && dq.length >= 2, staleTime: 60_000,
    queryFn: ({ signal }) => getJson<Hit[]>(`/api/search?q=${encodeURIComponent(dq)}`, signal),
  })
  const go = (h: Hit) => {
    setOpen(false); setQ('')
    if (h.type === 'secao') {
      applyParams({ uf: h.params.uf }, undefined)
      setDetail(`${h.params.uf}.${h.params.zona}.${h.params.secao}`)
    } else applyParams(h.params, 'geral')
  }
  const icon = { mun: Building2, local: MapPin, secao: Vote }
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Busca global" description="Busque município, local de votação ou seção">
      <CommandInput value={q} onValueChange={setQ} placeholder="Município, local de votação ou “AC 1/23” (UF zona/seção)…" />
      <CommandList>
        {dq.length < 2 ? <p className="p-4 text-sm text-muted-foreground">Digite ao menos 2 letras.</p> : (
          <>
            {!isFetching && <CommandEmpty>Nada encontrado.</CommandEmpty>}
            <CommandGroup>
              {(data ?? []).map((h, i) => {
                const I = icon[h.type]
                return (
                  <CommandItem key={i} value={`${dq} ${h.label} ${i}`} onSelect={() => go(h)}>
                    <I className="size-4 text-muted-foreground" aria-hidden />
                    <span className="flex-1 truncate">{h.label}</span>
                    <span className="truncate text-xs text-muted-foreground">{h.sub}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
