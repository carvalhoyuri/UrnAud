import { useSyncExternalStore } from 'react'

export type Range = [number | null, number | null]
export type View = 'geral' | 'mapa' | 'horarios' | 'secoes' | 'validacao' | 'comparacao'
const VIEWS: View[] = ['geral', 'mapa', 'horarios', 'secoes', 'validacao', 'comparacao']

export interface Filters {
  cargo: number
  uf: string[]
  mun: number[]
  zona: number[]
  secao: number[]
  local: string[]
  venc: number[]
  tipo_urna: string[]
  agregada: '' | '0' | '1'
  depois17: boolean
  q: string
  r: Record<string, Range>
  cand: Record<number, Range>
}
export const EMPTY: Filters = {
  cargo: 1, uf: [], mun: [], zona: [], secao: [], local: [], venc: [], tipo_urna: [], agregada: '', depois17: false,
  q: '', r: {}, cand: {},
}
const LISTS = ['uf', 'mun', 'zona', 'secao', 'local', 'venc', 'tipo_urna'] as const
const rangeStr = (n: string | number, [a, b]: Range) => `${n}:${a ?? ''}:${b ?? ''}`

/** Filtros → query string da API. */
export function toApiParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams()
  p.set('cargo', String(f.cargo))
  for (const k of LISTS) if (f[k].length) p.set(k, f[k].join(','))
  if (f.agregada) p.set('agregada', f.agregada)
  if (f.depois17) p.set('depois17', '1')
  if (f.q) p.set('q', f.q)
  for (const [k, v] of Object.entries(f.r)) p.append('r', rangeStr(k, v))
  for (const [k, v] of Object.entries(f.cand)) p.append('cand', rangeStr(k, v))
  return p
}

/** Estado completo da URL: filtros + visão + detalhe aberto + opções do mapa. */
export interface UrlState { f: Filters; v: View; d: string; ex: Record<string, string> }
const EXTRA_KEYS = ['mm', 'ma', 'mb', 'cols', 'sort', 'dir']

export function parse(search: string): UrlState {
  const p = new URLSearchParams(search)
  const f: Filters = structuredClone(EMPTY)
  f.cargo = Number(p.get('cargo')) === 3 ? 3 : 1
  const list = (k: string) => (p.get(k) ?? '').split(',').filter(Boolean)
  f.uf = list('uf')
  f.tipo_urna = list('tipo_urna')
  f.local = list('local')
  for (const k of ['mun', 'zona', 'secao', 'venc'] as const) f[k] = list(k).map(Number).filter(Number.isFinite)
  f.agregada = p.get('agregada') === '1' ? '1' : p.get('agregada') === '0' ? '0' : ''
  f.depois17 = p.get('depois17') === '1'
  f.q = p.get('q') ?? ''
  const rg = (s: string): [string, Range] | null => {
    const [k, a, b] = s.split(':')
    return k ? [k, [a ? Number(a) : null, b ? Number(b) : null]] : null
  }
  for (const s of p.getAll('r')) { const x = rg(s); if (x) f.r[x[0]] = x[1] }
  for (const s of p.getAll('cand')) { const x = rg(s); if (x) f.cand[Number(x[0])] = x[1] }
  const v = p.get('v') as View
  const ex: Record<string, string> = {}
  for (const k of EXTRA_KEYS) if (p.get(k)) ex[k] = p.get(k)!
  return { f, v: VIEWS.includes(v) ? v : 'geral', d: p.get('d') ?? '', ex }
}

export function serialize(s: UrlState): string {
  const p = toApiParams(s.f)
  if (s.f.cargo === 1) p.delete('cargo')
  if (s.v !== 'geral') p.set('v', s.v)
  if (s.d) p.set('d', s.d)
  for (const [k, v] of Object.entries(s.ex)) if (v) p.set(k, v)
  const q = p.toString()
  return q ? '?' + q : ''
}

let cache = { search: '\0', state: parse('') }
function snapshot() {
  if (cache.search !== location.search) cache = { search: location.search, state: parse(location.search) }
  return cache.state
}
const subs = new Set<() => void>()
const notify = () => subs.forEach((f) => f())
window.addEventListener('popstate', notify)

export const useUrl = (): UrlState =>
  useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb) }, snapshot)

export function update(patch: (s: UrlState) => UrlState, replace = false) {
  const next = patch(structuredClone(snapshot()))
  const url = serialize(next)
  if (url !== location.search) {
    history[replace ? 'replaceState' : 'pushState'](null, '', url || location.pathname)
    notify()
  }
}
export const setFilters = (patch: Partial<Filters>) => update((s) => ({ ...s, f: { ...s.f, ...patch } }), true)
export const setView = (v: View) => update((s) => ({ ...s, v }))
export const setDetail = (d: string) => update((s) => ({ ...s, d }))
export const setExtra = (ex: Record<string, string>) => update((s) => ({ ...s, ex: { ...s.ex, ...ex } }), true)
export const clearAll = () => update((s) => ({ ...s, f: { ...structuredClone(EMPTY), cargo: s.f.cargo } }))
export const loadSearch = (search: string) => {
  history.pushState(null, '', search || location.pathname)
  notify()
}
export const applyParams = (params: Record<string, string | number>, view?: View) =>
  update((s) => {
    const f = structuredClone(EMPTY)
    f.cargo = s.f.cargo
    for (const [k, v] of Object.entries(params)) {
      if (k === 'uf') f.uf = [String(v)]
      else if (k === 'mun') f.mun = [Number(v)]
      else if (k === 'zona') f.zona = [Number(v)]
      else if (k === 'secao') f.secao = [Number(v)]
      else if (k === 'local') f.local = [String(v)]
    }
    return { ...s, f, v: view ?? s.v }
  })
export const hasFilters = (f: Filters) =>
  JSON.stringify({ ...f, cargo: 1 }) !== JSON.stringify({ ...EMPTY, cargo: 1 })

export const toggle = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
