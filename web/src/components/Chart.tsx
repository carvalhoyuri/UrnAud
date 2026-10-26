import { lazy, Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

const EChart = lazy(() => import('./EChart'))

/** Carrega o ECharts sob demanda; o skeleton tem a altura final (sem salto de layout). */
export function Chart({ option, height = 260, label }: { option: Record<string, unknown>; height?: number; label: string }) {
  return (
    <Suspense fallback={<Skeleton style={{ height }} className="w-full" />}>
      <EChart option={option} height={height} label={label} />
    </Suspense>
  )
}

/** Tabela alternativa para leitores de tela / quem prefere números. */
export function AltTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none rounded focus-visible:outline-2 focus-visible:outline-ring">Ver como tabela</summary>
      <div className="mt-2 max-h-56 overflow-auto">
        <table className="w-full text-left tabular-nums">
          <caption className="sr-only">{caption}</caption>
          <thead><tr>{head.map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className="px-2 py-1">{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  )
}
