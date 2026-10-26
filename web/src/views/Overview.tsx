import type { ReactNode } from 'react'
import { AltTable, Chart } from '@/components/Chart'
import { Hint } from '@/components/Hint'
import { Skeleton } from '@/components/ui/skeleton'
import { useApi, useMeta, type Summary } from '@/lib/api'
import { colorOf, nameOf, partyOf } from '@/lib/candidates'
import type { Filters } from '@/lib/filters'
import { fmtDur, fmtInt, fmtNum, fmtPct } from '@/lib/format'

export function Kpi({ label, value, sub, hint, color, loading }: { label: string; value: ReactNode; sub?: ReactNode; hint?: string; color?: string; loading?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {color && <i className="inline-block size-2.5 rounded-sm" style={{ background: color }} aria-hidden />}
        <span className="truncate">{label}</span>
        {hint && <Hint text={hint} />}
      </div>
      <div className="mt-1.5 h-8 text-2xl font-semibold tracking-tight tabular-nums">
        {loading ? <Skeleton className="h-7 w-32" /> : value}
      </div>
      <div className="mt-0.5 h-4 text-xs tabular-nums text-muted-foreground">{loading ? <Skeleton className="h-3 w-20" /> : sub}</div>
    </div>
  )
}

export function Overview({ f }: { f: Filters }) {
  const meta = useMeta().data
  const { data, isPending, isError, error } = useApi<Summary>('summary', f)
  if (isError) return <ErrorState msg={(error as Error).message} />
  const t = data?.totais
  const votos = data?.votos ?? []
  const validos = t?.validos ?? 0
  const single = f.cargo === 1 || f.uf.length === 1
  const label = (v: { escopo: string; nr: number }) => nameOf(meta, f.cargo, v.escopo, v.nr) + (f.cargo === 3 && !single ? ` (${v.escopo})` : '')
  const [a, b] = votos
  const diff = a && b ? a.qt - b.qt : null

  if (t && t.secoes === 0) return <EmptyState />

  const top = votos.slice(0, f.cargo === 1 ? 15 : 10)
  const bar = {
    grid: { left: 8, right: 70, top: 8, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => fmtInt(v) },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => (v >= 1e6 ? fmtNum(v / 1e6, 1) + ' mi' : v >= 1e3 ? fmtNum(v / 1e3, 0) + ' mil' : String(v)) }, splitLine: { lineStyle: { opacity: 0.25 } } },
    yAxis: { type: 'category', inverse: true, data: top.map(label) },
    series: [{
      type: 'bar', barMaxWidth: 22,
      data: top.map((v) => ({ value: v.qt, itemStyle: { color: colorOf(v.nr) } })),
      label: { show: true, position: 'right', formatter: (p: { value: number }) => fmtPct((100 * p.value) / (validos || 1), 1) },
    }],
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[a, b].map((v, i) => (
          <Kpi key={i} loading={isPending} color={v && colorOf(v.nr)}
            label={v ? `${label(v)} · ${partyOf(meta, f.cargo, v.escopo, v.nr) || v.nr}` : '—'}
            value={v ? fmtInt(v.qt) : '—'} sub={v ? `${fmtPct((100 * v.qt) / validos)} dos votos válidos` : ''} />
        ))}
        <Kpi loading={isPending} label="Diferença entre 1º e 2º" hint="Votos do mais votado menos os do segundo colocado, no recorte atual." value={diff == null ? '—' : fmtInt(diff)}
          sub={a && b ? `${fmtNum((100 * diff!) / validos, 2)} p.p. dos válidos` : ''} />
        <Kpi loading={isPending} label="Seções apuradas" value={fmtInt(t?.secoes)} sub={`${fmtInt(t?.agregadas)} com seções agregadas`} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi loading={isPending} label="Eleitores aptos" value={fmtInt(t?.aptos)} />
        <Kpi loading={isPending} label="Comparecimento" hint="Eleitores que compareceram ÷ aptos." value={fmtInt(t?.comparecimento)} sub={t ? fmtPct((100 * t.comparecimento) / t.aptos) : ''} />
        <Kpi loading={isPending} label="Abstenção" hint="Aptos que não compareceram ÷ aptos." value={fmtInt(t?.abstencoes)} sub={t ? fmtPct((100 * t.abstencoes) / t.aptos) : ''} />
        <Kpi loading={isPending} label="Brancos + nulos" hint="Percentuais sobre o comparecimento." value={fmtInt((t?.brancos ?? 0) + (t?.nulos ?? 0))}
          sub={t ? `Brancos ${fmtPct((100 * t.brancos) / t.comparecimento, 1)} · Nulos ${fmtPct((100 * t.nulos) / t.comparecimento, 1)}` : ''} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Kpi loading={isPending} label="Duração média da votação" hint="Média de (encerramento − abertura) por seção." value={fmtDur(t?.duracao_media)} />
        <Kpi loading={isPending} label="Encerrou >10 min após as 17h" hint="17h no horário de Brasília, convertido para o fuso local de cada UF." value={fmtInt(t?.apos17)} sub={t ? `${fmtPct((100 * t.apos17) / t.secoes, 1)} das seções` : ''} />
        <Kpi loading={isPending} label="Atraso médio de encerramento" hint="Média de minutos após as 17h de Brasília (negativo = antes)." value={t?.atraso_medio == null ? '—' : `${fmtNum(t.atraso_medio, 1)} min`} />
      </div>
      <section className="rounded-xl border bg-card p-4" aria-labelledby="h-votos">
        <h2 id="h-votos" className="mb-2 text-sm font-semibold">Votos por candidato <span className="font-normal text-muted-foreground">· ordenado por votos; % sobre votos válidos</span></h2>
        {isPending ? <Skeleton className="h-[320px] w-full" /> : (
          <>
            <Chart height={Math.max(180, top.length * 30 + 30)} label="Gráfico de barras com os votos por candidato" option={bar} />
            <AltTable caption="Votos por candidato" head={['Candidato', 'Votos', '% válidos']} rows={top.map((v) => [label(v), fmtInt(v.qt), fmtPct((100 * v.qt) / validos)])} />
          </>
        )}
      </section>
    </div>
  )
}

export function EmptyState() {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed p-12 text-center">
      <div>
        <p className="text-sm font-medium">Nenhuma seção corresponde a esses filtros.</p>
        <p className="mt-1 text-xs text-muted-foreground">Remova algum filtro ativo ou use “Limpar tudo”.</p>
      </div>
    </div>
  )
}
export function ErrorState({ msg }: { msg: string }) {
  return (
    <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm">
      <p className="font-medium">Não foi possível carregar os dados.</p>
      <p className="mt-1 text-xs text-muted-foreground">{msg}</p>
    </div>
  )
}
