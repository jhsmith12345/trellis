# Trellis EHR — API Service
# Build context: backend/ (run from repo root: docker build -f backend/api/Dockerfile backend/)

FROM python:3.12-slim

# Security: run as non-root
RUN groupadd -r trellis && useradd -r -g trellis -d /app -s /sbin/nologin trellis

WORKDIR /app

# Install dependencies first (cache layer)
COPY api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy shared modules (used via sys.path.insert)
COPY shared/ ./shared/

# Copy API service code
COPY api/ ./

# Own files as non-root user
RUN chown -R trellis:trellis /app

USER trellis

EXPOSE 8080

# Health check for Cloud Run / container orchestration
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "2"]
