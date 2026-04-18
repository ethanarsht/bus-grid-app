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

# Build frontend
COPY frontend/ frontend/
RUN cd frontend && npm ci && npm run build

# Copy backend
COPY backend/ backend/

# Expose port
EXPOSE 10000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "10000"]
