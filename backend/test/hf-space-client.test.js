import assert from 'node:assert/strict';
import test from 'node:test';
import { requestHuggingFaceTryOn } from '../src/hf-space-client.js';

const image = { buffer: Buffer.from('image-data'), mimetype: 'image/png', originalname: 'image.png' };

test('Hugging Face client rejects missing Space credentials', async () => {
  await assert.rejects(
    requestHuggingFaceTryOn({ person: image, garment: image, category: 'upper' }),
    { message: /not configured/, statusCode: 503 },
  );
});

test('Hugging Face client uploads, queues, reads SSE, and downloads PNG', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/gradio_api/upload')) return new Response(JSON.stringify(['/tmp/gradio/input.png']), { headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/gradio_api/call/try_on')) return new Response(JSON.stringify({ event_id: 'event-1' }), { headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/gradio_api/call/try_on/event-1')) return new Response('event: complete\ndata: [{"url":"https://demo.hf.space/file=output.png"}]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    if (url === 'https://demo.hf.space/file=output.png') return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const result = await requestHuggingFaceTryOn({ spaceUrl: 'https://demo.hf.space', token: 'hf_test', person: image, garment: image, category: 'upper', fetchImpl });
  assert.equal(result.contentType, 'image/png');
  assert.deepEqual([...result.buffer], [137, 80, 78, 71]);
  assert.equal(calls.length, 5);
  assert.equal(JSON.parse(calls[2].options.body).data[2], 'upper');
  assert.equal(calls[2].options.headers.Authorization, 'Bearer hf_test');
});

test('Hugging Face client rejects malformed completed output', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/gradio_api/upload')) return new Response(JSON.stringify(['/tmp/input.png']), { headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/gradio_api/call/try_on')) return new Response(JSON.stringify({ event_id: 'event-2' }), { headers: { 'Content-Type': 'application/json' } });
    return new Response('event: complete\ndata: [null]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  };
  await assert.rejects(
    requestHuggingFaceTryOn({ spaceUrl: 'https://demo.hf.space', token: 'hf_test', person: image, garment: image, category: 'upper', fetchImpl }),
    /invalid image result/,
  );
});
