import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import multer from 'multer';

const app = express();
const port = Number(process.env.PORT || 4000);
const acceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2 },
  fileFilter: (_request, file, callback) => callback(null, acceptedTypes.has(file.mimetype)),
});

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }));
app.get('/health', (_request, response) => response.json({ status: 'ok', inferenceMode: process.env.INFERENCE_MODE || 'unconfigured' }));

app.post('/api/try-on', upload.fields([{ name: 'person', maxCount: 1 }, { name: 'garment', maxCount: 1 }]), (request, response) => {
  const person = request.files?.person?.[0];
  const garment = request.files?.garment?.[0];
  const { category } = request.body;
  if (!person || !garment) return response.status(400).json({ error: 'Person and garment images are required.' });
  if (!['upper', 'jacket'].includes(category)) return response.status(400).json({ error: 'Choose a supported upper-body category.' });
  // The adapter will be added after a real remote CatVTON run is verified.
  return response.status(503).json({ error: 'AI inference is not configured yet. The uploads were held only in memory and were discarded.' });
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return response.status(413).json({ error: 'Each image must be 10 MB or smaller.' });
  if (error) return response.status(400).json({ error: 'Upload failed. Use JPG, PNG, or WEBP images.' });
});

app.listen(port, () => console.log(`VirtualFit API listening at http://localhost:${port}`));
