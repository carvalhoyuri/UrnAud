const int = new Intl.NumberFormat('pt-BR')
export const fmtInt = (v: number | null | undefined) => (v == null ? '—' : int.format(Math.round(v)))
export const fmtNum = (v: number | null | undefined, d = 1) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
export const fmtPct = (v: number | null | undefined, d = 2) => (v == null ? '—' : fmtNum(v, d) + '%')

/** minutos desde 00:00 → "HH:mm" (valores >1440 indicam dia seguinte) */
export function fmtClock(min: number | null | undefined) {
  if (min == null) return '—'
  const m = Math.round(min)
  const h = Math.floor(m / 60) % 24
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}${m >= 1440 ? ' (+1d)' : ''}`
}
export function fmtDur(min: number | null | undefined) {
  if (min == null) return '—'
  const sign = min < 0 ? '−' : ''
  const m = Math.round(Math.abs(min))
  return m >= 60 ? `${sign}${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}min` : `${sign}${m}min`
}
export const TZ_SHORT: Record<string, string> = {
  AC: 'UTC−5', AM: 'UTC−4', MT: 'UTC−4', MS: 'UTC−4', RO: 'UTC−4', RR: 'UTC−4',
}
export const tzShort = (uf?: string) => (uf && TZ_SHORT[uf]) || 'UTC−3'

/** "2026-10-04T15:01:05" → "04/10/2026 15:01 (UTC−5)" */
export function fmtDateTime(iso: string | null | undefined, uf?: string, tz = true) {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso)
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}${tz ? ` (${tzShort(uf)})` : ''}`
}
export const fmtTime = (iso: string | null | undefined) => {
  const m = iso ? /[T ](\d{2}:\d{2})/.exec(iso) : null
  return m ? m[1] : '—'
}
