# Trellis EHR — Voice Relay Service
# Build context: backend/ (run from repo root: docker build -f backend/relay/Dockerfile backend/)

FROM python:3.12-slim

# Security: run as non-root
RUN groupadd -r trellis && useradd -r -g trellis -d /app -s /sbin/nologin trellis

WORKDIR /app

# Install dependencies first (cache layer)
COPY relay/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy shared modules (used via sys.path.insert)
COPY shared/ ./shared/

# Copy relay service code
COPY relay/ ./

# Own files as non-root user
RUN chown -R trellis:trellis /app

USER trellis

EXPOSE 8080

# Health check for Cloud Run / container orchestration
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')" || exit 1

# Single worker for WebSocket relay (uvicorn WebSocket requires single process)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
