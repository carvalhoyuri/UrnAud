import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { FacetList } from '@/components/FacetList'
import { Hint } from '@/components/Hint'
import { RangeHist } from '@/components/RangeHist'
import { Slider } from '@/components/ui/slider'
import { useMeta, useApi, type Summary } from '@/lib/api'
import { colorOf, nameOf, nominais } from '@/lib/candidates'
import { setFilters, toggle, type Filters } from '@/lib/filters'
import { fmtClock, fmtDur, fmtInt, fmtNum } from '@/lib/format'
import { cn } from '@/lib/utils'

function Section({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b py-2">
      <button
        type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded px-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {title}
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <div className="space-y-3 px-1 pb-2 pt-2">{children}</div>}
    </section>
  )
}

const Sub = ({ children, hint }: { children: ReactNode; hint?: string }) => (
  <div className="flex items-center gap-1 text-xs font-medium">{children}{hint && <Hint text={hint} />}</div>
)

function PctSlider({ f, nr, name }: { f: Filters; nr: number; name: string }) {
  const cur = f.cand[nr] ?? [null, null]
  const [drag, setDrag] = useState<[number, number] | null>(null)
  const v: [number, number] = drag ?? [cur[0] ?? 0, cur[1] ?? 100]
  const commit = (a: number, b: number) => {
    const c = { ...f.cand }
    if (a <= 0 && b >= 100) delete c[nr]
    else c[nr] = [a <= 0 ? null : a, b >= 100 ? null : b]
    setFilters({ cand: c })
    setDrag(null)
  }
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm" style={{ background: colorOf(nr) }} aria-hidden />{name}</span>
        <span className="tabular-nums text-muted-foreground">{f.cand[nr] || drag ? `${fmtNum(v[0], 0)}–${fmtNum(v[1], 0)}%` : 'todos'}</span>
      </div>
      <Slider aria-label={`% de ${name}`} min={0} max={100} step={1} value={v} className="mt-1.5"
        onValueChange={(x) => Array.isArray(x) && setDrag([x[0], x[1]])}
        onValueCommitted={(x) => Array.isArray(x) && commit(x[0], x[1])} />
    </div>
  )
}

