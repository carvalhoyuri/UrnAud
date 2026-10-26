import { AltTable, Chart } from '@/components/Chart'
import { Skeleton } from '@/components/ui/skeleton'
import { useApi } from '@/lib/api'
import { setDetail, type Filters } from '@/lib/filters'
import { fmtClock, fmtDur, fmtInt, fmtNum, fmtPct, fmtDateTime } from '@/lib/format'
import { ErrorState } from './Overview'

interface Hist { min: number; max: number; bins: number; counts: number[] }
interface Cum { min: number; n: number; acum: number; pct: number }
interface SecaoRow { uf: string; municipio: string; zona: number; secao: number; local: string | null; encerramento: string; atraso: number }

function Histo({ title, field, f, fmt, hint, bins = 48 }: { title: string; field: string; f: Filters; fmt: (v: number) => string; hint: string; bins?: number }) {
  const { data, isPending, isError, error } = useApi<Hist>(`histogram/${field}`, f, { bins })
  if (isError) return <ErrorState msg={(error as Error).message} />
  const labels = data ? data.counts.map((_, i) => fmt(data.min + (i / data.bins) * (data.max - data.min))) : []
  const opt = data && {
    grid: { left: 8, right: 8, top: 12, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', formatter: (p: { dataIndex: number; value: number }[]) => `${labels[p[0].dataIndex]}<br/><b>${fmtInt(p[0].value)}</b> seções` },
    xAxis: { type: 'category', data: labels, axisLabel: { interval: Math.floor(bins / 8) } },
    yAxis: { type: 'value', splitLine: { lineStyle: { opacity: 0.25 } }, axisLabel: { formatter: (v: number) => fmtInt(v) } },
    series: [{ type: 'bar', data: data.counts, barCategoryGap: '8%', itemStyle: { color: '#0072B2' } }],
  }
  return (
    <section className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mb-1 text-xs text-muted-foreground">{hint}</p>
      {isPending || !opt ? <Skeleton className="h-[220px] w-full" /> : (
        <>
          <Chart height={220} option={opt} label={`Histograma: ${title}`} />
          <AltTable caption={title} head={['Faixa', 'Seções']} rows={data!.counts.map((c, i) => [labels[i], fmtInt(c)])} />
        </>
      )}
    </section>
  )
}

function Cumulativo({ f }: { f: Filters }) {
  const { data, isPending } = useApi<Cum[]>('horarios/cumulativo', f)
  const opt = data && {
    grid: { left: 8, right: 16, top: 12, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', formatter: (p: { dataIndex: number }[]) => { const d = data[p[0].dataIndex]; return `${fmtClock(d.min)} (Brasília)<br/><b>${fmtPct(d.pct, 1)}</b> dos BUs · ${fmtInt(d.acum)} seções` } },
    xAxis: { type: 'category', data: data.map((d) => fmtClock(d.min)), axisLabel: { interval: Math.max(1, Math.floor(data.length / 10)) } },
    yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' }, splitLine: { lineStyle: { opacity: 0.25 } } },
    series: [{ type: 'line', data: data.map((d) => d.pct), showSymbol: false, smooth: false, lineStyle: { width: 2.5, color: '#D55E00' }, areaStyle: { opacity: 0.08, color: '#D55E00' } }],
  }
  return (
    <section className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">BUs recebidos ao longo da noite</h3>
      <p className="mb-1 text-xs text-muted-foreground">Curva acumulada do recebimento do boletim de urna (horário de Brasília).</p>
      {isPending || !opt ? <Skeleton className="h-[220px] w-full" /> : (
        <>
          <Chart height={220} option={opt} label="Curva acumulada de BUs recebidos" />
          <AltTable caption="BUs recebidos" head={['Horário', 'Seções', '% acumulado']} rows={data!.map((d) => [fmtClock(d.min), fmtInt(d.n), fmtPct(d.pct, 1)])} />
        </>
      )}
    </section>
  )
}

function Tardias({ f }: { f: Filters }) {
  const { data, isPending } = useApi<{ total: number; rows: SecaoRow[] }>('secoes', f, { sort: 'atraso', dir: 'desc', limit: 15 })
  return (
    <section className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">Seções que encerraram mais tarde</h3>
      <p className="mb-2 text-xs text-muted-foreground">Atraso em relação às 17h de Brasília (no fuso local da UF). Clique para ver o detalhe.</p>
      <ul className="divide-y text-sm">
        {isPending && Array.from({ length: 6 }).map((_, i) => <li key={i} className="py-2"><Skeleton className="h-5 w-full" /></li>)}
        {data?.rows.map((r) => (
          <li key={`${r.uf}${r.zona}${r.secao}`}>
            <button type="button" onClick={() => setDetail(`${r.uf}.${r.zona}.${r.secao}`)}
              className="flex w-full items-center gap-3 rounded px-1 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
              <span className="w-16 shrink-0 font-semibold tabular-nums text-destructive">+{fmtDur(r.atraso)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{r.local ?? 'Local não informado'}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.municipio} · {r.uf} · zona {r.zona} · seção {r.secao} · encerrou {fmtDateTime(r.encerramento, r.uf)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function Horarios({ f }: { f: Filters }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Horários de abertura, encerramento e emissão estão no fuso local da UF (AC UTC−5; AM, MT, MS, RO, RR UTC−4; demais UTC−3). O recebimento do BU está no horário de Brasília. Seções do exterior são tratadas como horário de Brasília*.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Histo title="Abertura das urnas" field="abertura" f={f} fmt={fmtClock} hint="Horário local em que a urna foi aberta para votação." />
        <Histo title="Encerramento das urnas" field="encerramento" f={f} fmt={fmtClock} hint="Horário local em que a urna foi encerrada." />
        <Histo title="Duração do funcionamento" field="duracao" f={f} fmt={fmtDur} hint="Encerramento − abertura." />
        <Histo title="Atraso de encerramento (min após 17h de Brasília)" field="atraso" f={f} fmt={(v) => `${fmtNum(v, 0)} min`} hint="Valores negativos: encerrou antes das 17h." />
        <Histo title="Tempo até a transmissão do BU" field="transmissao" f={f} fmt={fmtDur} hint="Recebimento do BU − emissão do BU (ambos convertidos para o mesmo fuso)." />
        <Cumulativo f={f} />
      </div>
      <Tardias f={f} />
    </div>
  )
}
