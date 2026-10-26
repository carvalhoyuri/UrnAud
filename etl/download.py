"""Baixa os dados abertos do TSE necessários ao ETL (idempotente, retoma downloads)."""
import argparse
import os
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import urllib.request

UFS = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO ZZ".split()
CDN = "https://cdn.tse.jus.br/estatistica/sead"
# O nome do arquivo de BU inclui data/hora de geração; o 2º turno ainda não foi publicado.
BU_NAME = {1: "bweb_1t_{uf}_051020261403.zip"}
RAW = Path(os.environ.get("URNAUD_RAW", Path(__file__).resolve().parent.parent / "data" / "raw"))


def fetch(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "urnaud-etl/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.rename(dest)
    print("ok", dest.name, dest.stat().st_size // 1024, "KB", flush=True)
    return dest


def unzip(zp: Path, out: Path):
    if out.exists() and any(out.glob("*.csv")):
        return
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zp) as z:
        z.extractall(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--turno", type=int, default=1, choices=[1, 2])
    ap.add_argument("--ufs", nargs="*", default=UFS)
    ap.add_argument("--extras", action="store_true", help="locais de votação + votação/detalhe por seção")
    a = ap.parse_args()
    if a.turno not in BU_NAME:
        sys.exit("BU do 2º turno ainda não publicado pelo TSE: ajuste BU_NAME em etl/download.py quando sair.")

    def one(uf):
        url = f"{CDN}/eleicoes/eleicoes2026/buweb/{BU_NAME[a.turno].format(uf=uf)}"
        zp = fetch(url, RAW / f"bu{a.turno}t" / uf / f"{uf}.zip")
        unzip(zp, RAW / f"bu{a.turno}t" / uf)

    with ThreadPoolExecutor(4) as ex:
        list(ex.map(one, a.ufs))
    if a.extras:
        for name, url in {
            "locais": f"{CDN}/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip",
            "detalhe_secao": f"{CDN}/odsele/detalhe_votacao_secao/detalhe_votacao_secao_2026.zip",
            "votacao_secao_br": f"{CDN}/odsele/votacao_secao/votacao_secao_2026_BR.zip",
        }.items():
            zp = fetch(url, RAW / name / f"{name}.zip")
            unzip(zp, RAW / name)


if __name__ == "__main__":
    main()
