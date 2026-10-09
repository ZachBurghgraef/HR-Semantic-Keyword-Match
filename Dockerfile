# Use an official Python runtime as base image
FROM python:3.12-slim

# Set working directory inside container
WORKDIR /app

# Copy requirements first (Docker caches this layer for speed)
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy your application code
COPY . .

# Expose port (Lambda ignores this)
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retires=3 \
    CMD python -c "import requests; requests.get('https://localhost:8000/health')"

# Command to run the app
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--timeout", "120", "--workers", "1", "worker-class", "uvicorn.workers.UvicornWorker", "app:app"]