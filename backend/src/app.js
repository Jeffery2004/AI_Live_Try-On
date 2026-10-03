import 'dotenv/config';
import crypto from 'node:crypto';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import { requestHuggingFaceTryOn } from './hf-space-client.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_PIXELS = 24_000_000;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE, files: 2 }, fileFilter: (_req, file, callback) => callback(null, ACCEPTED_TYPES.has(file.mimetype)) });

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }));

function inferenceMode() {
  if (process.env.INFERENCE_PROVIDER === 'huggingface-space') return process.env.HUGGINGFACE_SPACE_URL && process.env.HUGGINGFACE_TOKEN ? 'huggingface-space' : 'unconfigured';
  return process.env.CATVTON_API_URL && process.env.CATVTON_API_KEY ? 'remote' : 'unconfigured';
}

async function verifyImage(file, label) {
  if (!file || !ACCEPTED_TYPES.has(file.mimetype)) throw new Error(`${label} must be a JPG, PNG, or WEBP image.`);
  try {
    const metadata = await sharp(file.buffer, { limitInputPixels: MAX_PIXELS }).metadata();
    if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('invalid image');
  } catch { throw new Error(`${label} is not a readable JPG, PNG, or WEBP image.`); }
}

async function requestTryOn(person, garment, category) {
  if (process.env.INFERENCE_PROVIDER === 'huggingface-space') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.HUGGINGFACE_REQUEST_TIMEOUT_MS || 180000));
    try {
      return await requestHuggingFaceTryOn({
        spaceUrl: process.env.HUGGINGFACE_SPACE_URL,
        token: process.env.HUGGINGFACE_TOKEN,
        person,
        garment,
        category: category === 'jacket' ? 'outer' : 'upper',
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') { const timeoutError = new Error('Hugging Face generation timed out. The Space may be starting or queued.'); timeoutError.statusCode = 504; throw timeoutError; }
      throw error;
    } finally { clearTimeout(timeout); }
  }
  const apiUrl = process.env.CATVTON_API_URL;
  const apiKey = process.env.CATVTON_API_KEY;
  if (!apiUrl || !apiKey) { const error = new Error('AI inference is not configured yet. Set CATVTON_API_URL and CATVTON_API_KEY on the server.'); error.statusCode = 503; throw error; }
  const form = new FormData();
  form.append('person', new Blob([person.buffer], { type: person.mimetype }), person.originalname || 'person-image');
  form.append('garment', new Blob([garment.buffer], { type: garment.mimetype }), garment.originalname || 'garment-image');
  form.append('category', category === 'jacket' ? 'outer' : 'upper');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CATVTON_REQUEST_TIMEOUT_MS || 120000));
  try {
    const upstream = await fetch(apiUrl, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'X-Request-Id': crypto.randomUUID() }, body: form, signal: controller.signal });
    const contentType = upstream.headers.get('content-type') || '';
    if (!upstream.ok) { const body = contentType.includes('application/json') ? await upstream.json().catch(() => ({})) : {}; const error = new Error(body.detail || body.error || 'The AI inference service could not complete this request.'); error.statusCode = upstream.status >= 500 ? 502 : upstream.status; throw error; }
    if (!contentType.startsWith('image/')) { const error = new Error('The inference service returned an unexpected response.'); error.statusCode = 502; throw error; }
    return { buffer: Buffer.from(await upstream.arrayBuffer()), contentType };
  } catch (error) {
    if (error.name === 'AbortError') { const timeoutError = new Error('Generation timed out. Please try again later.'); timeoutError.statusCode = 504; throw timeoutError; }
    throw error;
  } finally { clearTimeout(timeout); }
}

app.get('/health', (_req, response) => response.json({ status: 'ok', inferenceMode: inferenceMode() }));
app.post('/api/try-on', upload.fields([{ name: 'person', maxCount: 1 }, { name: 'garment', maxCount: 1 }]), async (request, response, next) => {
  try {
    const person = request.files?.person?.[0]; const garment = request.files?.garment?.[0]; const { category } = request.body;
    if (!person || !garment) return response.status(400).json({ error: 'Person and garment images are required.' });
    if (!['upper', 'jacket'].includes(category)) return response.status(400).json({ error: 'Choose a supported upper-body category.' });
    await Promise.all([verifyImage(person, 'Person image'), verifyImage(garment, 'Garment image')]);
    const result = await requestTryOn(person, garment, category);
    return response.set('Cache-Control', 'no-store').type(result.contentType).send(result.buffer);
  } catch (error) { return next(error); }
});
app.use((error, _req, response, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return response.status(413).json({ error: 'Each image must be 10 MB or smaller.' });
  if (error instanceof multer.MulterError) return response.status(400).json({ error: 'Upload failed. Submit one JPG, PNG, or WEBP file for each image.' });
  return response.status(Number.isInteger(error.statusCode) ? error.statusCode : 400).json({ error: error.message || 'The request could not be processed.' });
});
