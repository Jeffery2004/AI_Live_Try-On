# VirtualFit AI

Basic virtual try-on interface for upper-body garments. The frontend accepts a person photo and a product garment image, shows previews, validates client-side file types and size, and submits to the Node API.

The API validates multipart uploads in memory and securely forwards valid images to a configured CatVTON GPU service. It does not save uploaded files or show a placeholder as a generated result. Until `CATVTON_API_URL` and `CATVTON_API_KEY` are configured, it returns an explicit `503` response.

## Run locally on Windows

Open two PowerShell terminals from this folder.

```powershell
cd backend
npm install
Copy-Item .env.example .env
npm run dev
```

```powershell
cd frontend
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.

To change the API address, add `VITE_API_URL=http://localhost:4000` to `frontend/.env`.

## Connect a CatVTON GPU service

Use the service in [inference-service](inference-service). Its deployment instructions use the official CatVTON pipeline on a CUDA machine. After it is deployed, set these values in `backend/.env`:

```env
CATVTON_API_URL=https://your-gpu-host.example.com/v1/try-on
CATVTON_API_KEY=the-same-value-as-SERVICE_API_KEY
CATVTON_REQUEST_TIMEOUT_MS=120000
```

The browser never receives this service key.

## Hugging Face ZeroGPU deployment

The [hf-space](hf-space) folder is a separate Gradio deployment project for Hugging Face ZeroGPU. It keeps the React and Node.js APIs unchanged while the backend calls the Space's queued `/try_on` Gradio endpoint with a server-only Hugging Face token. See [hf-space/README.md](hf-space/README.md) for setup and current ZeroGPU eligibility limits.
