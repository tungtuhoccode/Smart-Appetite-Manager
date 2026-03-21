FROM ghcr.io/astral-sh/uv:python3.11-trixie-slim AS builder

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv export > requirements.txt

FROM solace/solace-agent-mesh:1.13.3

USER root
COPY --from=builder /app/requirements.txt .
RUN python3.11 -m pip install --no-cache-dir -r requirements.txt
RUN mkdir -p /app/data && chown solaceai:solaceai /app/data

USER solaceai
COPY --chown=solaceai:solaceai configs/ /app/configs/
COPY --chown=solaceai:solaceai src/ /app/src/

WORKDIR /app

CMD ["run", "/app/configs"]
