"""Relatório de validação: soma das seções (BU) × totais do TSE, por UF, cargo e candidato.

Fontes oficiais independentes do BU:
  - votacao_candidato_munzona (totalização por município/zona) → votos nominais por candidato;
  - detalhe_votacao_secao → comparecimento, brancos e nulos por UF/cargo.
Divergências NUNCA são corrigidas: aparecem no relatório (data/parquet/t<turno>/validacao.json) e o script sai com código 1.

Uso: python etl/validate.py --turno 1 [--esperado 13=64256232,22=59826041]
"""
import argparse
import glob
import json
import os
import sys
import time
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
RAW = Path(os.environ.get("URNAUD_RAW", ROOT / "data" / "raw"))
OUT = Path(os.environ.get("URNAUD_DATA", ROOT / "data" / "parquet"))
STAGE = Path(os.environ.get("URNAUD_STAGE", OUT.parent / "stage"))
NULLS = "nullstr=['#NULO#','#NE#','-1','-3']"
CARGOS = {1: "Presidente", 3: "Governador"}


def read(con, pattern):
    files = glob.glob(str(RAW / pattern))
    if not files:
        raise SystemExit(f"Arquivo oficial não encontrado ({pattern}) - rode: python etl/download.py --extras")
    return f"read_csv('{files[0]}', delim=';', encoding='latin-1', header=true, all_varchar=true, {NULLS})", files[0]


def need(cols, *names):
    miss = [n for n in names if n not in cols]
    if miss:
        raise SystemExit(f"Leiaute do arquivo oficial diferente do esperado: faltam {miss}. Colunas: {sorted(cols)}")


def official_munzona(con, turno):
    cache = STAGE / f"oficial_munzona_t{turno}.parquet"
    if not cache.exists():
        src, f = read(con, "munzona/*.csv")
        cols = {d[0] for d in con.execute(f"SELECT * FROM {src} LIMIT 0").description}
        need(cols, "NR_TURNO", "SG_UF", "DS_CARGO", "NR_CANDIDATO", "NM_CANDIDATO", "QT_VOTOS_NOMINAIS")
        cache.parent.mkdir(parents=True, exist_ok=True)
        con.execute(f"""COPY (SELECT SG_UF AS uf, DS_CARGO AS cargo, TRY_CAST(NR_CANDIDATO AS INT) AS nr, any_value(NM_CANDIDATO) AS nome,
            sum(TRY_CAST(QT_VOTOS_NOMINAIS AS BIGINT))::BIGINT AS qt FROM {src}
            WHERE NR_TURNO = '{turno}' AND DS_CARGO IN ('Presidente','Governador') GROUP BY 1,2,3) TO '{cache.as_posix()}' (FORMAT parquet)""")
    return cache


