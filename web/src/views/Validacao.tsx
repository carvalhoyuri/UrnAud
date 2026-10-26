import { CheckCircle2, TriangleAlert } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/skeleton'
import { getJson } from '@/lib/api'
import { fmtInt } from '@/lib/format'
import { ErrorState } from './Overview'

interface Linha { uf: string; cargo: string; nr: number; nome: string; bu: number; oficial: number | null; dif: number | null }
interface Rel {
  gerado_em: string; fonte_oficial: string
  resumo: { ok: boolean; ufs: number; divergentes: number; secoes_sem_local: number }
  nacional: Linha[]
  confronto_secao: { uf: string; campo: string; bu: number; tse: number; dif: number }[]
  linhas: Linha[]
  notas: string[]
}

export function Validacao() {
  const { data, isPending, error } = useQuery({ queryKey: ['validacao'], queryFn: ({ signal }) => getJson<Rel>('/api/validacao', signal) })
  if (error) return <ErrorState msg={(error as Error).message} />
  if (isPending) return <Skeleton className="h-64 w-full" />
  const bad = data.linhas.filter((l) => l.dif !== 0)
  return (
    <div className="space-y-4">
      <div className={`flex items-start gap-3 rounded-xl border p-4 ${data.resumo.ok ? '' : 'border-destructive/40 bg-destructive/5'}`}>
        {data.resumo.ok ? <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" aria-hidden /> : <TriangleAlert className="mt-0.5 size-5 text-destructive" aria-hidden />}
        <div className="text-sm">
          <p className="font-semibold">{data.resumo.ok ? 'Todos os totais por UF batem com a fonte oficial.' : `${data.resumo.divergentes} divergência(s) encontrada(s) — não foram corrigidas.`}</p>
          <p className="text-xs text-muted-foreground">Fonte de conferência: {data.fonte_oficial}. Gerado em {data.gerado_em}. UFs conferidas: {data.resumo.ufs}.</p>
        </div>
      </div>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Total nacional (Presidente)</h2>
        <Tabela rows={data.nacional} />
      </section>
      {data.confronto_secao.length > 0 && (
        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-1 text-sm font-semibold">Conferência cruzada (detalhe da votação por seção)</h2>
          <p className="mb-2 text-xs text-muted-foreground">Comparecimento, brancos e nulos somados do BU contra o arquivo “detalhe da votação por seção” do TSE.</p>
          <table className="w-full text-xs tabular-nums">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 font-medium">UF</th><th className="font-medium">Campo</th><th className="text-right font-medium">BU</th><th className="text-right font-medium">TSE</th><th className="text-right font-medium">Diferença</th></tr></thead>
            <tbody>{data.confronto_secao.map((c, i) => <tr key={i} className="border-t"><td className="py-1">{c.uf}</td><td>{c.campo}</td><td className="text-right">{fmtInt(c.bu)}</td><td className="text-right">{fmtInt(c.tse)}</td><td className={`text-right ${c.dif ? 'font-semibold text-destructive' : ''}`}>{fmtInt(c.dif)}</td></tr>)}</tbody>
          </table>
        </section>
      )}
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Por UF e candidato {bad.length > 0 && <span className="font-normal text-destructive">· {bad.length} divergência(s)</span>}</h2>
        <details open={bad.length > 0}>
          <summary className="cursor-pointer text-xs text-muted-foreground">{bad.length ? 'Mostrar apenas divergências' : 'Mostrar todas as linhas'}</summary>
          <div className="mt-2 max-h-[420px] overflow-auto"><Tabela rows={bad.length ? bad : data.linhas} /></div>
        </details>
      </section>
      {data.notas.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{data.notas.map((n, i) => <li key={i}>{n}</li>)}</ul>}
    </div>
  )
}

function Tabela({ rows }: { rows: Linha[] }) {
  return (
    <table className="w-full text-xs tabular-nums">
      <thead className="sticky top-0 bg-card"><tr className="text-left text-muted-foreground"><th className="py-1 font-medium">UF</th><th className="font-medium">Cargo</th><th className="font-medium">Candidato</th><th className="text-right font-medium">Soma das seções (BU)</th><th className="text-right font-medium">Oficial TSE</th><th className="text-right font-medium">Diferença</th></tr></thead>
      <tbody>
        {rows.map((l, i) => (
          <tr key={i} className="border-t">
            <td className="py-1">{l.uf}</td><td>{l.cargo}</td><td>{l.nome} ({l.nr})</td>
            <td className="text-right">{fmtInt(l.bu)}</td><td className="text-right">{fmtInt(l.oficial)}</td>
            <td className={`text-right ${l.dif ? 'font-semibold text-destructive' : 'text-emerald-700 dark:text-emerald-400'}`}>{l.dif == null ? '—' : l.dif === 0 ? '0 ✓' : fmtInt(l.dif)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
