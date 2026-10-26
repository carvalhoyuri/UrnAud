"""Testes unitários do construtor de filtros (sem dados): parametrização e validação de entrada."""
from starlette.datastructures import QueryParams

from api.filters import Filters, where


def parse(qs: str) -> Filters:
    return Filters.parse(QueryParams(qs), {1})


def test_defaults():
    f = parse("")
    assert (f.turno, f.cargo) == (1, 1)
    sql, params = where(f)
    assert sql == "s.cargo = ?" and params == [1]


def test_values_are_bound_never_concatenated():
    evil = "AC'; DROP TABLE t1_secao; --"
    f = parse(f"uf={evil}&tipo_urna={evil}&q={evil}&mun=1,2,x")
    sql, params = where(f)
    assert "DROP" not in sql
    assert evil not in sql
    assert evil in params  # tipo_urna e q vão como parâmetro
    assert f.uf == []  # UF fora da whitelist é descartada
    assert f.mun == [1, 2]  # lixo não numérico é descartado


def test_range_fields_are_whitelisted():
    f = parse("r=abst_pct:5:20&r=1;drop:1:2&r=aptos::300")
    assert [r[0] for r in f.ranges] == ["abst_pct", "aptos"]
    sql, params = where(f)
    assert "s.abst_pct >= ?" in sql and "s.aptos <= ?" in sql
    assert params == [1, 5.0, 20.0, 300.0]


def test_facet_excludes_own_dimension():
    f = parse("uf=AC,RR&mun=1")
    sql, _ = where(f, exclude="uf")
    assert "s.uf IN" not in sql and "s.cd_municipio IN" in sql


def test_and_combination():
    f = parse("uf=AC&cargo=3&depois17=1&agregada=1&venc=13,22")
    sql, params = where(f)
    assert sql.count(" AND ") >= 4
    assert params[0] == 3 and "AC" in params and 13 in params


def test_local_tuple_parsing():
    f = parse("local=AC.1392.1.1023,XX.1.1.1,AC.bad")
    assert f.local == [("AC", 1392, 1, 1023)]
