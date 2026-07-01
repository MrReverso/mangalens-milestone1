FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install manga-image-translator
RUN pip install --no-cache-dir git+https://github.com/zyddnys/manga-image-translator.git@efdc229de8aa0f3d4051ad97664adc62dd5ac605

# Verify dependencies are correct and do not conflict
RUN python -m pip check

# Print installed dependencies for GHA build log traceability
RUN python -m pip freeze

# Verify registries are present and import correctly
COPY verify_manga_registry.py .
RUN python verify_manga_registry.py

# Copy app code
COPY app.py .

EXPOSE 8002

ENTRYPOINT ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8002"]
