import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { toApiParams, type Filters } from './filters'

export interface Candidato { escopo: string; cargo: number; nr: number; nome: string; partido: string | null; tipo: string }
export interface Meta {
  turnos: number[]; turnoPadrao: number; extracao: string
  cargos: { id: number; nome: string }[]
  ufs: { uf: string; nome: string; regiao: string }[]
  candidatos: Candidato[]; tiposUrna: string[]
  ranges: Record<string, [number, number]>
  validacao: { ok: boolean; ufs: number; divergentes: number } | null
}
export interface Totais {
  secoes: number; aptos: number; comparecimento: number; abstencoes: number; brancos: number; nulos: number; validos: number
  duracao_media: number | null; atraso_medio: number | null; apos17: number; agregadas: number
}
export interface Summary { totais: Totais; votos: { escopo: string; nr: number; qt: number }[] }
export interface Facet { k: string | number; label: string; sub?: string | null; secoes: number; aptos: number }

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, { signal })
  if (!r.ok) {
    let msg = r.statusText
    try { msg = (await r.json()).detail ?? msg } catch { /* sem corpo JSON */ }
    throw new Error(msg)
  }
  return r.json()
}

export type Extra = Record<string, string | number | undefined>
export function qs(f: Filters, extra: Extra = {}) {
  const p = toApiParams(f)
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') p.set(k, String(v))
  return p.toString()
}

/** Consulta com filtros: a chave inclui a query string e o AbortSignal cancela requisições obsoletas. */
export function useApi<T>(path: string, f: Filters, extra: Extra = {}, enabled = true) {
  const url = `/api/${path}?${qs(f, extra)}`
  return useQuery({
    queryKey: [url],
    queryFn: ({ signal }) => getJson<T>(url, signal),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    enabled,
  })
}
export const useMeta = () =>
  useQuery({ queryKey: ['meta'], queryFn: ({ signal }) => getJson<Meta>('/api/meta', signal), staleTime: Infinity })
