"""ETL: CSVs do Boletim de Urna (TSE) -> Parquet (ZSTD) + tabelas pré-agregadas.

Uso: python etl/build.py --turno 1 [--ufs AC RR]
Saída em data/parquet/t<turno>/.
"""
import argparse
import glob
import os
import sys
import time
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from etl.stage import CARGOS, COLS, NULLS, stage_csv  # noqa: E402,F401

ROOT = Path(__file__).resolve().parent.parent
RAW = Path(os.environ.get("URNAUD_RAW", ROOT / "data" / "raw"))
OUT = Path(os.environ.get("URNAUD_DATA", ROOT / "data" / "parquet"))
UFS = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO ZZ".split()
# Diferença do fuso local em relação a Brasília (horas). O TSE grava os horários no fuso local da UF.
# Limitação: Fernando de Noronha (UTC-2) e o exterior (ZZ, vários fusos) são tratados como Brasília.
TZ_OFFSET = {"AC": -2, "AM": -1, "MT": -1, "MS": -1, "RO": -1, "RR": -1}
def log(*a):
    print(f"[{time.strftime('%H:%M:%S')}]", *a, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--turno", type=int, default=1)
    ap.add_argument("--ufs", nargs="*", default=UFS)
    a = ap.parse_args()
    out = OUT / f"t{a.turno}"
    out.mkdir(parents=True, exist_ok=True)
    tmp = OUT.parent / f"stage_t{a.turno}.duckdb"
    tmp.unlink(missing_ok=True)
    con = duckdb.connect(str(tmp))
    con.execute("SET preserve_insertion_order=false")
    stage_dir = Path(os.environ.get("URNAUD_STAGE", OUT.parent / "stage")) / f"t{a.turno}"

    # 1) staging: uma linha por seção × cargo × votável (somente Presidente/Governador), vindo de data/stage/*.parquet
    first = True
    for uf in a.ufs:
        sp = stage_dir / f"{uf}.parquet"
        if not sp.exists():  # bruto ainda não convertido (download com --keep-raw)
            files = glob.glob(str(RAW / f"bu{a.turno}t" / uf / "*.csv"))
            if not files:
                raise SystemExit(f"Dados de {uf} não encontrados - rode etl/download.py")
            log("convertendo", uf)
            stage_csv(Path(files[0]), sp)
        log("lendo", uf)
        sel = f"SELECT * FROM read_parquet('{sp.as_posix()}')"
        con.execute(("CREATE TABLE raw AS " if first else "INSERT INTO raw ") + sel)
        first = False
    log("linhas staging:", con.execute("select count(*) from raw").fetchone()[0])

    off = " ".join(f"WHEN '{u}' THEN {h}" for u, h in TZ_OFFSET.items())
    con.execute(f"CREATE MACRO tzoff(u) AS (CASE u {off} ELSE 0 END)")

    # 2) seção × cargo (largo)
    con.execute("""
    CREATE TABLE sc AS
    SELECT SG_UF AS uf, CD_MUNICIPIO AS cd_municipio, any_value(NM_MUNICIPIO) AS nm_municipio,
      NR_ZONA AS zona, NR_SECAO AS secao, any_value(NR_LOCAL_VOTACAO) AS nr_local,
      CD_CARGO_PERGUNTA AS cargo,
      any_value(QT_APTOS) AS aptos, any_value(QT_COMPARECIMENTO) AS comparecimento,
      any_value(QT_ABSTENCOES) AS abstencoes,
      coalesce(sum(QT_VOTOS) FILTER (DS_TIPO_VOTAVEL='Branco'),0)::INTEGER AS brancos,
      coalesce(sum(QT_VOTOS) FILTER (DS_TIPO_VOTAVEL='Nulo'),0)::INTEGER AS nulos,
      coalesce(sum(QT_VOTOS) FILTER (DS_TIPO_VOTAVEL='Nominal'),0)::INTEGER AS nominais,
      coalesce(sum(QT_VOTOS) FILTER (DS_TIPO_VOTAVEL='Legenda'),0)::INTEGER AS legenda,
      any_value(DS_TIPO_URNA) AS tipo_urna, any_value(NR_URNA_EFETIVADA) AS urna,
      any_value(DS_SECOES_AGREGADAS) AS secoes_agregadas,
      any_value(DT_ABERTURA) AS abertura, any_value(DT_ENCERRAMENTO) AS encerramento,
      any_value(DT_EMISSAO_BU) AS emissao_bu,
      any_value(DT_BU_RECEBIDO) AS bu_recebido,
      any_value(QT_ELEI_BIOM_SEM_HABILITACAO) AS biom_nh
    FROM raw GROUP BY ALL""")

    # métricas derivadas. DT_BU_RECEBIDO está no horário de Brasília; os demais, no fuso local da UF.
    con.execute("""
    CREATE TABLE secao_cargo AS SELECT
      (dense_rank() OVER (ORDER BY uf, cd_municipio, zona, secao) - 1)::INTEGER AS sid,
      uf, cd_municipio, nm_municipio, zona, secao, nr_local, cargo,
      aptos, comparecimento, abstencoes, brancos, nulos, nominais, legenda,
      tipo_urna, urna, secoes_agregadas,
      CASE WHEN secoes_agregadas IS NULL THEN 0 ELSE len(string_split(secoes_agregadas,'/')) END::UTINYINT AS n_agregadas,
      abertura, encerramento, emissao_bu, bu_recebido, biom_nh,
      date_diff('second', abertura, encerramento)/60.0 AS duracao_min,
      date_diff('second', date_trunc('day', encerramento) + INTERVAL 17 HOUR + to_hours(tzoff(uf)), encerramento)/60.0 AS atraso_17h_min,
      date_diff('second', emissao_bu - to_hours(tzoff(uf)), bu_recebido)/60.0 AS transmissao_min,
      100.0*abstencoes/nullif(aptos,0) AS abst_pct,
      100.0*comparecimento/nullif(aptos,0) AS comp_pct,
      100.0*brancos/nullif(comparecimento,0) AS brancos_pct,
      100.0*nulos/nullif(comparecimento,0) AS nulos_pct,
      100.0*(brancos+nulos)/nullif(comparecimento,0) AS bn_pct,
      100.0*biom_nh/nullif(comparecimento,0) AS biom_nh_pct
    FROM sc""")

    # 3) dimensão de votáveis e votos (long). Candidatos a governador são específicos por UF.
    con.execute("""
    CREATE TABLE votavel AS
    SELECT CASE WHEN CD_CARGO_PERGUNTA=1 THEN 'BR' ELSE SG_UF END AS escopo, CD_CARGO_PERGUNTA AS cargo,
      NR_VOTAVEL AS nr, any_value(NM_VOTAVEL) AS nome,
      any_value(SG_PARTIDO) AS partido, any_value(DS_TIPO_VOTAVEL) AS tipo
    FROM raw GROUP BY ALL""")
    con.execute("""
    CREATE TABLE votos AS
    SELECT s.sid, r.CD_CARGO_PERGUNTA::UTINYINT AS cargo, r.NR_VOTAVEL AS nr, sum(r.QT_VOTOS)::INTEGER AS qt
    FROM raw r JOIN (SELECT DISTINCT sid, uf, cd_municipio, zona, secao FROM secao_cargo) s
      ON s.uf=r.SG_UF AND s.cd_municipio=r.CD_MUNICIPIO AND s.zona=r.NR_ZONA AND s.secao=r.NR_SECAO
    GROUP BY ALL ORDER BY sid, cargo, nr""")

    # vencedor e margem (pontos percentuais sobre votos válidos) por seção × cargo
    con.execute("""
    CREATE TABLE venc AS
    SELECT sid, cargo,
      max(nr) FILTER (rk=1) AS venc_nr, max(qt) FILTER (rk=1) AS venc_qt, coalesce(max(qt) FILTER (rk=2),0) AS seg_qt
    FROM (SELECT sid, cargo, nr, qt, row_number() OVER (PARTITION BY sid, cargo ORDER BY qt DESC, nr) rk
          FROM votos WHERE nr NOT IN (95, 96)) GROUP BY sid, cargo""")
    con.execute("""
    CREATE TABLE secao_final AS
    SELECT s.*, v.venc_nr::USMALLINT AS venc_nr,
      CASE WHEN s.nominais+s.legenda>0 THEN 100.0*(v.venc_qt-v.seg_qt)/(s.nominais+s.legenda) END AS margem_pp
    FROM secao_cargo s LEFT JOIN venc v USING (sid, cargo)""")
    con.execute("DROP TABLE secao_cargo")
    con.execute("ALTER TABLE secao_final RENAME TO secao_cargo")

    # 4) locais de votação
    build_locais(con, a.turno)

    # 5) agregados
    levels = {
        "uf": "uf", "mun": "uf, cd_municipio, nm_municipio", "zona": "uf, cd_municipio, zona",
        "local": "uf, cd_municipio, zona, nr_local",
    }
    for name, keys in levels.items():
        con.execute(f"""CREATE TABLE agg_{name} AS SELECT {keys}, cargo, count(*) AS secoes,
          sum(aptos) AS aptos, sum(comparecimento) AS comparecimento, sum(abstencoes) AS abstencoes,
          sum(brancos) AS brancos, sum(nulos) AS nulos, sum(nominais) AS nominais, sum(legenda) AS legenda,
          avg(duracao_min) AS duracao_media, avg(atraso_17h_min) AS atraso_medio
          FROM secao_cargo GROUP BY ALL ORDER BY ALL""")
        k2 = [k.strip() for k in keys.replace(", nm_municipio", "").split(",")]
        con.execute(f"""CREATE TABLE agg_{name}_votos AS SELECT {', '.join('s.'+k for k in k2)},
          v.cargo, v.nr, sum(v.qt)::BIGINT AS qt FROM votos v JOIN
          (SELECT DISTINCT sid, uf, cd_municipio, zona, nr_local FROM secao_cargo) s USING (sid)
          GROUP BY ALL ORDER BY ALL""")
    con.execute("""CREATE TABLE agg_br AS SELECT cargo, count(*) secoes, sum(aptos) aptos,
      sum(comparecimento) comparecimento, sum(abstencoes) abstencoes, sum(brancos) brancos, sum(nulos) nulos
      FROM secao_cargo GROUP BY cargo""")
    con.execute("CREATE TABLE agg_br_votos AS SELECT cargo, nr, sum(qt)::BIGINT qt FROM votos GROUP BY ALL ORDER BY ALL")

    # 6) Parquet ZSTD ordenado por UF/município/zona/seção (zone maps dão poda por UF)
    def dump(sql, name):
        p = out / (name + ".parquet")
        con.execute(f"COPY ({sql}) TO '{p}' (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 6, ROW_GROUP_SIZE 122880)")
        log("parquet", name, p.stat().st_size // 1024, "KB")

    dump("SELECT * FROM secao_cargo ORDER BY sid, cargo", "secao")
    dump("SELECT * FROM votos ORDER BY sid, cargo, nr", "votos")
    dump("SELECT * FROM votavel ORDER BY cargo, escopo, nr", "votavel")
    dump("SELECT * FROM locais ORDER BY uf, cd_municipio, zona, nr_local", "locais")
    for t in [r[0] for r in con.sql("select table_name from duckdb_tables() where table_name like 'agg_%'").fetchall()]:
        dump(f"SELECT * FROM {t}", t)
    con.close()
    tmp.unlink(missing_ok=True)
    log("ok")


def build_locais(con, turno):
    """Local de votação (nome, endereço, coordenadas) por (uf, município, zona, nr_local)."""
    files = glob.glob(str(RAW / "locais" / "*BRASIL*.csv"))
    if not files:
        raise SystemExit("Arquivo de locais não encontrado - rode etl/download.py --extras")
    nulls = ",".join(f"'{n}'" for n in NULLS)
    con.execute(f"""CREATE VIEW locais_raw AS SELECT * FROM read_csv('{files[0]}', delim=';', encoding='latin-1',
        header=true, all_varchar=true, nullstr=[{nulls}])""")
    cols = {r[0] for r in con.sql("describe locais_raw").fetchall()}
    log("colunas locais:", sorted(cols))
    pick = lambda *c: next((x for x in c if x in cols), None)
    uf, mun, zona, loc = pick("SG_UF"), pick("CD_MUNICIPIO"), pick("NR_ZONA"), pick("NR_LOCAL_VOTACAO")
    nome, end = pick("NM_LOCAL_VOTACAO"), pick("DS_ENDERECO")
    bairro, cep = pick("NM_BAIRRO"), pick("NR_CEP")
    lat, lon = pick("NR_LATITUDE"), pick("NR_LONGITUDE")
    miss = [n for n, v in dict(uf=uf, mun=mun, zona=zona, loc=loc, nome=nome).items() if v is None]
    if miss:
        raise SystemExit(f"Leiaute de locais diferente do esperado (faltam {miss}); colunas: {sorted(cols)}")
    q = lambda c, t: (f"TRY_CAST(replace({c}, ',', '.') AS {t})" if t == "DOUBLE" else f"TRY_CAST({c} AS {t})") if c else f"NULL::{t}"
    lat_q = f"CASE WHEN {q(lat,'DOUBLE')} BETWEEN -34 AND 6 THEN {q(lat,'DOUBLE')} END"
    lon_q = f"CASE WHEN {q(lon,'DOUBLE')} BETWEEN -75 AND -28 THEN {q(lon,'DOUBLE')} END"
    con.execute(f"""CREATE TABLE locais AS SELECT {uf} AS uf, {q(mun,'INTEGER')} AS cd_municipio,
      {q(zona,'USMALLINT')} AS zona, {q(loc,'INTEGER')} AS nr_local, any_value({nome}) AS nome,
      any_value({end or 'NULL'}) AS endereco, any_value({bairro or 'NULL'}) AS bairro,
      any_value({cep or 'NULL'}) AS cep, any_value({lat_q}) AS lat, any_value({lon_q}) AS lon
      FROM locais_raw WHERE NR_TURNO = '{turno}' GROUP BY 1,2,3,4""")


if __name__ == "__main__":
    main()
