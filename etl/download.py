"""Baixa os dados abertos do TSE (idempotente, retoma por UF).

O BU por UF é convertido em Parquet enxuto (data/stage) logo após o download e o CSV/ZIP bruto é descartado
(SP sozinho tem 1,4 GB compactados / ~10 GB de CSV). Use --keep-raw para manter os arquivos brutos.
"""
import argparse
import os
import shutil
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from etl.stage import stage_zip  # noqa: E402

UFS = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO ZZ".split()
CDN = "https://cdn.tse.jus.br/estatistica/sead"
# O nome do arquivo de BU inclui data/hora de geração; o 2º turno ainda não foi publicado.
BU_NAME = {1: "bweb_1t_{uf}_051020261403.zip"}
ROOT = Path(__file__).resolve().parent.parent
RAW = Path(os.environ.get("URNAUD_RAW", ROOT / "data" / "raw"))
STAGE = Path(os.environ.get("URNAUD_STAGE", RAW.parent / "stage"))
EXTRAS = {  # nome -> (url, mantém CSV extraído?)
    "locais": f"{CDN}/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip",
    "munzona": f"{CDN}/odsele/votacao_candidato_munzona/votacao_candidato_munzona_2026.zip",
    "detalhe_secao": f"{CDN}/odsele/detalhe_votacao_secao/detalhe_votacao_secao_2026.zip",
}


def fetch(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(8):  # retoma de onde parou (HTTP Range) se a conexão cair
        have = tmp.stat().st_size if tmp.exists() else 0
        req = urllib.request.Request(url, headers={"User-Agent": "urnaud-etl/1.0", **({"Range": f"bytes={have}-"} if have else {})})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                if have and r.status != 206:
                    have = 0
                with open(tmp, "ab" if have else "wb") as f:
                    shutil.copyfileobj(r, f, 1 << 20)
            break
        except Exception as e:  # noqa: BLE001
            print("retry", dest.name, attempt, e, flush=True)
            if attempt == 7:
                raise
    tmp.rename(dest)
    print("ok", dest.name, dest.stat().st_size // 1024, "KB", flush=True)
    return dest


def do_uf(uf: str, turno: int, keep_raw: bool):
    out = STAGE / f"t{turno}" / f"{uf}.parquet"
    if out.exists():
        return
    d = RAW / f"bu{turno}t" / uf
    zp = fetch(f"{CDN}/eleicoes/eleicoes2026/buweb/{BU_NAME[turno].format(uf=uf)}", d / f"{uf}.zip")
    n = stage_zip(zp, out)
    print(f"staged {uf}: {n:,} linhas", flush=True)
    if not keep_raw:
        shutil.rmtree(d)
    elif not any(d.glob("*.csv")):
        with zipfile.ZipFile(zp) as z:
            z.extractall(d)


def do_extra(name: str, keep_raw: bool):
    d = RAW / name
    if any(d.glob("*.csv")) or (d / "done").exists():
        return
    zp = fetch(EXTRAS[name], d / f"{name}.zip")
    with zipfile.ZipFile(zp) as z:
        for m in z.namelist():
            # locais: só o arquivo nacional (os por UF são cópias); demais: tudo
            if name == "locais" and m.endswith(".csv") and "BRASIL" not in m:
                continue
            z.extract(m, d)
    zp.unlink()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--turno", type=int, default=1, choices=[1, 2])
    ap.add_argument("--ufs", nargs="*", default=UFS)
    ap.add_argument("--extras", action="store_true", help="locais de votação + arquivos de conferência")
    ap.add_argument("--keep-raw", action="store_true")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--only-extras", action="store_true")
    ap.add_argument("--no-extras", action="store_true", help="ignora --extras (útil p/ rodar em paralelo)")
    a = ap.parse_args()
    if a.turno not in BU_NAME:
        sys.exit("BU do 2º turno ainda não publicado pelo TSE: ajuste BU_NAME em etl/download.py quando sair.")
    if a.extras and not a.no_extras:
        for name in EXTRAS:
            do_extra(name, a.keep_raw)
    if a.only_extras:
        return
    with ThreadPoolExecutor(a.workers) as ex:
        list(ex.map(lambda u: do_uf(u, a.turno, a.keep_raw), a.ufs))


if __name__ == "__main__":
    main()
