"""Etapa 1 do ETL: CSV bruto de uma UF → Parquet enxuto (somente Presidente/Governador, tipos corretos).

O bruto do TSE é enorme (SP ≈ 10 GB descompactado); por isso o download converte cada UF assim que chega e
descarta o CSV/ZIP (use --keep-raw em etl/download.py para mantê-los).
"""
from pathlib import Path

import duckdb

# Valores ausentes no TSE: #NULO#, #NE#, -1, -3
NULLS = ["#NULO#", "#NE#", "-1", "-3"]
CARGOS = {"Presidente": 1, "Governador": 3}

COLS = {
    "NR_TURNO": "UTINYINT", "SG_UF": "VARCHAR", "CD_MUNICIPIO": "INTEGER", "NM_MUNICIPIO": "VARCHAR",
    "NR_ZONA": "USMALLINT", "NR_SECAO": "USMALLINT", "NR_LOCAL_VOTACAO": "INTEGER",
    "CD_CARGO_PERGUNTA": "UTINYINT", "DS_CARGO_PERGUNTA": "VARCHAR", "SG_PARTIDO": "VARCHAR",
    "DT_BU_RECEBIDO": "TIMESTAMP", "QT_APTOS": "INTEGER",
    "QT_COMPARECIMENTO": "INTEGER", "QT_ABSTENCOES": "INTEGER", "CD_TIPO_URNA": "UTINYINT",
    "DS_TIPO_URNA": "VARCHAR", "DS_TIPO_VOTAVEL": "VARCHAR", "NR_VOTAVEL": "INTEGER",
    "NM_VOTAVEL": "VARCHAR", "QT_VOTOS": "INTEGER", "NR_URNA_EFETIVADA": "INTEGER",
    "DS_SECOES_AGREGADAS": "VARCHAR", "DT_ABERTURA": "TIMESTAMP", "DT_ENCERRAMENTO": "TIMESTAMP",
    "QT_ELEI_BIOM_SEM_HABILITACAO": "INTEGER", "DT_EMISSAO_BU": "TIMESTAMP",
}


def stage_csv(csv: Path, out: Path) -> int:
    """Converte o CSV do BU em Parquet (ZSTD); retorna o nº de linhas. Falha se o leiaute for diferente do esperado."""
    out.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    header = con.execute(f"SELECT * FROM read_csv('{csv.as_posix()}', delim=';', encoding='latin-1', header=true, all_varchar=true) LIMIT 0").description
    missing = [c for c in COLS if c not in {d[0] for d in header}]
    if missing:
        raise SystemExit(f"Leiaute do BU diferente do esperado em {csv.name}: faltam {missing}")
    types = ", ".join(f"'{k}': '{v}'" for k, v in COLS.items())
    nulls = ",".join(f"'{n}'" for n in NULLS)
    cargos = ",".join(f"'{c}'" for c in CARGOS)
    con.execute(f"""COPY (SELECT {', '.join(COLS)} FROM read_csv('{csv.as_posix()}', delim=';', encoding='latin-1', header=true,
        nullstr=[{nulls}], types={{{types}}}) WHERE DS_CARGO_PERGUNTA IN ({cargos}))
        TO '{out.as_posix()}' (FORMAT parquet, COMPRESSION zstd)""")
    return con.execute(f"SELECT count(*) FROM read_parquet('{out.as_posix()}')").fetchone()[0]


def stage_zip(zp: Path, out: Path, chunk_bytes: int = 200_000_000) -> int:
    """Como stage_csv, mas lê o CSV de dentro do ZIP em blocos de linhas (sem extrair o arquivo inteiro)."""
    import zipfile

    out.parent.mkdir(parents=True, exist_ok=True)
    parts: list[Path] = []
    with zipfile.ZipFile(zp) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        with z.open(name) as f:
            header = f.readline()
            while True:
                lines = f.readlines(chunk_bytes)
                if not lines:
                    break
                tmp = out.with_name(f"{out.stem}.chunk{len(parts)}.csv")
                with open(tmp, "wb") as w:
                    w.write(header)
                    w.writelines(lines)
                del lines
                part = out.with_name(f"{out.stem}.part{len(parts)}.parquet")
                stage_csv(tmp, part)
                tmp.unlink()
                parts.append(part)
    con = duckdb.connect()
    plist = ",".join(f"'{p.as_posix()}'" for p in parts)
    con.execute(f"COPY (SELECT * FROM read_parquet([{plist}])) TO '{out.as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
    n = con.execute(f"SELECT count(*) FROM read_parquet('{out.as_posix()}')").fetchone()[0]
    for p in parts:
        p.unlink()
    return n
