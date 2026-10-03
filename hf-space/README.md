---
title: VirtualFit AI CatVTON
emoji: 👕
colorFrom: yellow
colorTo: gray
sdk: gradio
sdk_version: 5.49.1
python_version: 3.10.13
app_file: app.py
pinned: false
---

# VirtualFit AI — CatVTON ZeroGPU Space

This is a Hugging Face Gradio Space wrapper for the official [CatVTON](https://github.com/Zheng-Chong/CatVTON) mask-based try-on pipeline. It supports upper-body and outerwear garments and exposes a named Gradio API endpoint, `/try_on`.

## What this Space loads

- CatVTON checkpoint: `zhengchong/CatVTON`
- Base inpainting model: `booksforcharlie/stable-diffusion-inpainting`
- VAE: `stabilityai/sd-vae-ft-mse` (loaded by the official CatVTON pipeline)
- CatVTON's bundled DensePose and SCHP checkpoints, used by `AutoMasker`

The application clones CatVTON at Space startup. Model weights are cached by the Hugging Face runtime between requests when the Space cache is available, but a cold restart can download them again. The Space never writes input or result images as permanent application data; CatVTON's temporary DensePose directory is deleted after every request.

## ZeroGPU eligibility and limits

ZeroGPU must be selected in the Space **Settings → Hardware** after the Space is created. It is only available for Gradio Spaces. Free personal accounts in good standing, with a verified email and at least 30 days of account age, can host up to two ZeroGPU Spaces. A free account has a 5-minute daily GPU quota, so one or more CatVTON runs may exhaust it. Queueing and cold starts are expected.

If ZeroGPU is unavailable for your account, do not select paid hardware for this proof of concept. The Space can remain on CPU Basic while you resolve eligibility, but CatVTON generation will not work there.

## Deploy from Windows

1. Sign in to Hugging Face, verify your email, then create a new **Gradio** Space named `virtualfit-catvton`. Do not select Docker. In **Settings → Hardware**, select ZeroGPU only if it is available for your account.
2. In PowerShell, create a dedicated local clone of the Space repository, then copy only this `hf-space` folder's contents into that clone:

   ```powershell
   $spacePath = "$HOME\Desktop\virtualfit-catvton-space"
   git clone https://huggingface.co/spaces/<your-hf-username>/virtualfit-catvton $spacePath
   Copy-Item -Recurse -Force C:\Users\Admin\Desktop\coding\AI_Live_Try-On\hf-space\* $spacePath
   Set-Location $spacePath
   git add .
   git commit -m "Deploy CatVTON ZeroGPU Space"
   git push
   ```

3. In the Space **Settings → Hardware**, choose **ZeroGPU** if it is offered to your account.
4. Add `HF_TOKEN` as a Space secret only if Hugging Face prompts for authentication while downloading a model. Use a token with read access; do not commit it to this repository. Create a separate read token for your Node backend and store it only in `backend/.env` as `HUGGINGFACE_TOKEN`.
5. Wait for the Space to finish building. Open **Use via API** and confirm that `/try_on` is listed.

The endpoint accepts `person`, `garment`, and `category` in that order. `category` is `upper` or `outer`. Its Gradio output is an image file object with a URL; the Node backend downloads that file and returns its PNG bytes to the existing frontend.

## Backend configuration after the Space is running

Set the following values in `C:\Users\Admin\Desktop\coding\AI_Live_Try-On\backend\.env`, then restart the Node backend:

```env
INFERENCE_PROVIDER=huggingface-space
HUGGINGFACE_SPACE_URL=https://<your-hf-username>-virtualfit-catvton.hf.space
HUGGINGFACE_TOKEN=hf_your_read_token
HUGGINGFACE_REQUEST_TIMEOUT_MS=180000
```

`HUGGINGFACE_SPACE_URL` is the Space application URL, not its repository URL. The backend uploads each image through Gradio's authenticated upload API, submits the queued `/try_on` endpoint, waits for completion, and returns the generated PNG to React.

## Local checks

This project needs a Linux CUDA-compatible environment for full imports and inference. Do not run it on an Intel Iris Xe laptop expecting CatVTON GPU inference.
