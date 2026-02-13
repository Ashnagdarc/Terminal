const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server.js');

let httpServer;
let baseUrl;

test.before(async () => {
  const setup = createServer({
    host: '127.0.0.1',
    port: 0,
    enableRateLimit: false,
    requireBasicAuth: false,
    openaiApiKey: '',
    pplxApiKey: ''
  });
  httpServer = setup.server;

  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  const address = httpServer.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (!httpServer) return;
  await new Promise((resolve) => {
    httpServer.close(() => resolve());
  });
});

test('POST /api/cli status returns online response', async () => {
  const res = await fetch(`${baseUrl}/api/cli`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'status' })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.match(data.response, /STATUS ONLINE/);
});

test('POST /api/cli with invalid JSON returns structured error', async () => {
  const res = await fetch(`${baseUrl}/api/cli`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"command":'
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error.code, 'INVALID_JSON');
});

test('POST /api/cli rejects oversized command', async () => {
  const res = await fetch(`${baseUrl}/api/cli`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'x'.repeat(1400) })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error.code, 'COMMAND_TOO_LONG');
});

test('POST /api/cli rejects invalid x-ai-provider header', async () => {
  const res = await fetch(`${baseUrl}/api/cli`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ai-provider': 'invalid-provider'
    },
    body: JSON.stringify({ command: 'status' })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error.code, 'INVALID_PROVIDER');
});

test('POST /api/cli rejects invalid x-output-mode header', async () => {
  const res = await fetch(`${baseUrl}/api/cli`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-output-mode': 'ultra'
    },
    body: JSON.stringify({ command: 'status' })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error.code, 'INVALID_OUTPUT_MODE');
});

test('GET /api/config includes plugin registry metadata', async () => {
  const res = await fetch(`${baseUrl}/api/config`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(Array.isArray(data.config.plugins));
  assert.ok(data.config.plugins.includes('weather'));
});

test('GET /api/metrics returns session object', async () => {
  const res = await fetch(`${baseUrl}/api/metrics`, {
    headers: { 'x-session-id': 'test-session-123' }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.metrics.session.sessionId, 'test-session-123');
});

test('POST /api/cli docs plugin returns curated link', async () => {
  const res = await fetch(`${baseUrl}/api/cli`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'docs react' })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.match(data.response, /react\.dev\/learn/);
});

test('POST /api/cli summarize-url blocks private network targets by default', async () => {
  const res = await fetch(`${baseUrl}/api/cli`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'summarize-url http://127.0.0.1/' })
  });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error.code, 'URL_NOT_ALLOWED');
});

test('metrics store evicts least recently updated sessions when max size is reached', async () => {
  const setup = createServer({
    host: '127.0.0.1',
    port: 0,
    enableRateLimit: false,
    requireBasicAuth: false,
    metricsMaxSessions: 2,
    metricsTtlMs: 60 * 60 * 1000
  });

  const server = setup.server;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;

  try {
    const postStatus = async (sessionId) => {
      const res = await fetch(`${url}/api/cli`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': sessionId
        },
        body: JSON.stringify({ command: 'status' })
      });
      assert.equal(res.status, 200);
    };

    const getMetrics = async (sessionId) => {
      const res = await fetch(`${url}/api/metrics`, {
        headers: { 'x-session-id': sessionId }
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      return data.metrics.session;
    };

    await postStatus('s1');
    await postStatus('s2');
    await postStatus('s3');

    const s1Metrics = await getMetrics('s1');
    assert.equal(s1Metrics.requests, 0);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});
