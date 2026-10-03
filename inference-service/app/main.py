import io
import os
import sys
import threading
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError

MAX_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 24_000_000
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MODEL_LOCK = threading.Lock()
MODEL_STATE = {"ready": False, "error": None, "pipeline": None, "automasker": None, "mask_processor": None, "torch": None, "resize_and_crop": None, "resize_and_padding": None}


def settings():
    return {"repo": os.getenv("CATVTON_REPO_PATH", "/app/catvton"), "checkpoint": os.getenv("CATVTON_CHECKPOINT", "zhengchong/CatVTON"), "base_model": os.getenv("CATVTON_BASE_MODEL", "booksforcharlie/stable-diffusion-inpainting"), "device": os.getenv("CATVTON_DEVICE", "cuda"), "precision": os.getenv("CATVTON_PRECISION", "bf16"), "width": int(os.getenv("CATVTON_WIDTH", "768")), "height": int(os.getenv("CATVTON_HEIGHT", "1024")), "steps": int(os.getenv("CATVTON_STEPS", "30")), "guidance": float(os.getenv("CATVTON_GUIDANCE_SCALE", "2.5"))}


def load_model():
    config = settings()
    if not os.path.isdir(config["repo"]): raise RuntimeError("CATVTON_REPO_PATH does not exist. Mount or clone the official CatVTON repository before startup.")
    # CatVTON bundles a CPython 3.9 Detectron2 extension. The container builds a
    # matching Detectron2 extension for its own Python version, so site-packages
    # must take precedence over the bundled source directory.
    if config["repo"] not in sys.path:
        sys.path.append(config["repo"])
    import torch
    from diffusers.image_processor import VaeImageProcessor
    from huggingface_hub import snapshot_download
    from model.cloth_masker import AutoMasker
    from model.pipeline import CatVTONPipeline
    from utils import init_weight_dtype, resize_and_crop, resize_and_padding
    if config["device"] == "cuda" and not torch.cuda.is_available(): raise RuntimeError("CUDA is unavailable. Deploy this service on a CUDA GPU instance.")
    checkpoint_path = snapshot_download(repo_id=config["checkpoint"], token=os.getenv("HUGGING_FACE_HUB_TOKEN") or None)
    MODEL_STATE.update({"pipeline": CatVTONPipeline(base_ckpt=config["base_model"], attn_ckpt=checkpoint_path, attn_ckpt_version="mix", weight_dtype=init_weight_dtype(config["precision"]), use_tf32=True, device=config["device"]), "automasker": AutoMasker(densepose_ckpt=os.path.join(checkpoint_path, "DensePose"), schp_ckpt=os.path.join(checkpoint_path, "SCHP"), device=config["device"]), "mask_processor": VaeImageProcessor(vae_scale_factor=8, do_normalize=False, do_binarize=True, do_convert_grayscale=True), "torch": torch, "resize_and_crop": resize_and_crop, "resize_and_padding": resize_and_padding, "ready": True, "error": None})


@asynccontextmanager
async def lifespan(_app):
    def initialize():
        try:
            load_model()
        except Exception as error:
            MODEL_STATE["error"] = str(error)
    threading.Thread(target=initialize, name="catvton-loader", daemon=True).start()
    yield


app = FastAPI(title="VirtualFit CatVTON Inference", lifespan=lifespan)


def require_service_key(authorization: Optional[str] = Header(default=None)):
    expected = os.getenv("SERVICE_API_KEY")
    if not expected or authorization != f"Bearer {expected}": raise HTTPException(status_code=401, detail="Unauthorized inference request.")


async def read_image(upload: UploadFile, label: str) -> Image.Image:
    if upload.content_type not in ALLOWED_TYPES: raise HTTPException(status_code=415, detail=f"{label} must be a JPG, PNG, or WEBP image.")
    content = await upload.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES: raise HTTPException(status_code=413, detail=f"{label} exceeds the 10 MB limit.")
    try:
        image = Image.open(io.BytesIO(content)); image.verify()
        image = Image.open(io.BytesIO(content)).convert("RGB")
        if image.width * image.height > MAX_PIXELS: raise HTTPException(status_code=413, detail=f"{label} has too many pixels.")
        return image
    except UnidentifiedImageError as error: raise HTTPException(status_code=415, detail=f"{label} is not a readable image.") from error


@app.get("/health")
def health(): return {"status": "ok", "modelReady": MODEL_STATE["ready"]}


@app.get("/ready")
def ready():
    if not MODEL_STATE["ready"]: raise HTTPException(status_code=503, detail="Model is not ready.")
    return {"status": "ready"}


@app.post("/v1/try-on", dependencies=[Depends(require_service_key)])
async def try_on(person: UploadFile = File(...), garment: UploadFile = File(...), category: str = Form(...)):
    if not MODEL_STATE["ready"]: raise HTTPException(status_code=503, detail="CatVTON is not ready. Check the service health endpoint.")
    if category not in {"upper", "outer"}: raise HTTPException(status_code=400, detail="Only upper and outer body categories are supported.")
    person_image, garment_image = await read_image(person, "Person image"), await read_image(garment, "Garment image")
    config = settings()
    try:
        with MODEL_LOCK, MODEL_STATE["torch"].inference_mode():
            person_image = MODEL_STATE["resize_and_crop"](person_image, (config["width"], config["height"]))
            garment_image = MODEL_STATE["resize_and_padding"](garment_image, (config["width"], config["height"]))
            mask = MODEL_STATE["automasker"](person_image, category)["mask"]
            mask = MODEL_STATE["mask_processor"].blur(mask, blur_factor=9)
            result = MODEL_STATE["pipeline"](image=person_image, condition_image=garment_image, mask=mask, num_inference_steps=config["steps"], guidance_scale=config["guidance"], generator=None)[0]
        output = io.BytesIO(); result.save(output, format="PNG")
        return Response(content=output.getvalue(), media_type="image/png", headers={"Cache-Control": "no-store"})
    except RuntimeError as error:
        if "out of memory" in str(error).lower():
            MODEL_STATE["torch"].cuda.empty_cache()
            raise HTTPException(status_code=503, detail="The GPU is temporarily out of memory. Try again shortly.") from error
        raise HTTPException(status_code=500, detail="CatVTON inference failed.") from error
    except Exception as error: raise HTTPException(status_code=500, detail="CatVTON inference failed.") from error
