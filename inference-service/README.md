# CatVTON GPU inference service

This service wraps the official mask-based CatVTON pipeline for upper-body and outerwear try-on. It uses the official `CatVTONPipeline`, `AutoMasker`, `resize_and_crop`, and `resize_and_padding` helpers. It loads checkpoints once on startup and never writes uploads or generated images to disk.

## Deploy on a CUDA GPU host

1. Create a cloud GPU instance with Docker and an NVIDIA GPU. CatVTON’s official documentation reports about 8 GB of VRAM for 768×1024 bf16 inference; this does not include every preprocessing and runtime overhead, so choose a 24 GB GPU for this service.
2. Copy `.env.example` to `.env`, set a strong `SERVICE_API_KEY`, and set `HUGGING_FACE_HUB_TOKEN` only if model access requires it.
3. From this folder, build and run:

```bash
docker build -t virtualfit-catvton .
docker run --gpus all --env-file .env -p 8000:8000 virtualfit-catvton
```

4. While weights load, `GET /health` returns `modelReady: false`; poll `GET /ready` until it returns `200`. `modelReady: true` and `/ready` 200 confirm only that the service loaded. A real `/v1/try-on` request is still required to verify GPU inference.
5. Put the public HTTPS endpoint plus the same service key in `backend/.env` as `CATVTON_API_URL` and `CATVTON_API_KEY`.

## RunPod Pod deployment

RunPod Pods are a practical first deployment target because they run a custom CUDA container and expose an HTTP port. The service is synchronous and should be used for a proof of concept, with one request processed at a time by the GPU lock.

1. Build the image on a machine with Docker, then publish it to a container registry you control:

```bash
docker build -t your-registry/virtualfit-catvton:0.1 .
docker push your-registry/virtualfit-catvton:0.1
```

2. In the RunPod dashboard, create a GPU Pod with one NVIDIA 24 GB GPU such as an RTX 3090 or RTX 4090, your published image, port `8000` exposed as HTTP, and a persistent volume mounted at `/workspace`. The Docker image writes Hugging Face model caches to `/workspace/huggingface`; this avoids downloading the CatVTON checkpoint, base model, DensePose, and SCHP assets again after moving to a replacement Pod.
3. Add the variables from `.env.example` in the Pod environment settings. Set a unique `SERVICE_API_KEY`; do not put it in the image or source repository.
4. Start the Pod. Poll `https://<pod-id>-8000.proxy.runpod.net/health` until it reports `modelReady: true`, then confirm `https://<pod-id>-8000.proxy.runpod.net/ready` returns `200`.
5. Set `CATVTON_API_URL=https://<pod-id>-8000.proxy.runpod.net/v1/try-on` and the same key as `CATVTON_API_KEY` in `backend/.env`, then restart the Node backend.

Stop the Pod when it is not being used to control GPU cost. RunPod documents custom Pod images, exposed HTTP ports, and the proxy URL format in its [Pod reference](https://docs.runpod.io/runpodctl/reference/runpodctl-remove-pods).
