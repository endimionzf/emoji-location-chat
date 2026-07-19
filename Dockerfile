FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

WORKDIR /app

# Install system dependencies for UMAP / scikit-learn
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install dependencies (torch is already installed, so this will be fast)
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY app /app/app

EXPOSE 8000

# Entry script will run indexing (using GPU if available) and start uvicorn (which runs on CPU by default)
CMD ["sh", "-c", "python -m app.indexer && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
