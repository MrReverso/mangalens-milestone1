FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1-mesa-glx \
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

# Verify dependencies are correct and do not conflict
RUN python -m pip check

# Copy app code
COPY app.py .

EXPOSE 8003

ENTRYPOINT ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8003"]
