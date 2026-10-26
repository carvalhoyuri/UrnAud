#!/bin/sh
# Na primeira subida (volume /data vazio) baixa os dados do TSE e roda o ETL; depois só serve a API.
set -e
if [ ! -f "$URNAUD_DATA/t${URNAUD_TURNO:-1}/secao.parquet" ]; then
  echo "[urnaud] dados não encontrados: baixando e processando (pode levar vários minutos)..."
  python etl/download.py --turno "${URNAUD_TURNO:-1}" --extras
  python etl/build.py --turno "${URNAUD_TURNO:-1}"
  python etl/validate.py --turno "${URNAUD_TURNO:-1}" || echo "[urnaud] AVISO: validação com divergências, veja /api/validacao"
  python etl/geo.py --turno "${URNAUD_TURNO:-1}" || echo "[urnaud] AVISO: malhas do IBGE não geradas"
fi
exec python -m uvicorn api.main:app --host 0.0.0.0 --port "${PORT:-8000}"
