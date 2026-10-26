import { useMeta } from '@/lib/api'

/** Fase 4: a comparação 1º × 2º turno depende do BU do 2º turno, ainda não publicado pelo TSE. */
export function Comparacao() {
  const meta = useMeta().data
  const tem2 = meta?.turnos.includes(2)
  return (
    <div className="grid place-items-center rounded-xl border border-dashed p-12 text-center">
      <div className="max-w-md">
        <p className="text-sm font-semibold">{tem2 ? 'Comparação entre turnos' : 'Aguardando o 2º turno'}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {tem2
            ? 'Dados dos dois turnos carregados.'
            : 'O TSE ainda não publicou o Boletim de Urna do 2º turno (apenas o 1º turno está disponível). Quando for publicado, rode o download e o ETL com --turno 2 (veja o README) e esta tela passará a mostrar a transferência aproximada de votos por município e seção e o mapa de variação.'}
        </p>
      </div>
    </div>
  )
}
