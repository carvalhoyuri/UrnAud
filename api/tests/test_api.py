"""Testes de integração: exigem os Parquet gerados pelo ETL (data/parquet). Sem eles, são ignorados."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import main

DATA = Path(main.PARQUET) / "t1"
pytestmark = pytest.mark.skipif(not (DATA / "secao.parquet").exists(), reason="rode etl/build.py antes")
client = TestClient(main.app)


def test_meta_and_health():
    assert client.get("/api/health").json()["ok"] is True
    m = client.get("/api/meta").json()
    assert m["turnoPadrao"] == 1 and any(u["uf"] == "ZZ" for u in m["ufs"])


def test_summary_matches_votos_table():
    s = client.get("/api/summary?cargo=1").json()
    soma = sum(v["qt"] for v in s["votos"])
    assert soma == s["totais"]["validos"], "votos nominais+legenda do BU devem fechar com os totais por seção"
    t = s["totais"]
    assert t["comparecimento"] + t["abstencoes"] == t["aptos"]
    assert t["comparecimento"] == soma + t["brancos"] + t["nulos"]


def test_filters_are_and_and_monotonic():
    all_ = client.get("/api/summary?cargo=1").json()["totais"]["secoes"]
    uf = client.get("/api/summary?cargo=1&uf=AC").json()["totais"]["secoes"]
    both = client.get("/api/summary?cargo=1&uf=AC&depois17=1").json()["totais"]["secoes"]
    assert both <= uf <= all_


def test_pagination_and_sort():
    r = client.get("/api/secoes?uf=AC&sort=atraso&dir=desc&limit=5").json()
    assert len(r["rows"]) == 5 and r["total"] >= 5
    at = [x["atraso"] for x in r["rows"]]
    assert at == sorted(at, reverse=True)
    r2 = client.get("/api/secoes?uf=AC&sort=atraso&dir=desc&limit=5&offset=5").json()
    assert {x["sid"] for x in r["rows"]}.isdisjoint({x["sid"] for x in r2["rows"]})


def test_sort_whitelist_blocks_injection():
    r = client.get("/api/secoes?uf=AC&sort=uf;drop table x&limit=1")
    assert r.status_code == 200  # cai no padrão, nunca vai ao SQL


def test_export_csv():
    r = client.get("/api/export?fmt=csv&uf=AC&secao=1")
    assert r.status_code == 200 and r.text.splitlines()[0].startswith("uf;")


def test_detail_404():
    assert client.get("/api/secao/AC/9999/9999").status_code == 404


def _rel():
    p = DATA / "validacao.json"
    if not p.exists():
        pytest.skip("rode etl/validate.py")
    return json.loads(p.read_text("utf-8"))


def test_validacao_totais_oficiais():
    """Todo candidato presente nas duas fontes deve ter soma do BU == total oficial do TSE."""
    bad = [l for l in _rel()["linhas"] if l["oficial"] is not None and l["dif"] != 0]
    assert not bad, f"divergências BU × TSE: {bad[:5]}"


@pytest.mark.xfail(reason="Divergência conhecida e NÃO corrigida: candidatos presentes no BU e ausentes no arquivo oficial de votação por zona", strict=False)
def test_candidatos_ausentes_no_oficial():
    assert not [l for l in _rel()["linhas"] if l["oficial"] is None]