def official_detalhe(con, turno):
    cache = STAGE / f"oficial_detalhe_t{turno}.parquet"
    if not cache.exists():
        src, f = read(con, "detalhe_secao/*.csv")
        cols = {d[0] for d in con.execute(f"SELECT * FROM {src} LIMIT 0").description}
        need(cols, "NR_TURNO", "SG_UF", "DS_CARGO", "QT_COMPARECIMENTO", "QT_VOTOS_BRANCOS", "QT_VOTOS_NULOS", "QT_APTOS")
        con.execute(f"""COPY (SELECT SG_UF AS uf, DS_CARGO AS cargo, sum(TRY_CAST(QT_APTOS AS BIGINT))::BIGINT aptos,
            sum(TRY_CAST(QT_COMPARECIMENTO AS BIGINT))::BIGINT comparecimento, sum(TRY_CAST(QT_VOTOS_BRANCOS AS BIGINT))::BIGINT brancos,
            sum(TRY_CAST(QT_VOTOS_NULOS AS BIGINT))::BIGINT nulos FROM {src}
            WHERE NR_TURNO = '{turno}' AND DS_CARGO IN ('Presidente','Governador') GROUP BY 1,2) TO '{cache.as_posix()}' (FORMAT parquet)""")
    return cache


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--turno", type=int, default=1)
    ap.add_argument("--esperado", default="", help="totais nacionais de Presidente informados, ex.: 13=64256232,22=59826041")
    a = ap.parse_args()
    d = OUT / f"t{a.turno}"
    con = duckdb.connect()
    notas = []

    # BU somado por UF × cargo × candidato (UF da seção)
    con.execute(f"""CREATE VIEW bu AS SELECT s.uf, CASE v.cargo WHEN 1 THEN 'Presidente' ELSE 'Governador' END cargo, v.nr, sum(v.qt)::BIGINT qt
        FROM read_parquet('{(d/'votos.parquet').as_posix()}') v JOIN read_parquet('{(d/'secao.parquet').as_posix()}') s ON s.sid=v.sid AND s.cargo=v.cargo
        WHERE v.nr NOT IN (95, 96) GROUP BY ALL""")
    of = official_munzona(con, a.turno)
    nm = con.execute(f"SELECT cargo, escopo, nr, nome FROM read_parquet('{(d/'votavel.parquet').as_posix()}')").fetchall()
    con.execute("CREATE TABLE nomes (cargo INT, escopo VARCHAR, nr INT, nome VARCHAR)")
    con.executemany("INSERT INTO nomes VALUES (?,?,?,?)", nm)

    rows = con.execute(f"""
        SELECT coalesce(b.uf, o.uf) uf, coalesce(b.cargo, o.cargo) cargo, coalesce(b.nr, o.nr) nr, o.nome onome,
               coalesce(b.qt, 0) bu, o.qt oficial
        FROM bu b FULL JOIN read_parquet('{of.as_posix()}') o ON o.uf=b.uf AND o.cargo=b.cargo AND o.nr=b.nr
        ORDER BY 1,2,3""").fetchall()
    linhas = []
    for uf, cargo, nr, onome, bu, of_ in rows:
        dif = None if of_ is None else bu - of_
        linhas.append({"uf": uf, "cargo": cargo, "nr": nr, "nome": onome or "", "bu": bu, "oficial": of_, "dif": dif})
    # candidatos que só existem em um dos lados também contam como divergência
    for l in linhas:
        if l["oficial"] is None:
            l["dif"] = l["bu"]
            notas.append(f"{l['uf']} {l['cargo']} nº {l['nr']}: presente no BU e ausente no arquivo oficial")

    nacional = []
    for nr, nome, bu in con.execute("""SELECT nr, any_value(onome), sum(bu) FROM (SELECT nr, NULL onome, qt bu FROM bu WHERE cargo='Presidente') GROUP BY nr ORDER BY 3 DESC""").fetchall():
        ofi = con.execute(f"SELECT sum(qt) FROM read_parquet('{of.as_posix()}') WHERE cargo='Presidente' AND nr=?", [nr]).fetchone()[0]
        n = next((x[3] for x in nm if x[0] == 1 and x[2] == nr), "")
        nacional.append({"uf": "BR", "cargo": "Presidente", "nr": nr, "nome": n, "bu": bu, "oficial": ofi, "dif": None if ofi is None else bu - ofi})
    if a.esperado:
        for kv in a.esperado.split(","):
            nr, v = (int(x) for x in kv.split("="))
            row = next((x for x in nacional if x["nr"] == nr), None)
            if row:
                row["esperado_informado"] = v
                row["dif_esperado"] = row["bu"] - v
                if row["dif_esperado"]:
                    notas.append(f"Presidente nº {nr}: soma do BU ({row['bu']:,}) difere do total informado ({v:,}) em {row['dif_esperado']:,}")

    # conferência cruzada: comparecimento / brancos / nulos
    confronto = []
    try:
        dc = official_detalhe(con, a.turno)
        for uf, cargo, comp, br, nu, ap_ in con.execute(f"""
            SELECT uf, CASE cargo WHEN 1 THEN 'Presidente' ELSE 'Governador' END, sum(comparecimento), sum(brancos), sum(nulos), sum(aptos)
            FROM read_parquet('{(d/'secao.parquet').as_posix()}') GROUP BY 1,2""").fetchall():
            o = con.execute(f"SELECT comparecimento, brancos, nulos, aptos FROM read_parquet('{dc.as_posix()}') WHERE uf=? AND cargo=?", [uf, cargo]).fetchone()
            if not o:
                continue
            for campo, bu_v, t_v in (("comparecimento", comp, o[0]), ("brancos", br, o[1]), ("nulos", nu, o[2]), ("aptos", ap_, o[3])):
                if bu_v != t_v:
                    confronto.append({"uf": f"{uf} ({cargo})", "campo": campo, "bu": int(bu_v), "tse": int(t_v or 0), "dif": int(bu_v - (t_v or 0))})
    except SystemExit as e:  # arquivo ainda não baixado: registra e segue
        notas.append(f"Conferência por seção não executada: {e}")

    sem_local = con.execute(f"""SELECT count(*) FROM read_parquet('{(d/'secao.parquet').as_posix()}') s LEFT JOIN read_parquet('{(d/'locais.parquet').as_posix()}') l
        USING (uf, cd_municipio, zona, nr_local) WHERE s.cargo=1 AND l.nome IS NULL""").fetchone()[0]
    if sem_local:
        notas.append(f"{sem_local:,} seções sem local de votação correspondente no arquivo de locais (ficam sem nome/endereço).")

    div = [l for l in linhas if l["dif"] not in (0, None)] + [l for l in nacional if l["dif"] not in (0, None)]
    ufs = len({l["uf"] for l in linhas})
    ok = not div and not confronto
    rel = {
        "gerado_em": time.strftime("%d/%m/%Y %H:%M"),
        "fonte_oficial": "TSE — votação por município e zona (totalização) e detalhe da votação por seção",
        "resumo": {"ok": ok, "ufs": ufs, "divergentes": len(div) + len(confronto), "secoes_sem_local": sem_local},
        "nacional": nacional, "confronto_secao": confronto, "linhas": linhas, "notas": notas,
    }
    (d / "validacao.json").write_text(json.dumps(rel, ensure_ascii=False, indent=1), "utf-8")
    print(f"UFs: {ufs} | linhas: {len(linhas)} | divergências: {len(div)} | confronto por seção: {len(confronto)} | sem local: {sem_local}")
    for l in nacional[:3]:
        print(f"  BR Presidente {l['nr']} {l['nome']}: BU {l['bu']:,} × oficial {l['oficial']:,} (dif {l['dif']})")
    for n in notas:
        print("  nota:", n)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
