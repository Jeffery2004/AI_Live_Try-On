import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from '../src/app.js';

let server; let baseUrl;
test.before(async () => { server = app.listen(0); await new Promise((resolve) => server.once('listening', resolve)); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());
test('health exposes server state without secrets', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.match(body.inferenceMode, /^(unconfigured|remote|huggingface-space)$/);
  assert.deepEqual(Object.keys(body).sort(), ['inferenceMode', 'status']);
});
test('try-on rejects missing files', async () => { const response = await fetch(`${baseUrl}/api/try-on`, { method: 'POST', body: new FormData() }); assert.equal(response.status, 400); assert.equal((await response.json()).error, 'Person and garment images are required.'); });
test('try-on rejects unreadable image content', async () => {
  const form = new FormData();
  form.append('person', new Blob(['not an image'], { type: 'image/png' }), 'person.png');
  form.append('garment', new Blob(['also not an image'], { type: 'image/png' }), 'garment.png');
  form.append('category', 'upper');
  const response = await fetch(`${baseUrl}/api/try-on`, { method: 'POST', body: form });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /not a readable/);
});
