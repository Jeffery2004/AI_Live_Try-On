FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    HF_HOME=/workspace/huggingface
RUN apt-get update && apt-get install -y --no-install-recommends python3.10 python3-pip git build-essential ninja-build && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN mkdir -p /workspace/huggingface
RUN git clone https://github.com/Zheng-Chong/CatVTON.git catvton
COPY requirements.txt /app/requirements.txt
RUN python3 -m pip install --no-cache-dir --upgrade pip \
    && python3 -m pip install --no-cache-dir -r /app/requirements.txt \
    && python3 -m pip install --no-cache-dir --no-build-isolation --no-deps git+https://github.com/facebookresearch/detectron2.git
COPY app /app/app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"
CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
