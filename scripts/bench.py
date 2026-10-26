"""Mede a latência da API (sem cache: cada requisição leva um parâmetro `_` único).

Uso: python scripts/bench.py [http://127.0.0.1:8000] [repeticoes]
"""
import statistics
import sys
import time
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
N = int(sys.argv[2]) if len(sys.argv) > 2 else 30

CASES = {
    "summary Brasil": "summary?cargo=1",
    "summary UF=SP": "summary?cargo=1&uf=SP",
    "summary 3 filtros (UF, abst 10-30%, encerr. >10min após 17h)": "summary?cargo=1&uf=SP,MG&r=abst_pct:10:30&depois17=1",
    "summary % candidato 22 entre 40-60%": "summary?cargo=1&cand=22:40:60",
    "facets/mun (UF=MG)": "facets/mun?uf=MG&limit=300",
    "facets/uf (filtro horário)": "facets/uf?r=encerramento:1030:1100",
    "histogram/encerramento Brasil": "histogram/encerramento?bins=40",
    "histogram/abst_pct UF=BA": "histogram/abst_pct?uf=BA&bins=32",
    "horarios/cumulativo Brasil": "horarios/cumulativo",
    "map/uf": "map/uf?cargo=1",
    "map/mun (UF=SP)": "map/mun?cargo=1&uf=SP",
    "points UF=SP": "points?uf=SP",
    "secoes página 1 (Brasil, ordenado por atraso)": "secoes?sort=atraso&dir=desc&limit=200&c=13,22",
    "secoes página profunda (offset 400000)": "secoes?sort=uf&limit=200&offset=400000&c=13,22",
    "secoes busca texto 'escola'": "secoes?q=escola&uf=RJ&limit=200",
}


def timed(path: str, i: int) -> float:
    sep = "&" if "?" in path else "?"
    t = time.perf_counter()
    with urllib.request.urlopen(f"{BASE}/api/{path}{sep}_={i}-{time.time_ns()}") as r:
        r.read()
    return (time.perf_counter() - t) * 1000


print(f"{'consulta':62} {'p50':>7} {'p95':>7} {'max':>7}  (ms, {N} reqs sem cache)")
worst = 0.0
for name, path in CASES.items():
    timed(path, -1)  # aquece
    xs = sorted(timed(path, i) for i in range(N))
    p95 = xs[min(len(xs) - 1, int(0.95 * len(xs)))]
    worst = max(worst, p95)
    print(f"{name:62} {statistics.median(xs):7.1f} {p95:7.1f} {xs[-1]:7.1f}")
print(f"\npior p95: {worst:.1f} ms (meta: < 300 ms nas consultas agregadas)")
