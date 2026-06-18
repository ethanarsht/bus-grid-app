FROM python:3.11-slim

# Install Node.js
RUN apt-get update && apt-get install -y curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend first so the frontend build can write into backend/static/
COPY backend/ backend/

# Build frontend (vite outputs to ../backend/static per vite.config.js)
COPY frontend/ frontend/
RUN cd frontend && npm ci && npm run build

# Expose port
EXPOSE 10000

CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
