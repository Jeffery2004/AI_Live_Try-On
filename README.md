# VirtualFit AI

Basic virtual try-on interface for upper-body garments. The frontend accepts a person photo and a product garment image, shows previews, validates client-side file types and size, and submits to the Node API.

The API validates multipart uploads in memory and currently returns an explicit `503` response because no real CatVTON inference provider has been verified or connected. It does not save uploaded files or show a placeholder as a generated result.

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
