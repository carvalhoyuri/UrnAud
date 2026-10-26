"""Baixa malhas do IBGE (qualidade mínima) e grava GeoJSON enxuto em data/geo (servido pela API em /geo).

- uf.json: malha nacional por UF (propriedade `uf`).
- mun/<UF>.json: municípios da UF (propriedades `cd` = código TSE, `nome`).
O código do município no TSE difere do IBGE; o cruzamento é feito por nome normalizado dentro da UF.
Municípios sem correspondência são listados no final (nunca são "adivinhados").

Uso: python etl/geo.py --turno 1
"""
import argparse
import gzip
import json
import os
import re
import unicodedata
import urllib.request
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(os.environ.get("URNAUD_GEO", ROOT / "data" / "geo"))
API = "https://servicodados.ibge.gov.br/api"
UF_IBGE = {"RO": 11, "AC": 12, "AM": 13, "RR": 14, "PA": 15, "AP": 16, "TO": 17, "MA": 21, "PI": 22, "CE": 23,
           "RN": 24, "PB": 25, "PE": 26, "AL": 27, "SE": 28, "BA": 29, "MG": 31, "ES": 32, "RJ": 33, "SP": 35,
           "PR": 41, "SC": 42, "RS": 43, "MS": 50, "MT": 51, "GO": 52, "DF": 53}
# Grafias que diferem entre TSE e IBGE (verificadas manualmente; chave = (UF, nome TSE normalizado))
ALIASES = {("RN", "assu"): "acu", ("PA", "santa isabel do para"): "santa izabel do para",
           ("SP", "embu"): "embu das artes", ("MG", "brasopolis"): "brazopolis",
           ("PB", "campo de santana"): "tacima", ("RJ", "trajano de morais"): "trajano de moraes",
           ("SP", "sao luis do paraitinga"): "sao luiz do paraitinga", ("PE", "iguaraci"): "iguaracy",
           ("RS", "santana do livramento"): "sant'ana do livramento", ("MT", "poxoreo"): "poxoreu",
           ("RR", "sao luiz"): "sao luiz do anaua", ("SC", "grao para"): "grao-para", ("TO", "couto de magalhaes"): "couto magalhaes",
           ("RS", "sao valentim do sul"): "sao valentim do sul", ("PB", "sao domingos de pombal"): "sao domingos"}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z' ]", " ", s).replace("-", " ").strip()


def get(url):
    req = urllib.request.Request(url, headers={"Accept-Encoding": "gzip", "User-Agent": "urnaud-etl/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    if raw[:2] == bytes([0x1F, 0x8B]):
        raw = gzip.decompress(raw)
    return json.loads(raw)


def round_coords(c, p=3):
    if isinstance(c[0], (int, float)):
        return [round(c[0], p), round(c[1], p)]
    return [round_coords(x, p) for x in c]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--turno", type=int, default=1)
    a = ap.parse_args()
    (OUT / "mun").mkdir(parents=True, exist_ok=True)

    uf_geo = get(f"{API}/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=UF")
    inv = {v: k for k, v in UF_IBGE.items()}
    for f in uf_geo["features"]:
        f["properties"] = {"uf": inv[int(f["properties"]["codarea"])]}
        f["geometry"]["coordinates"] = round_coords(f["geometry"]["coordinates"])
    (OUT / "uf.json").write_text(json.dumps(uf_geo, separators=(",", ":")))

    p = Path(os.environ.get("URNAUD_DATA", ROOT / "data" / "parquet")) / f"t{a.turno}" / "agg_mun.parquet"
    tse = duckdb.sql(f"select distinct uf, cd_municipio, nm_municipio from '{p}'").fetchall()
    ibge_names = {int(m["id"]): m["nome"] for m in get(f"{API}/v1/localidades/municipios")}
    unmatched = []
    for uf, code in UF_IBGE.items():
        mesh = get(f"{API}/v3/malhas/estados/{code}?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio")
        by_name = {}
        for f in mesh["features"]:
            by_name[norm(ibge_names[int(f["properties"]["codarea"])])] = f
        feats, used = [], set()
        for u, cd, nm in tse:
            if u != uf:
                continue
            key = norm(nm)
            key = norm(ALIASES.get((uf, key), key))
            f = by_name.get(key)
            if f is None:
                unmatched.append((uf, cd, nm))
                continue
            used.add(key)
            f["properties"] = {"cd": cd, "nome": nm}
            f["geometry"]["coordinates"] = round_coords(f["geometry"]["coordinates"])
            feats.append(f)
        (OUT / "mun" / f"{uf}.json").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))
        print(uf, len(feats), "municípios; malha sem par TSE:", len(by_name) - len(used))
    print("SEM CORRESPONDÊNCIA:", unmatched)


if __name__ == "__main__":
    main()
