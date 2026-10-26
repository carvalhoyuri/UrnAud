import { useQuery } from '@tanstack/react-query'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { getJson, useMeta } from '@/lib/api'
import { colorOf, nameOf } from '@/lib/candidates'
import { setDetail, setFilters } from '@/lib/filters'
import { fmtDateTime, fmtDur, fmtInt, fmtNum, fmtPct } from '@/lib/format'
import { Hint } from './Hint'

interface Sec {
  sid: number; uf: string; cd_municipio: number; nm_municipio: string; zona: number; secao: number; nr_local: number; cargo: number
  aptos: number; comparecimento: number; abstencoes: number; brancos: number; nulos: number; tipo_urna: string; urna: number | null
  secoes_agregadas: string | null; n_agregadas: number; abertura: string; encerramento: string; emissao_bu: string; bu_recebido: string
  duracao_min: number; atraso_17h_min: number; transmissao_min: number; abst_pct: number; bn_pct: number; biom_nh: number | null; biom_nh_pct: number | null
  margem_pp: number | null; local: string | null; endereco: string | null; bairro: string | null; cep: string | null; lat: number | null; lon: number | null
}
interface Det {
  secao: Sec; cargo: number; votos: { nr: number; nome: string; partido: string; qt: number }[]
  municipio: Record<string, number>; votosMunicipio: { nr: number; qt: number }[]
}

function Row({ k, v, hint }: { k: string; v: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-xs">
      <dt className="flex items-center gap-1 text-muted-foreground">{k}{hint && <Hint text={hint} />}</dt>
      <dd className="text-right tabular-nums">{v}</dd>
    </div>
  )
}
const cmp = (v: number | null, m: number | null, fmt: (x: number) => string) =>
  v == null || m == null ? null : <span className="ml-1 text-muted-foreground">(média do município: {fmt(m)})</span>