export function FilterPanel({ f }: { f: Filters }) {
  const meta = useMeta().data
  const sum = useApi<Summary>('summary', f).data
  const regioes = [...new Set(meta?.ufs.map((u) => u.regiao).filter((r) => r !== 'Exterior'))]
  const ufsDeRegiao = (r: string) => meta?.ufs.filter((u) => u.regiao === r).map((u) => u.uf) ?? []
  const regiaoOn = (r: string) => ufsDeRegiao(r).every((u) => f.uf.includes(u))
  const toggleRegiao = (r: string) => {
    const us = ufsDeRegiao(r)
    setFilters({ uf: regiaoOn(r) ? f.uf.filter((u) => !us.includes(u)) : [...new Set([...f.uf, ...us])], mun: [], zona: [], local: [] })
  }
  const cands = nominais(meta, f.cargo, f.uf.length ? f.uf : meta?.ufs.map((u) => u.uf) ?? [])
  const vencList = (sum?.votos ?? []).slice(0, 12)

  return (
    <div className="text-sm" role="group" aria-label="Filtros">
      <Section title="Cargo" defaultOpen>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label="Cargo">
          {meta?.cargos.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={f.cargo === c.id}
              onClick={() => setFilters({ cargo: c.id, venc: [], cand: {} })}
              className={cn('rounded-md px-2 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring', f.cargo === c.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              {c.nome}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Geografia" defaultOpen>
        <div>
          <Sub>Região</Sub>
          <div className="mt-1 flex flex-wrap gap-1">
            {regioes.map((r) => (
              <button key={r} type="button" aria-pressed={regiaoOn(r)} onClick={() => toggleRegiao(r)}
                className={cn('rounded-full border px-2 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-ring', regiaoOn(r) ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted')}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <div><Sub>UF</Sub><FacetList dim="uf" f={f} selected={f.uf} maxHeight={170} onChange={(uf) => setFilters({ uf, mun: [], zona: [], local: [] })} /></div>
        <div><Sub>Município</Sub><FacetList dim="mun" f={f} selected={f.mun} searchable placeholder="Buscar município" onChange={(mun) => setFilters({ mun, zona: [], local: [] })} /></div>
        <div><Sub>Zona eleitoral</Sub><FacetList dim="zona" f={f} selected={f.zona} maxHeight={140} onChange={(zona) => setFilters({ zona })} /></div>
        <div><Sub hint="Busca por nome do local, bairro, endereço ou município.">Local de votação</Sub>
          <FacetList dim="local" f={f} selected={f.local} searchable placeholder="Nome, bairro ou endereço" onChange={(local) => setFilters({ local })}
            fallbackLabel={(k) => `Local ${String(k).split('.').pop()}`} /></div>
        <label className="block text-xs font-medium">Seção
          <input inputMode="numeric" placeholder="ex.: 12, 345" defaultValue={f.secao.join(', ')} key={f.secao.join()}
            onBlur={(e) => setFilters({ secao: e.target.value.split(/[ ,;]+/).map(Number).filter((n) => n > 0) })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="mt-1 h-7 w-full rounded-md border bg-background px-2 text-xs font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </label>
      </Section>

      <Section title="Candidato / tipo de voto">
        <div>
          <Sub hint="Mostra só as seções em que o candidato teve mais votos (entre os nominais).">Vencedor da seção</Sub>
          <ul className="mt-1">
            {vencList.map((v) => {
              const on = f.venc.includes(v.nr)
              return (
                <li key={v.escopo + v.nr}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted">
                    <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={on} onChange={() => setFilters({ venc: toggle(f.venc, v.nr) })} />
                    <i className="inline-block size-2.5 rounded-sm" style={{ background: colorOf(v.nr) }} aria-hidden />
                    <span className="flex-1 truncate">{nameOf(meta, f.cargo, v.escopo, v.nr)} <span className="text-muted-foreground">({v.nr})</span></span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
        <div className="space-y-2.5">
          <Sub hint="% do candidato sobre os votos válidos de cada seção (nominais + legenda).">% de votos válidos do candidato</Sub>
          {cands.slice(0, f.cargo === 1 ? 15 : 6).map((c) => <PctSlider key={c.escopo + c.nr} f={f} nr={c.nr} name={nameOf(meta, c.cargo, c.escopo, c.nr)} />)}
        </div>
      </Section>

      <Section title="Horários">
        <RangeHist field="abertura" label="Abertura da urna" f={f} fmt={fmtClock} step={5} hint="Horário de abertura da urna para votação, no fuso local da UF." />
        <RangeHist field="encerramento" label="Encerramento da urna" f={f} fmt={fmtClock} step={5} hint="Horário de encerramento da votação, no fuso local da UF." />
        <RangeHist field="duracao" label="Duração" f={f} fmt={fmtDur} step={5} hint="Encerramento − abertura." />
        <RangeHist field="bu" label="Recebimento do BU" f={f} fmt={fmtClock} step={10} hint="Quando o boletim de urna foi recebido pela totalização (horário de Brasília)." />
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={f.depois17} onChange={(e) => setFilters({ depois17: e.target.checked })} />
          Encerrou mais de 10 min após as 17h
          <Hint text="Todas as urnas fecham alguns minutos depois das 17h; o filtro usa tolerância de 10 min. 17h de Brasília, convertido para o fuso local de cada UF (AC 15h; AM, MT, MS, RO, RR 16h)." />
        </label>
      </Section>

      <Section title="Urna">
        <div><Sub>Tipo de urna</Sub><FacetList dim="tipo_urna" f={f} selected={f.tipo_urna} maxHeight={110} onChange={(tipo_urna) => setFilters({ tipo_urna })} /></div>
        <div>
          <Sub hint="Seção agregada: eleitores de outras seções votaram nesta urna. O TSE publica as agregadas na urna principal.">Seções agregadas</Sub>
          <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Seções agregadas">
            {([['', 'Todas'], ['1', 'Com agregadas'], ['0', 'Sem']] as const).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={f.agregada === v} onClick={() => setFilters({ agregada: v })}
                className={cn('rounded-full border px-2 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-ring', f.agregada === v ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted')}>{l}</button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Urna de contingência e modelo da urna não constam no leiaute do Boletim de Urna do TSE.</p>
      </Section>

      <Section title="Métricas">
        <RangeHist field="aptos" label="Eleitores aptos" f={f} fmt={fmtInt} />
        <RangeHist field="comp_pct" label="Comparecimento %" f={f} fmt={(v) => fmtNum(v, 0) + '%'} />
        <RangeHist field="abst_pct" label="Abstenção %" f={f} fmt={(v) => fmtNum(v, 0) + '%'} hint="Abstenções ÷ aptos da seção." />
        <RangeHist field="bn_pct" label="Brancos + nulos %" f={f} fmt={(v) => fmtNum(v, 0) + '%'} hint="(Brancos + nulos) ÷ comparecimento da seção." />
        <RangeHist field="biom_pct" label="Biometria sem habilitação %" f={f} fmt={(v) => fmtNum(v, 0) + '%'} hint="Eleitores com biometria cadastrada, mas não habilitados por ela, ÷ comparecimento. O TSE não publica o total de eleitores habilitados por biometria." />
        <RangeHist field="margem" label="Margem do 1º sobre o 2º (p.p.)" f={f} fmt={(v) => fmtNum(v, 0)} hint="Diferença, em pontos percentuais dos votos válidos, entre o mais votado e o segundo na seção." />
      </Section>
    </div>
  )
}
