"""Construção segura (parametrizada) das cláusulas WHERE a partir da query string.

Nada vindo do usuário é concatenado ao SQL: identificadores vêm de whitelists e valores vão como parâmetros.
"""
from __future__ import annotations

from dataclasses import dataclass, field

UFS = {
    "AC": ("Acre", "Norte"), "AL": ("Alagoas", "Nordeste"), "AM": ("Amazonas", "Norte"), "AP": ("Amapá", "Norte"),
    "BA": ("Bahia", "Nordeste"), "CE": ("Ceará", "Nordeste"), "DF": ("Distrito Federal", "Centro-Oeste"),
    "ES": ("Espírito Santo", "Sudeste"), "GO": ("Goiás", "Centro-Oeste"), "MA": ("Maranhão", "Nordeste"),
    "MG": ("Minas Gerais", "Sudeste"), "MS": ("Mato Grosso do Sul", "Centro-Oeste"), "MT": ("Mato Grosso", "Centro-Oeste"),
    "PA": ("Pará", "Norte"), "PB": ("Paraíba", "Nordeste"), "PE": ("Pernambuco", "Nordeste"), "PI": ("Piauí", "Nordeste"),
    "PR": ("Paraná", "Sul"), "RJ": ("Rio de Janeiro", "Sudeste"), "RN": ("Rio Grande do Norte", "Nordeste"),
    "RO": ("Rondônia", "Norte"), "RR": ("Roraima", "Norte"), "RS": ("Rio Grande do Sul", "Sul"),
    "SC": ("Santa Catarina", "Sul"), "SE": ("Sergipe", "Nordeste"), "SP": ("São Paulo", "Sudeste"),
    "TO": ("Tocantins", "Norte"), "ZZ": ("Exterior", "Exterior"),
}
CARGOS = {1: "Presidente", 3: "Governador"}

# Colunas numéricas filtráveis por faixa (parâmetro r=campo:min:max). {T} = prefixo do turno.
ELECTION_DAY = {1: "2026-10-04", 2: "2026-10-25"}
RANGE_EXPR = {
    "aptos": "s.aptos", "comp_pct": "s.comp_pct", "abst_pct": "s.abst_pct", "bn_pct": "s.bn_pct",
    "brancos_pct": "s.brancos_pct", "nulos_pct": "s.nulos_pct", "biom_pct": "s.biom_nh_pct",
    "margem": "s.margem_pp", "duracao": "s.duracao_min", "atraso": "s.atraso_17h_min",
    "transmissao": "s.transmissao_min",
    # minutos desde 00:00 do dia da eleição (horário local da UF; o BU recebido, horário de Brasília)
    "abertura": "date_diff('minute', TIMESTAMP '{D} 00:00:00', s.abertura)",
    "encerramento": "date_diff('minute', TIMESTAMP '{D} 00:00:00', s.encerramento)",
    "bu": "date_diff('minute', TIMESTAMP '{D} 00:00:00', s.bu_recebido)",
}


def _ints(vals: list[str], lim=2000) -> list[int]:
    out = []
    for v in vals[:lim]:
        try:
            out.append(int(v))
        except ValueError:
            pass
    return out


def _multi(qp, key) -> list[str]:
    out = []
    for raw in qp.getlist(key):
        out += [x for x in raw.split(",") if x != ""]
    return out


def _num(x: str):
    try:
        return float(x) if x != "" else None
    except ValueError:
        return None


