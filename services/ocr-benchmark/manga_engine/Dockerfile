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

# 1. Install incomplete wheel to run diagnostics
RUN pip install --no-cache-dir git+https://github.com/zyddnys/manga-image-translator.git@efdc229de8aa0f3d4051ad97664adc62dd5ac605

# Diagnostic Step: Print files in built wheel
RUN python -c " \
from importlib.metadata import distribution; \
dist = distribution('manga-image-translator'); \
for file in sorted(str(f) for f in dist.files or []): \
    print(file) \
"

# Diagnostic Step: Print standard paths in site-packages
RUN find /usr/local/lib/python3.10/site-packages/manga_translator -maxdepth 3 -type f | sort

# Uninstall the incomplete wheel completely
RUN pip uninstall -y manga-image-translator

# 2. Pinned source checkout clone
RUN git clone https://github.com/zyddnys/manga-image-translator.git /opt/manga-image-translator
RUN git -C /opt/manga-image-translator checkout efdc229de8aa0f3d4051ad97664adc62dd5ac605

# Verification of checkout
RUN test "$(git -C /opt/manga-image-translator rev-parse HEAD)" = "efdc229de8aa0f3d4051ad97664adc62dd5ac605"
RUN test -f /opt/manga-image-translator/manga_translator/config.py
RUN test -f /opt/manga-image-translator/manga_translator/utils/__init__.py
RUN test -f /opt/manga-image-translator/manga_translator/detection/__init__.py
RUN test -f /opt/manga-image-translator/manga_translator/ocr/__init__.py

# 3. Patch the source checkout directly
COPY patch_manga_package.py .
RUN python patch_manga_package.py /opt/manga-image-translator/manga_translator/__init__.py

# 4. Set PYTHONPATH
ENV PYTHONPATH=/opt/manga-image-translator

# Verify every imported module resolves inside /opt/manga-image-translator
RUN python -c " \
import manga_translator; \
import manga_translator.config; \
import manga_translator.utils; \
import manga_translator.detection; \
import manga_translator.ocr; \
modules = [ \
    manga_translator, \
    manga_translator.config, \
    manga_translator.utils, \
    manga_translator.detection, \
    manga_translator.ocr, \
]; \
for module in modules: \
    print(module.__name__, module.__file__); \
    assert module.__file__.startswith('/opt/manga-image-translator/'); \
"

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
