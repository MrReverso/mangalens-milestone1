FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    fonts-dejavu-core \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN python -m pip check

COPY orchestrator.py .
COPY test_orchestrator.py .
COPY authentic_benchmark.py .
COPY generate_benchmark_samples.py .
COPY test_authentic_benchmark.py .

# We can run pytest by default
ENTRYPOINT ["pytest", "-v"]
