import { Bookmark, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { loadSearch } from '@/lib/filters'
import { useLocalStorage } from '@/lib/hooks'

interface Saved { name: string; search: string }

/** Visões salvas: guardam a query string atual (filtros + tela) em localStorage. */
export function SavedViews() {
  const [views, setViews] = useLocalStorage<Saved[]>('views', [])
  const [name, setName] = useState('')
  const save = () => {
    const n = name.trim()
    if (!n) return
    setViews([...views.filter((v) => v.name !== n), { name: n, search: location.search }])
    setName('')
  }
  return (
    <Popover>
      <PopoverTrigger aria-label="Visões salvas" className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
        <Bookmark className="size-3.5" aria-hidden /><span className="hidden sm:inline">Visões</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2 p-3">
        <form onSubmit={(e) => { e.preventDefault(); save() }} className="flex gap-1.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da visão atual" aria-label="Nome da visão"
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <button type="submit" className="h-8 rounded-md bg-primary px-2.5 text-xs text-primary-foreground disabled:opacity-50" disabled={!name.trim()}>Salvar</button>
        </form>
        {views.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma visão salva. Salve a combinação atual de filtros e tela.</p>}
        <ul className="max-h-60 overflow-auto">
          {views.map((v) => (
            <li key={v.name} className="flex items-center gap-1">
              <button type="button" onClick={() => loadSearch(v.search)} className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">{v.name}</button>
              <button type="button" aria-label={`Excluir visão ${v.name}`} onClick={() => setViews(views.filter((x) => x.name !== v.name))} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"><Trash2 className="size-3.5" aria-hidden /></button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
