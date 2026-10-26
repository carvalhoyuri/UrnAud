import type { Candidato, Meta } from './api'

/**
 * Cores fixas por número de votável, em paleta segura para daltonismo (Okabe–Ito) e SEM cores partidárias,
 * para não favorecer visualmente nenhum candidato. Sempre acompanhadas de nome/número e, nos gráficos, de padrões (decal).
 */
const FIXED: Record<number, string> = { 13: '#0072B2', 22: '#D55E00' }
const FALLBACK = ['#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#8C6D31', '#7F7F7F', '#6A3D9A', '#B2AA00', '#17BECF', '#A65628']
export const BRANCO = '#9CA3AF'
export const NULO = '#4B5563'

export function colorOf(nr: number): string {
  if (nr === 95) return BRANCO
  if (nr === 96) return NULO
  return FIXED[nr] ?? FALLBACK[nr % FALLBACK.length]
}
export function toTitle(s: string) {
  return s
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
    .replace(/\s(Da|De|Do|Das|Dos|E)\s/g, (m) => m.toLowerCase())
}
const find = (meta: Meta | undefined, cargo: number, escopo: string, nr: number): Candidato | undefined =>
  meta?.candidatos.find((x) => x.cargo === cargo && x.nr === nr && (cargo === 1 ? x.escopo === 'BR' : x.escopo === escopo))
export function nameOf(meta: Meta | undefined, cargo: number, escopo: string, nr: number): string {
  if (nr === 95) return 'Brancos'
  if (nr === 96) return 'Nulos'
  const c = find(meta, cargo, escopo, nr)
  return c?.nome ? toTitle(c.nome) : String(nr)
}
export const partyOf = (meta: Meta | undefined, cargo: number, escopo: string, nr: number) =>
  find(meta, cargo, escopo, nr)?.partido ?? ''
/** Candidatos nominais do cargo (presidente: nacional; governador: UFs informadas). */
export const nominais = (meta: Meta | undefined, cargo: number, ufs: string[] = []): Candidato[] =>
  meta?.candidatos.filter((c) => c.cargo === cargo && c.tipo === 'Nominal' && (cargo === 1 || ufs.includes(c.escopo))) ?? []
