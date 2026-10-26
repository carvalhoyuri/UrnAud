import { BarChart3, Clock, ExternalLink, GitCompareArrows, Map as MapIcon, Moon, Search, ShieldCheck, SlidersHorizontal, Sun, Table2 } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { ActiveChips } from '@/components/ActiveChips'
import { CommandPalette } from '@/components/CommandPalette'
import { Detail } from '@/components/Detail'
import { FilterPanel } from '@/components/FilterPanel'
import { SavedViews } from '@/components/SavedViews'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useMeta } from '@/lib/api'
import { hasFilters, clearAll, setView, useUrl, type View } from '@/lib/filters'
import { fmtInt } from '@/lib/format'
import { useTheme } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { Overview } from '@/views/Overview'

const Mapa = lazy(() => import('@/views/Mapa').then((m) => ({ default: m.Mapa })))
const Horarios = lazy(() => import('@/views/Horarios').then((m) => ({ default: m.Horarios })))
const Secoes = lazy(() => import('@/views/Secoes').then((m) => ({ default: m.Secoes })))
const Validacao = lazy(() => import('@/views/Validacao').then((m) => ({ default: m.Validacao })))
const Comparacao = lazy(() => import('@/views/Comparacao').then((m) => ({ default: m.Comparacao })))

const TABS: { id: View; label: string; icon: typeof BarChart3 }[] = [
  { id: 'geral', label: 'Visão geral', icon: BarChart3 },
  { id: 'mapa', label: 'Mapa', icon: MapIcon },
  { id: 'horarios', label: 'Horários', icon: Clock },
  { id: 'secoes', label: 'Seções', icon: Table2 },
  { id: 'comparacao', label: '1º × 2º turno', icon: GitCompareArrows },
  { id: 'validacao', label: 'Validação', icon: ShieldCheck },
]

export default function App() {
  const { f, v, d } = useUrl()
  const meta = useMeta()
  const [dark, toggleTheme] = useTheme()
  const [searchOpen, setSearchOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const turno = meta.data?.turnoPadrao

  return (
    <TooltipProvider delay={150}>
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-background focus:p-2 focus:shadow">Ir para o conteúdo</a>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
          <div className="flex h-12 items-center gap-2 px-3 sm:px-4">
            <button type="button" onClick={() => setFiltersOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring lg:hidden" aria-label="Abrir filtros">
              <SlidersHorizontal className="size-3.5" aria-hidden />Filtros{hasFilters(f) && <span className="size-1.5 rounded-full bg-primary" />}
            </button>
            <h1 className="text-sm font-semibold tracking-tight">Urnaud</h1>
            {turno && <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium">{turno}º turno · 2026</span>}
            <nav aria-label="Telas" className="ml-2 hidden gap-0.5 md:flex">
              {TABS.map((t) => (
                <button key={t.id} type="button" onClick={() => setView(t.id)} aria-current={v === t.id ? 'page' : undefined}
                  className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring', v === t.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground')}>
                  <t.icon className="size-3.5" aria-hidden />{t.label}
                </button>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={() => setSearchOpen(true)} className="inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                <Search className="size-3.5" aria-hidden /><span className="hidden sm:inline">Buscar</span><kbd className="hidden rounded border px-1 text-[10px] sm:inline">Ctrl K</kbd>
              </button>
              <SavedViews />
              <button type="button" onClick={toggleTheme} aria-label={dark ? 'Tema claro' : 'Tema escuro'} className="inline-flex size-8 items-center justify-center rounded-md border hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
              </button>
            </div>
          </div>
          <nav aria-label="Telas" className="flex gap-0.5 overflow-x-auto border-t px-2 py-1 md:hidden">
            {TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setView(t.id)} aria-current={v === t.id ? 'page' : undefined}
                className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium', v === t.id ? 'bg-muted' : 'text-muted-foreground')}>
                <t.icon className="size-3.5" aria-hidden />{t.label}
              </button>
            ))}
          </nav>
        </header>

        {turno === 1 && !meta.data?.turnos.includes(2) && (
          <div role="status" className="border-b bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Exibindo o <b>1º turno (04/10/2026)</b>: o Boletim de Urna do 2º turno ainda não foi publicado pelo TSE.
          </div>
        )}

        <div className="flex flex-1">
          <aside className="sticky top-12 hidden h-[calc(100vh-3rem)] w-80 shrink-0 overflow-y-auto border-r px-3 py-2 lg:block" aria-label="Painel de filtros">
            <FilterPanel f={f} />
          </aside>
          <main id="conteudo" className="min-w-0 flex-1 space-y-3 px-3 py-4 sm:px-5">
            <div className="flex min-h-7 flex-wrap items-center gap-2">
              <ActiveChips f={f} />
              {!hasFilters(f) && <p className="text-xs text-muted-foreground">Sem filtros: Brasil inteiro, {meta.data ? meta.data.cargos.find((c) => c.id === f.cargo)?.nome : ''}. Use o painel para recortar até a seção.</p>}
            </div>
            <Suspense fallback={<Skeleton className="h-96 w-full" />}>
              {v === 'geral' && <Overview f={f} />}
              {v === 'mapa' && <Mapa f={f} />}
              {v === 'horarios' && <Horarios f={f} />}
              {v === 'secoes' && <Secoes f={f} />}
              {v === 'comparacao' && <Comparacao />}
              {v === 'validacao' && <Validacao />}
            </Suspense>
          </main>
        </div>

        <footer className="border-t px-4 py-4 text-xs text-muted-foreground">
          <p>
            Fonte: <a className="underline underline-offset-2" href="https://dadosabertos.tse.jus.br" target="_blank" rel="noreferrer">Portal de Dados Abertos do TSE <ExternalLink className="inline size-3" aria-hidden /></a> — Boletim de Urna, locais de votação 2026. Malhas: IBGE.
            {meta.data && <> Extração: {meta.data.extracao.split('-').reverse().join('/')}.</>} Projeto independente, sem vínculo com o TSE; os números oficiais são os do TSE.
          </p>
          <p className="mt-1">{turno ? `${turno}º turno` : ''}{meta.data?.validacao ? <> · Validação: {meta.data.validacao.ok ? 'totais por UF conferem com o TSE' : `${fmtInt(meta.data.validacao.divergentes)} divergência(s)`}</> : null}</p>
        </footer>
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="left" className="w-[88vw] max-w-sm overflow-y-auto px-3">
          <SheetHeader className="px-1"><SheetTitle>Filtros</SheetTitle><SheetDescription className="sr-only">Filtros combinados em AND</SheetDescription></SheetHeader>
          <FilterPanel f={f} />
          {hasFilters(f) && <button type="button" onClick={clearAll} className="mx-1 mb-4 mt-2 rounded-md border px-3 py-1.5 text-xs">Limpar tudo</button>}
        </SheetContent>
      </Sheet>
      <CommandPalette open={searchOpen} setOpen={setSearchOpen} />
      <Detail id={d} cargo={f.cargo} />
    </TooltipProvider>
  )
}
