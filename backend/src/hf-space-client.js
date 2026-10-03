function asError(message, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function spaceBaseUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') throw new Error('not HTTPS');
    return url.toString().replace(/\/$/, '');
  } catch {
    throw asError('HUGGINGFACE_SPACE_URL must be an HTTPS Space URL.', 503);
  }
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function responseError(response, fallback) {
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : { detail: await response.text().catch(() => '') };
  const detail = body.error || body.detail || body.message || '';
  const suffix = typeof detail === 'string' && detail.trim() ? `: ${detail.trim().slice(0, 500)}` : '';
  return asError(`${fallback} (HTTP ${response.status})${suffix}`, response.status >= 500 ? 502 : response.status);
}

async function uploadFile(baseUrl, token, file, fetchImpl, signal) {
  const form = new FormData();
  form.append('files', new Blob([file.buffer], { type: file.mimetype }), file.originalname || 'image');
  const response = await fetchImpl(`${baseUrl}/gradio_api/upload`, { method: 'POST', headers: authHeaders(token), body: form, signal });
  if (!response.ok) throw await responseError(response, 'Hugging Face Space rejected an image upload');
  const paths = await response.json();
  if (!Array.isArray(paths) || typeof paths[0] !== 'string') throw asError('Hugging Face Space returned an invalid upload response.');
  return { path: paths[0], meta: { _type: 'gradio.FileData' }, orig_name: file.originalname || 'image' };
}

function outputUrl(data, baseUrl) {
  const output = Array.isArray(data) ? data[0] : data?.output ?? data;
  const url = typeof output === 'string' ? output : output?.url;
  if (typeof url !== 'string') throw asError('Hugging Face Space returned an invalid image result.');
  return new URL(url, baseUrl).toString();
}

function completeEventData(sse) {
  const events = sse.split(/\r?\n\r?\n/);
  for (const event of events) {
    if (!/^event:\s*complete\s*$/m.test(event)) continue;
    const dataLine = event.match(/^data:\s*(.+)$/m);
    if (!dataLine) break;
    try { return JSON.parse(dataLine[1]); } catch { break; }
  }
  throw asError('Hugging Face Space did not return a completed generation result.');
}

export async function requestHuggingFaceTryOn({ spaceUrl, token, person, garment, category, fetchImpl = fetch, signal }) {
  if (!spaceUrl || !token) throw asError('Hugging Face inference is not configured yet. Set HUGGINGFACE_SPACE_URL and HUGGINGFACE_TOKEN on the server.', 503);
  const baseUrl = spaceBaseUrl(spaceUrl);
  const [personFile, garmentFile] = await Promise.all([
    uploadFile(baseUrl, token, person, fetchImpl, signal),
    uploadFile(baseUrl, token, garment, fetchImpl, signal),
  ]);
  const queued = await fetchImpl(`${baseUrl}/gradio_api/call/try_on`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [personFile, garmentFile, category] }),
    signal,
  });
  if (!queued.ok) throw await responseError(queued, 'Hugging Face Space could not queue the try-on request');
  const { event_id: eventId } = await queued.json();
  if (!eventId) throw asError('Hugging Face Space returned an invalid queue response.');
  const eventResponse = await fetchImpl(`${baseUrl}/gradio_api/call/try_on/${encodeURIComponent(eventId)}`, { headers: authHeaders(token), signal });
  if (!eventResponse.ok) throw await responseError(eventResponse, 'Hugging Face Space could not complete the try-on request');
  const resultUrl = outputUrl(completeEventData(await eventResponse.text()), baseUrl);
  const imageResponse = await fetchImpl(resultUrl, { headers: authHeaders(token), signal });
  const contentType = imageResponse.headers.get('content-type') || '';
  if (!imageResponse.ok || !contentType.startsWith('image/')) throw asError('Hugging Face Space returned an invalid generated image.');
  return { buffer: Buffer.from(await imageResponse.arrayBuffer()), contentType };
}