@dataclass
class Filters:
    turno: int = 1
    cargo: int = 1
    uf: list[str] = field(default_factory=list)
    mun: list[int] = field(default_factory=list)
    zona: list[int] = field(default_factory=list)
    secao: list[int] = field(default_factory=list)
    local: list[tuple] = field(default_factory=list)
    venc: list[int] = field(default_factory=list)
    tipo_urna: list[str] = field(default_factory=list)
    agregada: str | None = None
    depois17: bool = False
    q: str = ""
    ranges: list[tuple] = field(default_factory=list)  # (campo, min, max)
    cands: list[tuple] = field(default_factory=list)  # (nr, min, max) % dos votos válidos

    def key(self) -> str:
        return repr(self.__dict__)

    @staticmethod
    def parse(qp, turnos_ok: set[int]) -> "Filters":
        f = Filters()
        t = _ints([qp.get("t", "")])
        f.turno = t[0] if t and t[0] in turnos_ok else max(turnos_ok)
        c = _ints([qp.get("cargo", "1")])
        f.cargo = c[0] if c and c[0] in CARGOS else 1
        f.uf = [u for u in _multi(qp, "uf") if u in UFS]
        f.mun = _ints(_multi(qp, "mun"))
        f.zona = _ints(_multi(qp, "zona"))
        f.secao = _ints(_multi(qp, "secao"))
        for lc in _multi(qp, "local")[:500]:
            parts = lc.split(".")
            if len(parts) == 4 and parts[0] in UFS:
                n = _ints(parts[1:])
                if len(n) == 3:
                    f.local.append((parts[0], *n))
        f.venc = _ints(_multi(qp, "venc"))
        f.tipo_urna = [x[:40] for x in _multi(qp, "tipo_urna")][:10]
        ag = qp.get("agregada")
        f.agregada = ag if ag in ("0", "1") else None
        f.depois17 = qp.get("depois17") == "1"
        f.q = qp.get("q", "").strip()[:80]
        for r in qp.getlist("r"):
            p = r.split(":")
            if len(p) == 3 and p[0] in RANGE_EXPR:
                f.ranges.append((p[0], _num(p[1]), _num(p[2])))
        for r in qp.getlist("cand"):
            p = r.split(":")
            if len(p) == 3 and p[0].isdigit():
                f.cands.append((int(p[0]), _num(p[1]), _num(p[2])))
        return f


def where(f: Filters, exclude: str | None = None) -> tuple[str, list]:
    """Retorna (SQL, params) sobre a tabela `s` (secao do turno). `exclude` ignora o filtro de uma dimensão (facetas)."""
    T, D = f"t{f.turno}_", ELECTION_DAY.get(f.turno, "2026-10-04")
    cl, pr = ["s.cargo = ?"], [f.cargo]

    def inlist(col, vals, name):
        if vals and exclude != name:
            cl.append(f"{col} IN ({','.join('?' * len(vals))})")
            pr.extend(vals)

    inlist("s.uf", f.uf, "uf")
    inlist("s.cd_municipio", f.mun, "mun")
    inlist("s.zona", f.zona, "zona")
    inlist("s.secao", f.secao, "secao")
    inlist("s.tipo_urna", f.tipo_urna, "tipo_urna")
    inlist("s.venc_nr", f.venc, "venc")
    if f.local and exclude != "local":
        cl.append("(s.uf, s.cd_municipio, s.zona, s.nr_local) IN (" + ",".join(["(?,?,?,?)"] * len(f.local)) + ")")
        for t in f.local:
            pr.extend(t)
    if f.agregada is not None and exclude != "agregada":
        cl.append("s.n_agregadas > 0" if f.agregada == "1" else "s.n_agregadas = 0")
    if f.depois17 and exclude != "depois17":
        cl.append("s.atraso_17h_min > 10")
    if f.q and exclude != "q":
        cl.append(f"(s.uf, s.cd_municipio, s.zona, s.nr_local) IN (SELECT uf, cd_municipio, zona, nr_local FROM {T}locais "
                  "WHERE contains(busca, strip_accents(lower(?))))")
        pr.append(f.q)
    for campo, lo, hi in f.ranges:
        if exclude == campo:
            continue
        e = RANGE_EXPR[campo].replace("{D}", D)
        if lo is not None:
            cl.append(f"{e} >= ?")
            pr.append(lo)
        if hi is not None:
            cl.append(f"{e} <= ?")
            pr.append(hi)
    for nr, lo, hi in f.cands:
        sub = f"s.sid IN (SELECT v.sid FROM {T}votos v JOIN {T}secao s2 ON s2.sid=v.sid AND s2.cargo=v.cargo " \
              f"WHERE v.cargo=? AND v.nr=? AND s2.nominais+s2.legenda>0"
        sp = [f.cargo, nr]
        if lo is not None:
            sub += " AND 100.0*v.qt/(s2.nominais+s2.legenda) >= ?"
            sp.append(lo)
        if hi is not None:
            sub += " AND 100.0*v.qt/(s2.nominais+s2.legenda) <= ?"
            sp.append(hi)
        cl.append(sub + ")")
        pr.extend(sp)
    return " AND ".join(cl), pr
