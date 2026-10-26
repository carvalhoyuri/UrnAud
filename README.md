# Urnaud — Eleições Gerais 2026

Explorador de votos por **seção eleitoral** a partir dos dados abertos do TSE: filtros combináveis (AND) até o nível de
seção, mapa com *drill-down*, horários de abertura/encerramento das urnas, tabela virtualizada de seções e exportação do recorte.

> **Estado dos dados:** o Boletim de Urna do **2º turno (25/10/2026) ainda não foi publicado** pelo TSE. A aplicação foi
> construída e validada com o **1º turno (04/10/2026)**; o ETL é parametrizado por turno (`--turno 1|2`). Assim que o TSE
> publicar o 2º turno, veja [“Quando sair o 2º turno”](#quando-sair-o-2º-turno).

## Stack

| Camada | Tecnologias |
|---|---|
| ETL | Python + DuckDB → Parquet (ZSTD), agregados materializados |
| API | FastAPI + DuckDB (tabelas em memória carregadas dos Parquet), consultas 100% parametrizadas, cache LRU, gzip |
| Frontend | React + TypeScript + Vite, Tailwind CSS + shadcn/ui, TanStack Query/Table/Virtual, Apache ECharts, MapLibre GL |

## Rodando

Requisitos: Python ≥ 3.11, Node ≥ 20. (Ou apenas Docker.)

```bash
pip install -r requirements.txt

# 1) Download dos dados do TSE (BU por UF + locais de votação + arquivos de conferência) — vários GB, retomável
python etl/download.py --turno 1 --extras

# 2) ETL: CSV → Parquet + agregados (data/parquet/t1)
python etl/build.py --turno 1

# 3) Relatório de validação contra os totais do TSE (data/parquet/t1/validacao.json)
python etl/validate.py --turno 1

# 4) Malhas do IBGE para os mapas (data/geo)
python etl/geo.py --turno 1

# 5) API (porta 8000)
python -m uvicorn api.main:app --port 8000

# 6) Frontend em desenvolvimento (porta 5173, proxy para a API)
cd web && npm ci && npm run dev
#    ou build de produção, servido pela própria API em http://localhost:8000
cd web && npm run build
```

Testes: `python -m pytest api` (unitários dos filtros + integração com os Parquet, incluindo fechamento de totais e a validação contra o TSE).

### Docker / Easypanel

```bash
docker compose up --build   # http://localhost:8000
```

Na primeira subida, com o volume `/data` vazio, o contêiner baixa os dados do TSE, roda ETL, validação e malhas
(vários minutos) e só então sobe a API. Nas seguintes, usa o volume. No Easypanel: crie um app a partir do repositório
(Dockerfile na raiz), monte um volume persistente em `/data` e exponha a porta 8000. Variáveis opcionais:
`URNAUD_TURNO` (padrão 1), `URNAUD_CACHE` (tamanho do cache LRU, padrão 512).

## Fontes de dados

- **Boletim de Urna por UF** — `cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2026/buweb/bweb_<t>t_<UF>_<data>.zip` (base principal, uma linha por seção × cargo × votável; inclui `ZZ` = exterior).
- **Locais de votação** — `eleitorado_local_votacao_2026.zip` (nome, endereço, bairro, CEP, latitude/longitude). Traz os dois turnos.
- **Votação por município e zona** (`votacao_candidato_munzona_2026`) — fonte *independente* (totalização do TSE) usada na validação.
- **Detalhe da votação por seção** — conferência cruzada de comparecimento, brancos e nulos.
- **Malhas IBGE** — API de malhas (qualidade mínima). O código de município do TSE difere do IBGE; o cruzamento é feito por nome normalizado e os casos sem par são listados pelo script (nunca “adivinhados”).

Os CSVs do TSE usam `;`, Latin-1 e os nulos `#NULO#`, `#NE#`, `-1`, `-3` (todos tratados como nulo). O leiaute real foi lido do
cabeçalho e do `leiame` do ZIP; **diferenças em relação ao esperado**: `DS_SECOES_AGREGADAS` (em vez de `DS_AGREGADAS`),
`QT_ELEI_BIOM_SEM_HABILITACAO` (em vez de `QT_ELEITORES_BIOMETRIA_NH`), e o BU não traz modelo de urna nem indicador de contingência.

## Validação e desempenho (1º turno, base completa: 28 UFs, 499.207 seções)

**Validação** (`python etl/validate.py`, tela “Validação” e `/api/validacao`): a soma das seções do BU por UF × cargo × candidato foi
comparada ao arquivo oficial *votação por município e zona* do TSE. Resultado:
- **Todos os candidatos presentes nas duas fontes batem exatamente (diferença 0)**, inclusive o total nacional de Presidente (Flávio Bolsonaro 56.104.503; Lula 53.879.538).
- **Divergências não corrigidas (37 linhas):** candidatos que existem no BU e **não existem** no arquivo oficial por zona — Presidente nº 28 (Leonardo Avalanche, 5.246 votos) em todas as UFs e alguns candidatos a governador (RN nº 50, SE nº 22 e 45, SP nº 29, TO nº 35, entre outros). Não foi possível determinar a causa a partir dos dados (provável tratamento de candidaturas sub judice na totalização); ficam registradas no relatório e em um teste `xfail`.
- Conferência cruzada com o *detalhe da votação por seção*: única diferença em `aptos` do Exterior (ZZ, Presidente): BU 916.039 × TSE 916.534 (−495). Comparecimento, brancos e nulos batem em todas as UFs.
- 5.470 seções (≈1%) sem local correspondente no arquivo de locais (ficam sem nome/endereço); 3 municípios sem par TSE↔IBGE no mapa (São Thomé das Letras e Barão de Monte Alto, MG; Boa Esperança do Norte, MT).

**Desempenho** (máquina de desenvolvimento, Windows, Chrome 1440×900):

| Métrica | Meta | Medido |
|---|---|---|
| API, p95 por consulta (60 reqs sem cache, `scripts/bench.py`) | < 300 ms | 6–242 ms (pior: filtro de % de candidato no Brasil inteiro; ex.: resumo nacional 59 ms, mapa por UF 111 ms, histograma 9 ms, página de seções 71 ms) |
| Rolagem da tabela, 499 mil linhas | 60 fps | ~123–159 fps médios; p95 de frame 11–16 ms |
| Bundle inicial (gzip) | < 250 KB | ≈ 127 KB (JS 110 + CSS 13 + runtime 3); ECharts e MapLibre em chunks sob demanda |
| Lighthouse desktop | — | Performance 99 · Acessibilidade 96 · Boas práticas 100 · FCP 0,6 s · LCP 0,8 s · CLS 0,06 |
| Lighthouse móvel (4G simulado, CPU 4×) | primeira carga < 2 s | Performance 75 · Acessibilidade 100 · Boas práticas 100 · FCP 3,3 s · LCP 3,4 s — **não atinge 2 s nesse perfil**; no desktop atinge |

## Decisões importantes

- **Fusos.** `DT_ABERTURA`, `DT_ENCERRAMENTO` e `DT_EMISSAO_BU` estão no **fuso local da UF**; `DT_BU_RECEBIDO` está no **horário de Brasília** (verificado: com esse ajuste o BU mais rápido leva ~5 min; sem ele, ~2 h no AC). A votação é uniforme em Brasília (8h–17h), então “17h” = 17h de Brasília convertido ao fuso local (AC 15h; AM, MT, MS, RO, RR 16h). Fernando de Noronha (UTC−2) e o exterior são tratados como Brasília.
- **“Encerrou após as 17h”.** Quase toda urna fecha segundos ou minutos depois das 17h (fila de eleitores). O filtro usa tolerância de **10 min**; a métrica bruta (`atraso_17h_min`) permanece disponível.
- **Cargos.** O ETL carrega Presidente e Governador (os demais cargos multiplicariam o volume ~5×; basta incluir em `CARGOS` em `etl/build.py`).
- **Disco.** O bruto do TSE é grande (SP ≈ 10 GB de CSV). O download converte cada UF em Parquet enxuto (`data/stage`, só Presidente/Governador) lendo o CSV de dentro do ZIP em blocos e descarta o bruto (`--keep-raw` mantém). O diretório `data/` pode ficar em outro disco (junção/symlink ou `URNAUD_RAW`, `URNAUD_STAGE`, `URNAUD_DATA`, `URNAUD_GEO`). Resultado final: ~55 MB de Parquet.
- **Parquet.** Um arquivo por tabela, **ordenado por UF/município/zona/seção** com *row groups* de 122.880 linhas: as estatísticas min/max fazem poda por UF, equivalendo ao particionamento por UF sem milhares de arquivos pequenos. A API carrega os Parquet em tabelas DuckDB em memória no startup.
- **Cores dos candidatos.** Paleta segura para daltonismo, fixa por número do candidato e **sem cores partidárias**; sempre com nome/número, e nos gráficos com padrões (*decal*). Ordem por votos. Mesma escala nos dois lados no mapa divergente (centrada em 50%).
- **Mapas.** Sem mapa-base (nenhuma requisição a terceiros além do IBGE na geração das malhas); o detalhe da seção incorpora um mini-mapa do OpenStreetMap.
- **SQL.** Nada vindo do usuário é concatenado: valores vão como parâmetros e colunas/ordenações vêm de *whitelists* (`api/filters.py`).

## Dicionário de dados (`data/parquet/t<turno>/`)

**`secao`** — uma linha por seção × cargo (`cargo`: 1 = Presidente, 3 = Governador)

| Coluna | Descrição |
|---|---|
| `sid` | id interno da seção (denso, ordenado por UF/município/zona/seção) |
| `uf`, `cd_municipio` (código TSE), `nm_municipio`, `zona`, `secao`, `nr_local` | identificação |
| `aptos`, `comparecimento`, `abstencoes`, `brancos`, `nulos`, `nominais`, `legenda` | contagens |
| `tipo_urna`, `urna`, `secoes_agregadas`, `n_agregadas` | urna efetivada e seções agregadas |
| `abertura`, `encerramento`, `emissao_bu` | timestamps no fuso local da UF |
| `bu_recebido` | timestamp no horário de Brasília |
| `duracao_min` | encerramento − abertura |
| `atraso_17h_min` | minutos após 17h de Brasília (no fuso local); negativo = antes |
| `transmissao_min` | recebimento do BU − emissão (mesmo fuso) |
| `abst_pct`, `comp_pct`, `brancos_pct`, `nulos_pct`, `bn_pct` | percentuais (abstenção sobre aptos; demais sobre comparecimento) |
| `biom_nh`, `biom_nh_pct` | eleitores com biometria **não habilitados por ela** (o TSE não publica quantos foram habilitados por biometria) |
| `venc_nr`, `margem_pp` | candidato mais votado na seção e margem 1º × 2º em p.p. dos votos válidos |

**`votos`** (`sid`, `cargo`, `nr`, `qt`) · **`votavel`** (`escopo` = `BR` ou UF, `cargo`, `nr`, `nome`, `partido`, `tipo`) · **`locais`** (nome, endereço, bairro, CEP, `lat`, `lon`) ·
**`agg_br|uf|mun|zona|local`** e **`agg_*_votos`** (pré-agregados) · `validacao.json`.

## API

`GET /api/meta`, `/summary`, `/facets/{uf|mun|zona|local|tipo_urna}`, `/histogram/{campo}`, `/horarios/cumulativo`, `/map/{uf|mun}`, `/points`,
`/secoes` (paginada), `/secao/{uf}/{zona}/{secao}`, `/export?fmt=csv|parquet`, `/search?q=`, `/validacao`, `/health`. Documentação interativa em `/api/docs`.
Todos aceitam os filtros: `cargo`, `uf`, `mun`, `zona`, `secao`, `local` (`UF.município.zona.local`), `venc`, `tipo_urna`, `agregada`, `depois17`, `q`, `r=campo:min:max`, `cand=nr:min:max`.

## Quando sair o 2º turno

1. Em `etl/download.py`, acrescente o padrão de nome em `BU_NAME[2]` (ex.: `bweb_2t_{uf}_<data+hora>.zip`).
2. `python etl/download.py --turno 2 --extras && python etl/build.py --turno 2 && python etl/validate.py --turno 2 && python etl/geo.py --turno 2`
3. Reinicie a API: o turno mais recente passa a ser o padrão e a tela “1º × 2º turno” (transferência de votos por município/seção) usa os dois.

## Limitações conhecidas

- 2º turno ainda não disponível (ver acima); a tela de comparação entre turnos é um *placeholder* até lá.
- Sem **urna de contingência** nem **modelo da urna** (não constam no leiame/arquivos do BU).
- “% de biometria” é, na verdade, “biometria sem habilitação”, único dado de biometria do BU.
- Exterior: horários tratados como Brasília; não há malha no mapa.
- Cruzamento TSE↔IBGE por nome: municípios sem par aparecem em branco no mapa (lista impressa por `etl/geo.py`).
- Facetas de zona agrupam o mesmo número de zona entre UFs quando várias UFs estão no recorte.
- Compressão: brotli (com fallback gzip) na própria API.

## Licença e uso dos dados

Dados: TSE (dados abertos). Projeto independente, sem vínculo com o TSE; os números oficiais são os divulgados pelo Tribunal.
