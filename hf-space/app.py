"""Gradio + ZeroGPU wrapper around the official CatVTON mask-based pipeline."""
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path

import gradio as gr
import spaces
import torch
from diffusers.image_processor import VaeImageProcessor
from huggingface_hub import snapshot_download
from PIL import Image

SPACE_ROOT = Path(__file__).resolve().parent
CATVTON_ROOT = SPACE_ROOT / "CatVTON"
CATVTON_REPOSITORY = "https://github.com/Zheng-Chong/CatVTON.git"
CHECKPOINT = "zhengchong/CatVTON"
BASE_MODEL = "booksforcharlie/stable-diffusion-inpainting"
WIDTH, HEIGHT = 768, 1024
MODEL_LOCK = threading.Lock()


def ensure_catvton_source():
    if not CATVTON_ROOT.exists():
        subprocess.check_call(["git", "clone", "--depth", "1", CATVTON_REPOSITORY, str(CATVTON_ROOT)])
    if str(CATVTON_ROOT) not in sys.path:
        # Keep site-packages first. CatVTON's vendored Detectron2 extension is
        # built for CPython 3.9, while this Space builds Detectron2 for the
        # active ZeroGPU Python/PyTorch environment.
        sys.path.append(str(CATVTON_ROOT))


def ensure_detectron2():
    # This follows the official CatVTON ZeroGPU Space pattern: build the native
    # dependency for the Space's current Python and PyTorch environment.
    try:
        import detectron2  # noqa: F401
    except ImportError:
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", "--no-build-isolation", "--no-deps",
            "git+https://github.com/facebookresearch/detectron2.git",
        ])


ensure_catvton_source()
torch.jit.script = lambda function: function
ensure_detectron2()

from model.cloth_masker import AutoMasker  # noqa: E402
from model.pipeline import CatVTONPipeline  # noqa: E402
from utils import init_weight_dtype, resize_and_crop, resize_and_padding  # noqa: E402

# ZeroGPU provides CUDA emulation during startup. Per Hugging Face guidance,
# models are placed on CUDA at module scope and GPU work is decorated below.
checkpoint_path = snapshot_download(repo_id=CHECKPOINT, token=os.getenv("HF_TOKEN") or None)
pipeline = CatVTONPipeline(
    base_ckpt=BASE_MODEL,
    attn_ckpt=checkpoint_path,
    attn_ckpt_version="mix",
    weight_dtype=init_weight_dtype("bf16"),
    use_tf32=True,
    device="cuda",
)
automasker = AutoMasker(
    densepose_ckpt=os.path.join(checkpoint_path, "DensePose"),
    schp_ckpt=os.path.join(checkpoint_path, "SCHP"),
    device="cuda",
)
mask_processor = VaeImageProcessor(
    vae_scale_factor=8,
    do_normalize=False,
    do_binarize=True,
    do_convert_grayscale=True,
)


@spaces.GPU(duration=120)
def try_on(person: Image.Image, garment: Image.Image, category: str):
    if person is None or garment is None:
        raise gr.Error("Person and garment images are required.")
    if category not in {"upper", "outer"}:
        raise gr.Error("Only upper-body and outerwear categories are supported.")
    try:
        with MODEL_LOCK, torch.inference_mode():
            person = resize_and_crop(person.convert("RGB"), (WIDTH, HEIGHT))
            garment = resize_and_padding(garment.convert("RGB"), (WIDTH, HEIGHT))
            mask = automasker(person, category)["mask"]
            mask = mask_processor.blur(mask, blur_factor=9)
            return pipeline(
                image=person,
                condition_image=garment,
                mask=mask,
                num_inference_steps=30,
                guidance_scale=2.5,
                generator=None,
            )[0]
    except RuntimeError as error:
        if "out of memory" in str(error).lower():
            torch.cuda.empty_cache()
            raise gr.Error("The allocated GPU ran out of memory. Try again later.") from error
        raise gr.Error("CatVTON inference failed. Check Space logs for model startup errors.") from error
    finally:
        # CatVTON DensePose writes temporary intermediates under this directory.
        shutil.rmtree(SPACE_ROOT / "densepose_" / "tmp", ignore_errors=True)


with gr.Blocks(title="VirtualFit AI — CatVTON") as demo:
    gr.Markdown("# VirtualFit AI — CatVTON\nUpload a clear person photo and an upper-body garment image.")
    with gr.Row():
        person_input = gr.Image(type="pil", label="Person image")
        garment_input = gr.Image(type="pil", label="Garment image")
    category_input = gr.Radio(["upper", "outer"], value="upper", label="Garment category")
    submit = gr.Button("Generate try-on")
    result = gr.Image(type="pil", label="Generated CatVTON result")
    submit.click(try_on, [person_input, garment_input, category_input], result, api_name="try_on")

demo.queue(default_concurrency_limit=1).launch()
