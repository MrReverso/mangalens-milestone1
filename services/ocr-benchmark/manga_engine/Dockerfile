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

# 1. Pinned source checkout clone (shallow deterministic fetch)
RUN git init /opt/manga-image-translator \
    && git -C /opt/manga-image-translator remote add origin https://github.com/zyddnys/manga-image-translator.git \
    && git -C /opt/manga-image-translator fetch --depth 1 origin efdc229de8aa0f3d4051ad97664adc62dd5ac605 \
    && git -C /opt/manga-image-translator checkout FETCH_HEAD \
    && test "$(git -C /opt/manga-image-translator rev-parse HEAD)" = "efdc229de8aa0f3d4051ad97664adc62dd5ac605"

# Verification of directories
RUN test -f /opt/manga-image-translator/manga_translator/config.py
RUN test -f /opt/manga-image-translator/manga_translator/utils/__init__.py
RUN test -f /opt/manga-image-translator/manga_translator/detection/__init__.py
RUN test -f /opt/manga-image-translator/manga_translator/ocr/__init__.py

# 2. Patch the source checkout directly
COPY patch_manga_package.py .
RUN python patch_manga_package.py /opt/manga-image-translator/manga_translator/__init__.py

# 3. Set PYTHONPATH
ENV PYTHONPATH=/opt/manga-image-translator

# 4. Verify source imports
COPY verify_source_imports.py .
RUN python verify_source_imports.py

# Verify dependencies are correct and do not conflict
RUN python -m pip check

# Print installed dependencies for GHA build log traceability
RUN python -m pip freeze

# Verify registries from source
COPY verify_manga_registry.py .
RUN python verify_manga_registry.py

# Copy app code
COPY app.py .

EXPOSE 8002

ENTRYPOINT ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8002"]
