#!/bin/sh
# espera todos os downloads terminarem
while [ "$(ls data/stage/t1/*.parquet 2>/dev/null | grep -vc 'part')" -lt 28 ] || ! ls data/raw/munzona/*.csv >/dev/null 2>&1 || ! ls data/raw/detalhe_secao/*.csv >/dev/null 2>&1; do sleep 20; done
echo done
