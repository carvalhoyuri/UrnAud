# --- frontend ---
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- API + ETL ---
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY api ./api
COPY etl ./etl
COPY scripts ./scripts
COPY --from=web /app/web/dist ./web/dist
ENV URNAUD_DATA=/data/parquet URNAUD_GEO=/data/geo URNAUD_RAW=/data/raw URNAUD_TURNO=1
VOLUME /data
EXPOSE 8000
CMD ["sh", "scripts/entrypoint.sh"]
