"""API Urnaud: DuckDB (somente leitura sobre Parquet) + FastAPI.

Os Parquet são carregados em tabelas em memória no startup (consultas agregadas ficam em dezenas de ms).
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from collections import OrderedDict
from pathlib import Path

import duckdb
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response

from .filters import CARGOS, ELECTION_DAY, RANGE_EXPR, UFS, Filters, where

ROOT = Path(__file__).resolve().parent.parent
PARQUET = Path(os.environ.get("URNAUD_DATA", ROOT / "data" / "parquet"))
CACHE_SIZE = int(os.environ.get("URNAUD_CACHE", "512"))

app = FastAPI(title="Urnaud API", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(GZipMiddleware, minimum_size=800, compresslevel=5)

_con = duckdb.connect(":memory:")
_tl = threading.local()
TURNOS: set[int] = set()
AGG_TABLES = ["agg_br", "agg_br_votos", "agg_uf", "agg_uf_votos", "agg_mun", "agg_mun_votos"]


def cur() -> duckdb.DuckDBPyConnection:
    c = getattr(_tl, "c", None)
    if c is None:
        c = _tl.c = _con.cursor()
    return c


def q(sql: str, params: list | None = None) -> list[tuple]:
    return cur().execute(sql, params or []).fetchall()


def rows(sql: str, params: list | None = None) -> list[dict]:
    r = cur().execute(sql, params or [])
    names = [d[0] for d in r.description]
    return [dict(zip(names, x)) for x in r.fetchall()]


def load():
    for d in sorted(PARQUET.glob("t[0-9]")):
        t = int(d.name[1:])
        for p in d.glob("*.parquet"):
            _con.execute(f"CREATE OR REPLACE TABLE t{t}_{p.stem} AS SELECT * FROM read_parquet('{p.as_posix()}')")
        _con.execute(f"""CREATE OR REPLACE TABLE t{t}_locais AS
            SELECT l.*, m.nm_municipio, strip_accents(lower(coalesce(l.nome,'')||' '||coalesce(l.bairro,'')||' '||
                   coalesce(l.endereco,'')||' '||coalesce(m.nm_municipio,''))) AS busca
            FROM t{t}_locais l LEFT JOIN (SELECT DISTINCT uf, cd_municipio, nm_municipio FROM t{t}_agg_mun) m
            USING (uf, cd_municipio)""")
        TURNOS.add(t)


if PARQUET.exists():
    load()


# ---------------------------------------------------------------- cache LRU de respostas
_cache: OrderedDict[str, bytes] = OrderedDict()
_lock = threading.Lock()


def cached(request: Request, compute, ttl_free=True) -> Response:
    key = request.url.path + "?" + "&".join(sorted(f"{k}={v}" for k, v in request.query_params.multi_items()))
    with _lock:
        hit = _cache.get(key)
        if hit is not None:
            _cache.move_to_end(key)
    if hit is None:
        body = json.dumps(compute(), separators=(",", ":"), default=str, allow_nan=False).encode()
        with _lock:
            _cache[key] = body
            while len(_cache) > CACHE_SIZE:
                _cache.popitem(last=False)
    else:
        body = hit
    return Response(body, media_type="application/json", headers={"Cache-Control": "public, max-age=300"})


def flt(request: Request) -> Filters:
    if not TURNOS:
        raise HTTPException(503, "Dados não carregados: rode o ETL (etl/build.py)")
    return Filters.parse(request.query_params, TURNOS)


def clean(o):
    """Converte NaN/inf em None para JSON estrito."""
    if isinstance(o, float) and (o != o or o in (float("inf"), float("-inf"))):
        return None
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean(v) for v in o]
    return o


# ---------------------------------------------------------------- meta
_ranges: dict[int, dict] = {}


def field_ranges(t: int) -> dict:
    if t in _ranges:
        return _ranges[t]
    D = ELECTION_DAY.get(t, "2026-10-04")
    out = {}
    for name, expr in RANGE_EXPR.items():
        e = expr.replace("{D}", D)
        lo, hi = q(f"SELECT quantile_cont({e}, 0.005), quantile_cont({e}, 0.995) FROM t{t}_secao s WHERE cargo=1")[0]
        if lo is None or hi is None or lo == hi:
            continue
        out[name] = [float(lo), float(hi)]
    _ranges[t] = out
    return out


@app.get("/api/meta")
def meta(request: Request):
    def compute():
        t = max(TURNOS)
        cands = rows(f"SELECT escopo, cargo, nr, nome, partido, tipo FROM t{t}_votavel ORDER BY cargo, escopo, nr")
        vf = Path(PARQUET / f"t{t}" / "validacao.json")
        return clean({
            "turnos": sorted(TURNOS), "turnoPadrao": t,
            "extracao": time.strftime("%Y-%m-%d", time.localtime((PARQUET / f"t{t}" / "secao.parquet").stat().st_mtime)),
            "cargos": [{"id": k, "nome": v} for k, v in CARGOS.items()],
            "ufs": [{"uf": k, "nome": v[0], "regiao": v[1]} for k, v in UFS.items()],
            "candidatos": cands,
            "tiposUrna": [r[0] for r in q(f"SELECT DISTINCT tipo_urna FROM t{t}_secao ORDER BY 1")],
            "ranges": field_ranges(t),
            "validacao": json.loads(vf.read_text("utf-8")).get("resumo") if vf.exists() else None,
        })
    return cached(request, compute)


# ---------------------------------------------------------------- KPIs
def summary_data(f: Filters) -> dict:
    T = f"t{f.turno}_"
    w, p = where(f)
    tot = rows(f"""SELECT count(*) secoes, coalesce(sum(aptos),0) aptos, coalesce(sum(comparecimento),0) comparecimento,
        coalesce(sum(abstencoes),0) abstencoes, coalesce(sum(brancos),0) brancos, coalesce(sum(nulos),0) nulos,
        coalesce(sum(nominais+legenda),0) validos, avg(duracao_min) duracao_media, avg(atraso_17h_min) atraso_medio,
        count(*) FILTER (atraso_17h_min > 10) apos17, count(*) FILTER (n_agregadas > 0) agregadas
        FROM {T}secao s WHERE {w}""", p)[0]
    votos = rows(f"""SELECT CASE WHEN v.cargo=1 THEN 'BR' ELSE s.uf END escopo, v.nr, sum(v.qt)::BIGINT qt
        FROM {T}secao s JOIN {T}votos v ON v.sid=s.sid AND v.cargo=s.cargo
        WHERE {w} AND v.nr NOT IN (95,96) GROUP BY ALL ORDER BY qt DESC""", p)
    return {"totais": tot, "votos": votos}


@app.get("/api/summary")
def summary(request: Request):
    f = flt(request)
    return cached(request, lambda: clean(summary_data(f)))


# ---------------------------------------------------------------- facetas
FACET_SQL = {
    "uf": ("s.uf", "s.uf", "s.uf"),
    "mun": ("s.cd_municipio", "s.cd_municipio, s.nm_municipio, s.uf", "s.nm_municipio"),
    "zona": ("s.zona", "s.zona", "'Zona ' || s.zona"),
    "tipo_urna": ("s.tipo_urna", "s.tipo_urna", "s.tipo_urna"),
}


@app.get("/api/facets/{dim}")
def facets(dim: str, request: Request):
    f = flt(request)
    T = f"t{f.turno}_"
    lim = min(int(request.query_params.get("limit", 300) or 300), 1000)
    search = request.query_params.get("s", "").strip()[:60]

    def compute():
        if dim == "local":
            w, p = where(f, exclude="local")
            extra = ""
            if search:
                extra = " AND contains(l.busca, strip_accents(lower(?)))"
                p = p + [search]
            r = rows(f"""SELECT s.uf, s.cd_municipio, s.zona, s.nr_local, any_value(l.nome) nome, any_value(l.bairro) bairro,
                any_value(l.endereco) endereco, any_value(s.nm_municipio) municipio, count(*) secoes, sum(s.aptos) aptos
                FROM {T}secao s LEFT JOIN {T}locais l USING (uf, cd_municipio, zona, nr_local)
                WHERE {w}{extra} GROUP BY s.uf, s.cd_municipio, s.zona, s.nr_local ORDER BY secoes DESC, nome LIMIT {lim}""", p)
            return [{"k": f"{x['uf']}.{x['cd_municipio']}.{x['zona']}.{x['nr_local']}", "label": x["nome"] or f"Local {x['nr_local']}",
                     "sub": " · ".join(str(y) for y in (x["bairro"], x["municipio"], x["uf"]) if y), "secoes": x["secoes"], "aptos": x["aptos"]}
                    for x in r]
        if dim not in FACET_SQL:
            raise HTTPException(404, "dimensão desconhecida")
        key, grp, lab = FACET_SQL[dim]
        w, p = where(f, exclude=dim)
        extra = ""
        if search and dim == "mun":
            extra = " AND contains(strip_accents(lower(s.nm_municipio)), strip_accents(lower(?)))"
            p = p + [search]
        order = "k" if dim in ("uf", "tipo_urna") else "secoes DESC"
        r = rows(f"""SELECT {key} AS k, {lab} AS label, min(s.uf) AS uf0, count(*) AS secoes, sum(s.aptos) AS aptos
            FROM {T}secao s WHERE {w}{extra} GROUP BY {grp} ORDER BY {order} LIMIT {lim}""", p)
        return clean([{"k": x["k"], "label": x["label"], "sub": x["uf0"] if dim in ("mun", "zona") else None,
                       "secoes": x["secoes"], "aptos": x["aptos"]} for x in r])
    return cached(request, compute)


# ---------------------------------------------------------------- histogramas
HIST_FIELDS = set(RANGE_EXPR)


@app.get("/api/histogram/{field}")
def histogram(field: str, request: Request):
    if field not in HIST_FIELDS:
        raise HTTPException(404, "campo desconhecido")
    f = flt(request)
    bins = max(8, min(int(request.query_params.get("bins", 40) or 40), 200))

    def compute():
        T = f"t{f.turno}_"
        lo, hi = field_ranges(f.turno).get(field, [0, 1])
        e = RANGE_EXPR[field].replace("{D}", ELECTION_DAY.get(f.turno, "2026-10-04"))
        w, p = where(f, exclude=field)
        step = (hi - lo) / bins
        r = q(f"""SELECT least(greatest(floor(({e} - ?) / ?), 0), ?)::INT b, count(*) FROM {T}secao s
            WHERE {w} AND {e} IS NOT NULL GROUP BY b ORDER BY b""", [lo, step, bins - 1] + p)
        counts = [0] * bins
        for b, c in r:
            counts[b] = c
        return {"min": lo, "max": hi, "bins": bins, "counts": counts}
    return cached(request, compute)


@app.get("/api/horarios/cumulativo")
def cumulativo(request: Request):
    f = flt(request)

    def compute():
        T = f"t{f.turno}_"
        w, p = where(f)
        e = RANGE_EXPR["bu"].replace("{D}", ELECTION_DAY.get(f.turno, "2026-10-04"))
        r = q(f"SELECT ({e} // 10) * 10 AS m, count(*) FROM {T}secao s WHERE {w} AND s.bu_recebido IS NOT NULL GROUP BY 1 ORDER BY 1", p)
        acc, out, total = 0, [], sum(c for _, c in r) or 1
        for m, c in r:
            acc += c
            out.append({"min": m, "n": c, "acum": acc, "pct": 100.0 * acc / total})
        return out
    return cached(request, compute)


# ---------------------------------------------------------------- mapa
@app.get("/api/map/{level}")
def map_level(level: str, request: Request):
    if level not in ("uf", "mun"):
        raise HTTPException(404)
    f = flt(request)

    def compute():
        T = f"t{f.turno}_"
        w, p = where(f)
        key = "s.uf" if level == "uf" else "s.cd_municipio"
        base = rows(f"""SELECT {key} k, count(*) secoes, sum(aptos) aptos, sum(comparecimento) comparecimento,
            sum(abstencoes) abstencoes, sum(brancos) brancos, sum(nulos) nulos, sum(nominais+legenda) validos,
            avg(atraso_17h_min) atraso_medio, avg(duracao_min) duracao_media FROM {T}secao s WHERE {w} GROUP BY 1""", p)
        vts = q(f"""SELECT {key} k, v.nr, sum(v.qt)::BIGINT FROM {T}secao s JOIN {T}votos v ON v.sid=s.sid AND v.cargo=s.cargo
            WHERE {w} AND v.nr NOT IN (95,96) GROUP BY ALL""", p)
        by = {b["k"]: {**b, "votos": {}} for b in base}
        for k, nr, qt in vts:
            by[k]["votos"][nr] = qt
        return clean(list(by.values()))
    return cached(request, compute)


@app.get("/api/points")
def points(request: Request):
    """Locais de votação com coordenadas (agregados por local) para o recorte; até 60 mil pontos."""
    f = flt(request)
    if not f.uf and not f.mun and not f.local:
        raise HTTPException(400, "informe uf ou mun")

    def compute():
        T = f"t{f.turno}_"
        w, p = where(f)
        r = rows(f"""SELECT l.lon, l.lat, any_value(l.nome) nome, s.uf, s.cd_municipio, s.zona, s.nr_local, count(*) secoes,
            sum(s.aptos) aptos, mode(s.venc_nr) venc, avg(s.margem_pp) margem
            FROM {T}secao s JOIN {T}locais l USING (uf, cd_municipio, zona, nr_local)
            WHERE {w} AND l.lat IS NOT NULL GROUP BY l.lon, l.lat, s.uf, s.cd_municipio, s.zona, s.nr_local LIMIT 60000""", p)
        return clean([[x["lon"], x["lat"], x["nome"], x["uf"], x["cd_municipio"], x["zona"], x["nr_local"], x["secoes"], x["aptos"], x["venc"],
                       None if x["margem"] is None else round(x["margem"], 1)] for x in r])
    return cached(request, compute)


# ---------------------------------------------------------------- tabela de seções
SORTS = {  # nome -> (expressão interna, coluna na página)
    "uf": ("s.uf", "uf"), "municipio": ("s.nm_municipio", "municipio"), "zona": ("s.zona", "zona"), "secao": ("s.secao", "secao"),
    "local": ("l.nome", "local"), "abertura": ("s.abertura", "abertura"), "encerramento": ("s.encerramento", "encerramento"),
    "duracao": ("s.duracao_min", "duracao_min"), "atraso": ("s.atraso_17h_min", "atraso"), "bu": ("s.bu_recebido", "bu_recebido"),
    "transmissao": ("s.transmissao_min", "transmissao"), "aptos": ("s.aptos", "aptos"), "comparecimento": ("s.comparecimento", "comparecimento"),
    "abst_pct": ("s.abst_pct", "abst_pct"), "bn_pct": ("s.bn_pct", "bn_pct"), "margem": ("s.margem_pp", "margem"),
    "brancos": ("s.brancos", "brancos"), "nulos": ("s.nulos", "nulos"),
}


def secoes_query(f: Filters, request: Request, with_votes: bool):
    T = f"t{f.turno}_"
    w, p = where(f)
    qp = request.query_params
    sort = qp.get("sort", "uf")
    sort = sort if sort in SORTS else "uf"
    d = "DESC" if qp.get("dir") == "desc" else "ASC"
    order = f"{SORTS[sort][0]} {d} NULLS LAST, s.sid"
    order_outer = f"page.{SORTS[sort][1]} {d} NULLS LAST, page.sid"
    cands = [int(x) for x in qp.get("c", "").split(",") if x.strip().isdigit()][:8]
    return T, w, p, order, order_outer, cands


@app.get("/api/secoes")
def secoes(request: Request):
    f = flt(request)
    T, w, p, order, order_outer, cands = secoes_query(f, request, True)
    qp = request.query_params
    limit = max(1, min(int(qp.get("limit", 200) or 200), 1000))
    offset = max(0, int(qp.get("offset", 0) or 0))

    def compute():
        total = q(f"SELECT count(*) FROM {T}secao s WHERE {w}", p)[0][0]
        vsel = "".join(f", v.v{i}" for i in range(len(cands)))
        vagg = "".join(f", sum(qt) FILTER (nr=?) v{i}" for i in range(len(cands)))
        sql = f"""WITH page AS (
              SELECT s.sid, s.uf, s.nm_municipio municipio, s.zona, s.secao, l.nome local, l.endereco, l.bairro, s.abertura, s.encerramento,
                s.bu_recebido, s.duracao_min, s.atraso_17h_min atraso, s.transmissao_min transmissao, s.aptos, s.comparecimento, s.abst_pct,
                s.brancos, s.nulos, s.bn_pct, s.tipo_urna, s.n_agregadas, s.venc_nr venc, s.margem_pp margem
              FROM {T}secao s LEFT JOIN {T}locais l USING (uf, cd_municipio, zona, nr_local)
              WHERE {w} ORDER BY {order} LIMIT {limit} OFFSET {offset})
            SELECT page.*{vsel} FROM page LEFT JOIN
              (SELECT sid{vagg} FROM {T}votos WHERE cargo=? AND sid IN (SELECT sid FROM page) GROUP BY sid) v USING (sid)
            ORDER BY {order_outer}"""
        r = rows(sql, p + cands + [f.cargo])
        return clean({"total": total, "offset": offset, "cands": cands, "rows": r})
    return cached(request, compute)


@app.get("/api/export")
def export(request: Request):
    f = flt(request)
    fmt = request.query_params.get("fmt", "csv")
    if fmt not in ("csv", "parquet"):
        raise HTTPException(400, "fmt inválido")
    T, w, p, order, _, _c = secoes_query(f, request, False)
    tmp = Path(tempfile.mkdtemp()) / f"urnaud_secoes.{fmt}"
    opts = "(HEADER, DELIMITER ';')" if fmt == "csv" else "(FORMAT parquet, COMPRESSION zstd)"
    cur().execute(f"""COPY (SELECT s.uf, s.cd_municipio, s.nm_municipio, s.zona, s.secao, l.nome AS local_votacao, l.endereco, l.bairro, l.cep, l.lat, l.lon,
        s.aptos, s.comparecimento, s.abstencoes, s.brancos, s.nulos, s.tipo_urna, s.n_agregadas, s.abertura, s.encerramento, s.emissao_bu, s.bu_recebido,
        s.duracao_min, s.atraso_17h_min, s.transmissao_min, s.abst_pct, s.bn_pct, s.biom_nh_pct, s.venc_nr, s.margem_pp
        FROM {T}secao s LEFT JOIN {T}locais l USING (uf, cd_municipio, zona, nr_local) WHERE {w} ORDER BY {order}) TO '{tmp.as_posix()}' {opts}""", p)
    return FileResponse(tmp, filename=tmp.name, media_type="text/csv" if fmt == "csv" else "application/octet-stream")


# ---------------------------------------------------------------- detalhe
@app.get("/api/secao/{uf}/{zona}/{secao}")
def secao_detail(uf: str, zona: int, secao: int, request: Request):
    if uf not in UFS:
        raise HTTPException(404)
    t = int(request.query_params.get("t", max(TURNOS)))
    if t not in TURNOS:
        raise HTTPException(404)
    T = f"t{t}_"

    def compute():
        base = rows(f"""SELECT s.*, l.nome local, l.endereco, l.bairro, l.cep, l.lat, l.lon FROM {T}secao s
            LEFT JOIN {T}locais l USING (uf, cd_municipio, zona, nr_local) WHERE s.uf=? AND s.zona=? AND s.secao=? ORDER BY s.cargo""", [uf, zona, secao])
        if not base:
            raise HTTPException(404, "seção não encontrada")
        out = []
        for b in base:
            votos = rows(f"""SELECT v.nr, vo.nome, vo.partido, v.qt FROM {T}votos v LEFT JOIN {T}votavel vo
                ON vo.cargo=v.cargo AND vo.nr=v.nr AND vo.escopo=CASE WHEN v.cargo=1 THEN 'BR' ELSE ? END
                WHERE v.sid=? AND v.cargo=? ORDER BY v.qt DESC""", [uf, b["sid"], b["cargo"]])
            mun = rows(f"""SELECT count(*) secoes, avg(abst_pct) abst_pct, avg(bn_pct) bn_pct, avg(duracao_min) duracao_min,
                avg(atraso_17h_min) atraso, avg(transmissao_min) transmissao, avg(aptos) aptos, avg(comp_pct) comp_pct,
                avg(margem_pp) margem FROM {T}secao WHERE uf=? AND cd_municipio=? AND cargo=?""", [uf, b["cd_municipio"], b["cargo"]])[0]
            mv = rows(f"SELECT nr, sum(qt) qt FROM {T}agg_mun_votos WHERE uf=? AND cd_municipio=? AND cargo=? GROUP BY nr", [uf, b["cd_municipio"], b["cargo"]])
            out.append({"secao": b, "cargo": b["cargo"], "votos": votos, "municipio": mun, "votosMunicipio": mv})
        return clean(out)
    return cached(request, compute)


# ---------------------------------------------------------------- busca global
@app.get("/api/search")
def search(request: Request):
    f = flt(request)
    term = request.query_params.get("q", "").strip()[:80]
    T = f"t{f.turno}_"

    def compute():
        if len(term) < 2:
            return []
        res = []
        for m in rows(f"""SELECT uf, cd_municipio, nm_municipio, sum(secoes) secoes FROM {T}agg_mun WHERE cargo=1
            AND contains(strip_accents(lower(nm_municipio)), strip_accents(lower(?))) GROUP BY ALL ORDER BY secoes DESC LIMIT 6""", [term]):
            res.append({"type": "mun", "label": m["nm_municipio"], "sub": f"Município · {m['uf']} · {m['secoes']} seções",
                        "params": {"uf": m["uf"], "mun": m["cd_municipio"]}})
        for l in rows(f"""SELECT uf, cd_municipio, zona, nr_local, nome, bairro, nm_municipio FROM {T}locais
            WHERE contains(busca, strip_accents(lower(?))) LIMIT 8""", [term]):
            res.append({"type": "local", "label": l["nome"], "sub": f"Local · {l['bairro'] or ''} · {l['nm_municipio']} · {l['uf']}",
                        "params": {"uf": l["uf"], "mun": l["cd_municipio"], "local": f"{l['uf']}.{l['cd_municipio']}.{l['zona']}.{l['nr_local']}"}})
        import re
        m = re.fullmatch(r"([A-Za-z]{2})\s+(\d{1,4})\s*[/ -]\s*(\d{1,4})", term)
        if m and m[1].upper() in UFS:
            res.insert(0, {"type": "secao", "label": f"Seção {m[3]} · zona {m[2]} · {m[1].upper()}", "sub": "Abrir detalhe",
                           "params": {"uf": m[1].upper(), "zona": int(m[2]), "secao": int(m[3])}})
        return res
    return cached(request, compute)


@app.get("/api/validacao")
def validacao(request: Request):
    t = int(request.query_params.get("t", max(TURNOS or {1})))
    p = PARQUET / f"t{t}" / "validacao.json"
    if not p.exists():
        raise HTTPException(404, "relatório de validação não gerado (etl/validate.py)")
    return Response(p.read_bytes(), media_type="application/json")


@app.get("/api/health")
def health():
    return {"ok": bool(TURNOS), "turnos": sorted(TURNOS), "cache": len(_cache)}


# malhas do IBGE geradas por etl/geo.py
GEO = Path(os.environ.get("URNAUD_GEO", ROOT / "data" / "geo"))
GEO.mkdir(parents=True, exist_ok=True)
from fastapi.staticfiles import StaticFiles  # noqa: E402

app.mount("/geo", StaticFiles(directory=GEO), name="geo")

# frontend estático (build do Vite) quando disponível: um único processo/container serve tudo
DIST = ROOT / "web" / "dist"
if DIST.exists():
    from starlette.exceptions import HTTPException as StarletteHTTPException

    class SPA(StaticFiles):
        async def get_response(self, path, scope):
            try:
                return await super().get_response(path, scope)
            except StarletteHTTPException as e:
                if e.status_code == 404:
                    return await super().get_response("index.html", scope)
                raise

    app.mount("/", SPA(directory=DIST, html=True), name="web")