export function Detail({ id, cargo }: { id: string; cargo: number }) {
  const meta = useMeta().data
  const [uf, zona, secao] = id.split('.')
  const open = !!id
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['secao', id], enabled: open && !!secao,
    queryFn: ({ signal }) => getJson<Det[]>(`/api/secao/${uf}/${zona}/${secao}`, signal), staleTime: 10 * 60_000,
  })
  const d = data?.find((x) => x.cargo === cargo) ?? data?.[0]
  const s = d?.secao
  const mapUrl = s?.lat && s?.lon ? `https://www.openstreetmap.org/export/embed.html?bbox=${s.lon - 0.004}%2C${s.lat - 0.003}%2C${s.lon + 0.004}%2C${s.lat + 0.003}&layer=mapnik&marker=${s.lat}%2C${s.lon}` : null
  const totalMun = d?.votosMunicipio.reduce((a, v) => a + (v.nr < 95 ? v.qt : 0), 0) || 1
  const totalSec = d?.votos.reduce((a, v) => a + (v.nr < 95 ? v.qt : 0), 0) || 1

  return (
    <Sheet open={open} onOpenChange={(o) => !o && setDetail('')}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{s ? `Seção ${s.secao} · Zona ${s.zona}` : 'Detalhe da seção'}</SheetTitle>
          <SheetDescription>{s ? `${s.nm_municipio} · ${s.uf}` : id}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          {isError && <p role="alert" className="text-sm text-destructive">{(error as Error).message}</p>}
          {isPending && open && <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>}
          {s && d && (
            <>
              <section aria-label="Local de votação">
                <h3 className="text-sm font-semibold">{s.local ?? 'Local de votação não informado'}</h3>
                <p className="text-xs text-muted-foreground">{[s.endereco, s.bairro, s.cep].filter(Boolean).join(' · ')}</p>
                {mapUrl
                  ? <iframe title="Localização no mapa" src={mapUrl} loading="lazy" className="mt-2 h-40 w-full rounded-lg border" />
                  : <p className="mt-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Sem coordenadas publicadas para este local.</p>}
                <button type="button" className="mt-1 text-xs underline underline-offset-2" onClick={() => { setFilters({ uf: [s.uf], mun: [s.cd_municipio], local: [`${s.uf}.${s.cd_municipio}.${s.zona}.${s.nr_local}`] }); setDetail('') }}>
                  Filtrar por este local
                </button>
              </section>

              <section aria-label="Votos">
                <h3 className="mb-1 text-sm font-semibold">Votos ({fmtInt(s.comparecimento)} comparecimentos)</h3>
                <table className="w-full text-xs tabular-nums">
                  <thead><tr className="text-left text-muted-foreground"><th className="py-1 font-medium">Candidato</th><th className="text-right font-medium">Votos</th><th className="text-right font-medium">% válidos</th><th className="text-right font-medium">Município</th></tr></thead>
                  <tbody>
                    {d.votos.map((v) => {
                      const mv = d.votosMunicipio.find((x) => x.nr === v.nr)?.qt
                      return (
                        <tr key={v.nr} className="border-t">
                          <td className="py-1"><i className="mr-1.5 inline-block size-2.5 rounded-sm align-middle" style={{ background: colorOf(v.nr) }} aria-hidden />{v.nr >= 95 ? nameOf(meta, d.cargo, s.uf, v.nr) : `${nameOf(meta, d.cargo, s.uf, v.nr)} (${v.nr})`}</td>
                          <td className="text-right">{fmtInt(v.qt)}</td>
                          <td className="text-right">{v.nr >= 95 ? '—' : fmtPct((100 * v.qt) / totalSec, 1)}</td>
                          <td className="text-right text-muted-foreground">{v.nr >= 95 || mv == null ? '—' : fmtPct((100 * mv) / totalMun, 1)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </section>

              <section aria-label="Comparecimento">
                <h3 className="text-sm font-semibold">Comparecimento e comparação com o município</h3>
                <dl className="divide-y">
                  <Row k="Eleitores aptos" v={<>{fmtInt(s.aptos)}{cmp(s.aptos, d.municipio.aptos, (x) => fmtInt(x))}</>} />
                  <Row k="Abstenção" v={<>{fmtPct(s.abst_pct, 1)}{cmp(s.abst_pct, d.municipio.abst_pct, (x) => fmtPct(x, 1))}</>} />
                  <Row k="Brancos + nulos" v={<>{fmtPct(s.bn_pct, 1)}{cmp(s.bn_pct, d.municipio.bn_pct, (x) => fmtPct(x, 1))}</>} />
                  <Row k="Biometria sem habilitação" hint="Eleitores com biometria cadastrada que não foram habilitados por ela." v={s.biom_nh == null ? '—' : `${fmtInt(s.biom_nh)} (${fmtPct(s.biom_nh_pct, 1)})`} />
                  <Row k="Margem 1º × 2º" v={<>{s.margem_pp == null ? '—' : `${fmtNum(s.margem_pp, 1)} p.p.`}{cmp(s.margem_pp, d.municipio.margem, (x) => `${fmtNum(x, 1)} p.p.`)}</>} />
                </dl>
              </section>

              <section aria-label="Boletim de urna">
                <h3 className="text-sm font-semibold">Boletim de urna</h3>
                <dl className="divide-y">
                  <Row k="Abertura" v={fmtDateTime(s.abertura, s.uf)} />
                  <Row k="Encerramento" v={fmtDateTime(s.encerramento, s.uf)} />
                  <Row k="Duração" v={<>{fmtDur(s.duracao_min)}{cmp(s.duracao_min, d.municipio.duracao_min, fmtDur)}</>} />
                  <Row k="Atraso em relação às 17h (Brasília)" v={s.atraso_17h_min > 0 ? `+${fmtDur(s.atraso_17h_min)}` : 'encerrou até 17h'} />
                  <Row k="Emissão do BU" v={fmtDateTime(s.emissao_bu, s.uf)} />
                  <Row k="BU recebido" hint="Horário de Brasília." v={fmtDateTime(s.bu_recebido, 'BR')} />
                  <Row k="Tempo até a transmissão" v={<>{fmtDur(s.transmissao_min)}{cmp(s.transmissao_min, d.municipio.transmissao, fmtDur)}</>} />
                  <Row k="Tipo de urna" v={s.tipo_urna} />
                  <Row k="Urna efetivada" v={s.urna ?? '—'} />
                  <Row k="Seções agregadas" v={s.secoes_agregadas ? s.secoes_agregadas.replace(/\s/g, '') : 'nenhuma'} />
                </dl>
                <p className="mt-1 text-[11px] text-muted-foreground">Horários no fuso local da UF ({s.uf}).</p>
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
