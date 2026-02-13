const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dns = require('dns').promises;
const net = require('net');

const DEFAULT_CONFIG = {
  host: '127.0.0.1',
  port: 3000,
  aiProvider: '',
  defaultTheme: 'classic',
  openaiModel: 'gpt-4.1-mini',
  perplexityModel: 'sonar',
  askOutputMode: 'standard',
  askShowSources: false,
  estimatedInputCostPer1k: 0.00035,
  estimatedOutputCostPer1k: 0.0012,
  askSystemPrompt:
    'You are a terminal assistant. Keep replies concise and well-structured for CLI display. ' +
    'Format as: "Answer: ..." then "Details:" with 1-3 short bullets. ' +
    'Limit to about 80 words unless the user explicitly asks for a detailed response. ' +
    'Do not repeat content and do not include citation markers like [1] unless requested.',
  openaiApiKey: '',
  pplxApiKey: '',
  bodyLimitBytes: 16 * 1024,
  commandMaxLength: 1200,
  askMaxLength: 4000,
  upstreamTimeoutMs: 20000,
  maxFetchedBytes: 1024 * 1024,
  maxFetchRedirects: 3,
  allowPrivateUrls: false,
  corsAllowedOrigins: '',
  enableRateLimit: false,
  rateLimitWindowMs: 60_000,
  rateLimitMax: 120,
  trustProxy: false,
  requireBasicAuth: false,
  basicAuthUser: '',
  basicAuthPass: '',
  metricsMaxSessions: 2000,
  metricsTtlMs: 30 * 60_000,
  publicDir: __dirname
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const startMs = Date.now();

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const lower = String(value).toLowerCase();
  return lower === '1' || lower === 'true' || lower === 'yes' || lower === 'on';
}

function toNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readJsonFileMaybe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (_err) {
    return {};
  }
}

function loadConfig(overrides = {}) {
  const explicitConfigPath = process.env.CONFIG_FILE;
  const defaultConfigPath = path.join(__dirname, 'ion-cli.config.json');
  const fileConfig = explicitConfigPath
    ? readJsonFileMaybe(explicitConfigPath)
    : readJsonFileMaybe(defaultConfigPath);

  const envConfig = {
    host: process.env.HOST,
    port: toNumber(process.env.PORT, undefined),
    aiProvider: process.env.AI_PROVIDER,
    defaultTheme: process.env.DEFAULT_THEME,
    openaiModel: process.env.OPENAI_MODEL,
    perplexityModel: process.env.PERPLEXITY_MODEL,
    askOutputMode: process.env.ASK_OUTPUT_MODE,
    askShowSources: process.env.ASK_SHOW_SOURCES,
    estimatedInputCostPer1k: toNumber(process.env.EST_INPUT_COST_PER_1K, undefined),
    estimatedOutputCostPer1k: toNumber(process.env.EST_OUTPUT_COST_PER_1K, undefined),
    askSystemPrompt: process.env.ASK_SYSTEM_PROMPT,
    openaiApiKey: process.env.OPENAI_API_KEY,
    pplxApiKey: process.env.PPLX_API_KEY,
    bodyLimitBytes: toNumber(process.env.BODY_LIMIT_BYTES, undefined),
    commandMaxLength: toNumber(process.env.COMMAND_MAX_LENGTH, undefined),
    askMaxLength: toNumber(process.env.ASK_MAX_LENGTH, undefined),
    upstreamTimeoutMs: toNumber(process.env.UPSTREAM_TIMEOUT_MS, undefined),
    maxFetchedBytes: toNumber(process.env.MAX_FETCHED_BYTES, undefined),
    maxFetchRedirects: toNumber(process.env.MAX_FETCH_REDIRECTS, undefined),
    allowPrivateUrls: process.env.ALLOW_PRIVATE_URLS,
    corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS,
    enableRateLimit: process.env.ENABLE_RATE_LIMIT,
    rateLimitWindowMs: toNumber(process.env.RATE_LIMIT_WINDOW_MS, undefined),
    rateLimitMax: toNumber(process.env.RATE_LIMIT_MAX, undefined),
    trustProxy: process.env.TRUST_PROXY,
    requireBasicAuth: process.env.REQUIRE_BASIC_AUTH,
    basicAuthUser: process.env.BASIC_AUTH_USER,
    basicAuthPass: process.env.BASIC_AUTH_PASS,
    metricsMaxSessions: toNumber(process.env.METRICS_MAX_SESSIONS, undefined),
    metricsTtlMs: toNumber(process.env.METRICS_TTL_MS, undefined)
  };

  const merged = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...Object.fromEntries(
      Object.entries(envConfig).filter(([, value]) => value !== undefined && value !== null && value !== '')
    ),
    ...overrides
  };

  merged.aiProvider = String(merged.aiProvider || '').toLowerCase().trim();
  merged.defaultTheme = String(merged.defaultTheme || 'classic').toLowerCase().trim();
  merged.askOutputMode = String(merged.askOutputMode || 'standard').toLowerCase().trim();
  if (!['brief', 'standard', 'deep'].includes(merged.askOutputMode)) {
    merged.askOutputMode = 'standard';
  }
  merged.askShowSources = toBoolean(merged.askShowSources, false);
  merged.estimatedInputCostPer1k = toNumber(merged.estimatedInputCostPer1k, DEFAULT_CONFIG.estimatedInputCostPer1k);
  merged.estimatedOutputCostPer1k = toNumber(merged.estimatedOutputCostPer1k, DEFAULT_CONFIG.estimatedOutputCostPer1k);
  merged.enableRateLimit = toBoolean(merged.enableRateLimit, false);
  merged.requireBasicAuth =
    toBoolean(merged.requireBasicAuth, false) ||
    (Boolean(merged.basicAuthUser) && Boolean(merged.basicAuthPass));
  merged.port = toNumber(merged.port, DEFAULT_CONFIG.port);
  merged.bodyLimitBytes = toNumber(merged.bodyLimitBytes, DEFAULT_CONFIG.bodyLimitBytes);
  merged.commandMaxLength = toNumber(merged.commandMaxLength, DEFAULT_CONFIG.commandMaxLength);
  merged.askMaxLength = toNumber(merged.askMaxLength, DEFAULT_CONFIG.askMaxLength);
  merged.upstreamTimeoutMs = toNumber(merged.upstreamTimeoutMs, DEFAULT_CONFIG.upstreamTimeoutMs);
  merged.maxFetchedBytes = toNumber(merged.maxFetchedBytes, DEFAULT_CONFIG.maxFetchedBytes);
  merged.maxFetchRedirects = toNumber(merged.maxFetchRedirects, DEFAULT_CONFIG.maxFetchRedirects);
  merged.allowPrivateUrls = toBoolean(merged.allowPrivateUrls, DEFAULT_CONFIG.allowPrivateUrls);
  merged.corsAllowedOrigins = String(merged.corsAllowedOrigins || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  merged.rateLimitWindowMs = toNumber(merged.rateLimitWindowMs, DEFAULT_CONFIG.rateLimitWindowMs);
  merged.rateLimitMax = toNumber(merged.rateLimitMax, DEFAULT_CONFIG.rateLimitMax);
  merged.trustProxy = toBoolean(merged.trustProxy, DEFAULT_CONFIG.trustProxy);
  merged.metricsMaxSessions = toNumber(merged.metricsMaxSessions, DEFAULT_CONFIG.metricsMaxSessions);
  merged.metricsTtlMs = toNumber(merged.metricsTtlMs, DEFAULT_CONFIG.metricsTtlMs);
  merged.maxFetchedBytes = Math.max(16 * 1024, Math.min(10 * 1024 * 1024, merged.maxFetchedBytes));
  merged.maxFetchRedirects = Math.max(0, Math.min(8, Math.floor(merged.maxFetchRedirects)));
  merged.metricsMaxSessions = Math.max(2, Math.min(50_000, Math.floor(merged.metricsMaxSessions)));
  merged.metricsTtlMs = Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Math.floor(merged.metricsTtlMs)));
  merged.publicDir = path.resolve(String(merged.publicDir || __dirname));

  return merged;
}

function createAppError(code, message, httpStatus = 400, retryable = false) {
  const err = new Error(message);
  err.code = code;
  err.httpStatus = httpStatus;
  err.retryable = retryable;
  return err;
}

function normalizeError(err, fallbackCode = 'INTERNAL_ERROR', fallbackMessage = 'Internal server error.') {
  if (err && err.code && err.httpStatus) {
    return err;
  }
  return createAppError(fallbackCode, err?.message || fallbackMessage, 500, false);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendSuccess(res, payload = {}) {
  sendJson(res, 200, {
    ok: true,
    ...payload,
    serverTime: new Date().toISOString()
  });
}

function sendError(res, error) {
  const safeError = normalizeError(error);
  sendJson(res, safeError.httpStatus || 500, {
    ok: false,
    response: safeError.message,
    error: {
      code: safeError.code || 'INTERNAL_ERROR',
      message: safeError.message || 'Internal server error.',
      retryable: Boolean(safeError.retryable)
    },
    serverTime: new Date().toISOString()
  });
}

function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

function parseAsk(command) {
  return command.replace(/^ask\s+/i, '').trim();
}

function toTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item?.text === 'string') return item.text;
        return '';
      })
      .join('');
  }
  return '';
}

function sanitizeAssistantOutput(text, config) {
  let value = String(text || '').trim();
  value = value.replace(/\r\n/g, '\n');
  value = value
    .replace(/[*_`~>#]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const paragraphs = value.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const dedupedParagraphs = [];
  for (const p of paragraphs) {
    if (!dedupedParagraphs.includes(p)) dedupedParagraphs.push(p);
  }
  value = dedupedParagraphs.join('\n\n').trim();

  if (!config.askShowSources) {
    value = value.replace(/\[\d+\]/g, '');
    value = value.replace(/(^|\n)\s*Sources?:[\s\S]*$/i, '').trim();
  }

  if (config.askOutputMode === 'brief') {
    const answerLine = value
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) || value;
    const normalized = answerLine.replace(/^Answer:\s*/i, '').trim();
    const sentence = (normalized.match(/[^.!?]+[.!?]?/) || [normalized])[0].trim();
    const compact = sentence.replace(/\s+/g, ' ').trim();
    if (compact.length > 140) {
      return `${compact.slice(0, 139).trim()}…`;
    }
    return compact;
  }

  return value;
}

function selectProvider(config) {
  if (config.aiProvider) return config.aiProvider;
  if (config.pplxApiKey) return 'perplexity';
  if (config.openaiApiKey) return 'openai';
  return '';
}

function sanitizeSingleHeaderValue(value) {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function decodeHeaderJson(base64Value) {
  if (!base64Value) return null;
  try {
    const text = Buffer.from(base64Value, 'base64').toString('utf8');
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

function clampText(value, max = 250) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function normalizeSessionId(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._:-]/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function resolveRequestConfig(req, baseConfig) {
  const config = { ...baseConfig };
  const providerHeader = sanitizeSingleHeaderValue(req.headers['x-ai-provider']).toLowerCase();
  const keyHeader = sanitizeSingleHeaderValue(req.headers['x-ai-key']);
  const modeHeader = sanitizeSingleHeaderValue(req.headers['x-output-mode']).toLowerCase();
  const sourcesHeader = sanitizeSingleHeaderValue(req.headers['x-show-sources']).toLowerCase();
  const memoryEnabledHeader = sanitizeSingleHeaderValue(req.headers['x-memory-enabled']).toLowerCase();
  const memoryNotesHeader = sanitizeSingleHeaderValue(req.headers['x-memory-notes']);
  const memoryTurnsHeader = sanitizeSingleHeaderValue(req.headers['x-memory-turns']);
  const sessionIdHeader = sanitizeSingleHeaderValue(req.headers['x-session-id']);

  if (providerHeader && providerHeader !== 'openai' && providerHeader !== 'perplexity') {
    throw createAppError('INVALID_PROVIDER', 'x-ai-provider must be openai or perplexity.', 400, false);
  }

  if (keyHeader && keyHeader.length > 4096) {
    throw createAppError('INVALID_API_KEY', 'x-ai-key exceeds max allowed length.', 400, false);
  }
  if (modeHeader && !['brief', 'standard', 'deep'].includes(modeHeader)) {
    throw createAppError('INVALID_OUTPUT_MODE', 'x-output-mode must be brief, standard, or deep.', 400, false);
  }
  if (sourcesHeader && !['true', 'false', '1', '0', 'on', 'off', 'yes', 'no'].includes(sourcesHeader)) {
    throw createAppError('INVALID_SOURCES_FLAG', 'x-show-sources must be true or false.', 400, false);
  }
  if (memoryEnabledHeader && !['true', 'false', '1', '0', 'on', 'off', 'yes', 'no'].includes(memoryEnabledHeader)) {
    throw createAppError('INVALID_MEMORY_FLAG', 'x-memory-enabled must be true or false.', 400, false);
  }

  if (providerHeader) {
    config.aiProvider = providerHeader;
  }

  if (keyHeader) {
    const inferredProvider = providerHeader || (keyHeader.startsWith('pplx-') ? 'perplexity' : 'openai');
    if (inferredProvider === 'perplexity') {
      config.pplxApiKey = keyHeader;
    } else {
      config.openaiApiKey = keyHeader;
    }
    if (!config.aiProvider) {
      config.aiProvider = inferredProvider;
    }
  }

  if (modeHeader) {
    config.askOutputMode = modeHeader;
  }

  if (sourcesHeader) {
    config.askShowSources = toBoolean(sourcesHeader, config.askShowSources);
  }

  if (memoryEnabledHeader) {
    config.memoryEnabled = toBoolean(memoryEnabledHeader, true);
  } else {
    config.memoryEnabled = true;
  }

  const decodedNotes = decodeHeaderJson(memoryNotesHeader);
  if (Array.isArray(decodedNotes)) {
    config.memoryNotes = decodedNotes.map((item) => clampText(item, 200)).filter(Boolean).slice(0, 12);
  } else {
    config.memoryNotes = [];
  }

  const decodedTurns = decodeHeaderJson(memoryTurnsHeader);
  if (Array.isArray(decodedTurns)) {
    config.memoryTurns = decodedTurns
      .map((turn) => ({
        q: clampText(turn?.q || '', 220),
        a: clampText(turn?.a || '', 280)
      }))
      .filter((turn) => turn.q && turn.a)
      .slice(0, 4);
  } else {
    config.memoryTurns = [];
  }

  config.sessionId = normalizeSessionId(sessionIdHeader, '');

  return config;
}

function createRequestSignal(timeoutMs, parentSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  return {
    signal: controller.signal,
    isTimedOut: () => timedOut,
    done: () => clearTimeout(timeout)
  };
}

async function fetchJsonWithTimeout(url, options, timeoutMs, parentSignal) {
  const timeoutCtx = createRequestSignal(timeoutMs, parentSignal);
  try {
    const res = await fetch(url, { ...options, signal: timeoutCtx.signal });
    const bodyText = await res.text();
    let json = null;
    try {
      json = bodyText ? JSON.parse(bodyText) : null;
    } catch (_err) {
      json = null;
    }
    return { res, bodyText, json };
  } catch (err) {
    if (timeoutCtx.isTimedOut()) {
      throw createAppError('UPSTREAM_TIMEOUT', `Upstream request timed out after ${timeoutMs}ms.`, 504, true);
    }
    if (timeoutCtx.signal.aborted && parentSignal?.aborted) {
      throw createAppError('REQUEST_ABORTED', 'Request was cancelled.', 499, false);
    }
    throw createAppError('UPSTREAM_NETWORK_ERROR', `Upstream request failed: ${err.message}`, 502, true);
  } finally {
    timeoutCtx.done();
  }
}

function extractTokenFromUpstreamPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.delta === 'string') return payload.delta;
  if (typeof payload.output_text === 'string') return payload.output_text;

  const choice = payload.choices?.[0];
  if (choice) {
    const deltaContent = choice?.delta?.content;
    const messageContent = choice?.message?.content;
    const deltaText = toTextContent(deltaContent);
    const messageText = toTextContent(messageContent);
    if (deltaText) return deltaText;
    if (messageText) return messageText;
  }

  return '';
}

function normalizeStreamToken(state, rawToken) {
  const token = String(rawToken || '');
  if (!token) return '';

  if (!state.fullText) {
    state.fullText = token;
    state.lastChunk = token;
    return token;
  }

  if (token === state.lastChunk || token === state.fullText) {
    state.lastChunk = token;
    return '';
  }

  if (token.startsWith(state.fullText)) {
    const delta = token.slice(state.fullText.length);
    state.fullText = token;
    state.lastChunk = token;
    return delta;
  }

  if (state.fullText.endsWith(token)) {
    state.lastChunk = token;
    return '';
  }

  state.fullText += token;
  state.lastChunk = token;
  return token;
}

function buildAskInstruction(config) {
  const base = String(config.askSystemPrompt || '').trim();
  let modeRule = '';
  if (config.askOutputMode === 'brief') {
    modeRule = 'Keep response under 45 words in one short paragraph.';
  } else if (config.askOutputMode === 'deep') {
    modeRule = 'Provide a detailed but concise answer in under 220 words with short sections.';
  } else {
    modeRule =
      'Format as: "Answer: ..." then "Details:" with 1-3 short bullets. ' +
      'Limit to about 80 words unless the user explicitly asks for detail.';
  }

  const sourceRule = config.askShowSources
    ? 'If useful, add a final "Sources:" line with up to 3 URLs. Avoid numeric citation markers.'
    : 'Do not include citation markers like [1], and do not include a Sources section.';

  let memoryRule = '';
  if (config.memoryEnabled) {
    const notes = Array.isArray(config.memoryNotes) ? config.memoryNotes : [];
    const turns = Array.isArray(config.memoryTurns) ? config.memoryTurns : [];
    if (notes.length > 0 || turns.length > 0) {
      const noteText = notes.length > 0 ? `Memory notes: ${notes.map((n) => `- ${n}`).join(' ')}` : '';
      const turnsText = turns.length > 0
        ? `Recent turns: ${turns.map((t) => `Q:${t.q} A:${t.a}`).join(' | ')}`
        : '';
      memoryRule = `${noteText} ${turnsText} Use this context only when relevant.`;
    }
  }

  return [base, modeRule, sourceRule, memoryRule].filter(Boolean).join(' ');
}

function buildProviderMessages(prompt, config) {
  const messages = [];
  const instruction = buildAskInstruction(config);
  if (instruction) {
    messages.push({ role: 'system', content: instruction });
  }
  messages.push({ role: 'user', content: prompt });
  return messages;
}

async function parseSSE(readable, onData) {
  if (!readable) {
    throw createAppError('UPSTREAM_EMPTY_STREAM', 'Upstream stream had no readable body.', 502, true);
  }

  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of readable) {
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let splitAt = buffer.indexOf('\n\n');

    while (splitAt !== -1) {
      const block = buffer.slice(0, splitAt).trim();
      buffer = buffer.slice(splitAt + 2);
      splitAt = buffer.indexOf('\n\n');

      if (!block) continue;
      const lines = block.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        await onData(data);
      }
    }
  }
}

async function askOpenAINonStream(prompt, config, signal) {
  const { res, bodyText, json } = await fetchJsonWithTimeout(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.openaiModel,
        input: prompt,
        instructions: buildAskInstruction(config)
      })
    },
    config.upstreamTimeoutMs,
    signal
  );

  if (!res.ok) {
    throw createAppError(
      'OPENAI_REQUEST_FAILED',
      `OpenAI request failed (${res.status}). ${bodyText.slice(0, 180)}`,
      502,
      true
    );
  }

  const text = String(json?.output_text || '').trim();
  if (text) return sanitizeAssistantOutput(text, config);
  return 'OpenAI responded without text output.';
}

async function askPerplexityNonStream(prompt, config, signal) {
  const { res, bodyText, json } = await fetchJsonWithTimeout(
    'https://api.perplexity.ai/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.pplxApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.perplexityModel,
        messages: buildProviderMessages(prompt, config)
      })
    },
    config.upstreamTimeoutMs,
    signal
  );

  if (!res.ok) {
    throw createAppError(
      'PERPLEXITY_REQUEST_FAILED',
      `Perplexity request failed (${res.status}). ${bodyText.slice(0, 180)}`,
      502,
      true
    );
  }

  const content = json?.choices?.[0]?.message?.content;
  const text = toTextContent(content).trim();
  if (text) return sanitizeAssistantOutput(text, config);
  return 'Perplexity responded without text output.';
}

async function askOpenAIStream(prompt, config, signal, onToken) {
  const timeoutCtx = createRequestSignal(config.upstreamTimeoutMs, signal);
  let emittedCount = 0;
  const streamState = { fullText: '', lastChunk: '' };
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.openaiModel,
        stream: true,
        messages: buildProviderMessages(prompt, config)
      }),
      signal: timeoutCtx.signal
    });

    if (!res.ok) {
      const text = await res.text();
      throw createAppError(
        'OPENAI_STREAM_FAILED',
        `OpenAI stream failed (${res.status}). ${text.slice(0, 180)}`,
        502,
        true
      );
    }

    await parseSSE(res.body, async (dataLine) => {
      let payload = null;
      try {
        payload = JSON.parse(dataLine);
      } catch (_err) {
        return;
      }
      const token = normalizeStreamToken(streamState, extractTokenFromUpstreamPayload(payload));
      if (token) {
        emittedCount += 1;
        onToken(token);
      }
    });
  } catch (err) {
    if (timeoutCtx.isTimedOut()) {
      throw createAppError('UPSTREAM_TIMEOUT', `Upstream request timed out after ${config.upstreamTimeoutMs}ms.`, 504, true);
    }
    throw err;
  } finally {
    timeoutCtx.done();
  }
  return emittedCount;
}

async function askPerplexityStream(prompt, config, signal, onToken) {
  const timeoutCtx = createRequestSignal(config.upstreamTimeoutMs, signal);
  let emittedCount = 0;
  const streamState = { fullText: '', lastChunk: '' };
  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.pplxApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.perplexityModel,
        stream: true,
        messages: buildProviderMessages(prompt, config)
      }),
      signal: timeoutCtx.signal
    });

    if (!res.ok) {
      const text = await res.text();
      throw createAppError(
        'PERPLEXITY_STREAM_FAILED',
        `Perplexity stream failed (${res.status}). ${text.slice(0, 180)}`,
        502,
        true
      );
    }

    await parseSSE(res.body, async (dataLine) => {
      let payload = null;
      try {
        payload = JSON.parse(dataLine);
      } catch (_err) {
        return;
      }
      const token = normalizeStreamToken(streamState, extractTokenFromUpstreamPayload(payload));
      if (token) {
        emittedCount += 1;
        onToken(token);
      }
    });
  } catch (err) {
    if (timeoutCtx.isTimedOut()) {
      throw createAppError('UPSTREAM_TIMEOUT', `Upstream request timed out after ${config.upstreamTimeoutMs}ms.`, 504, true);
    }
    throw err;
  } finally {
    timeoutCtx.done();
  }
  return emittedCount;
}

async function askNonStream(prompt, config, signal) {
  const provider = selectProvider(config);
  if (provider === 'openai') {
    if (!config.openaiApiKey) {
      throw createAppError('OPENAI_KEY_MISSING', 'OPENAI_API_KEY is not set.', 400, false);
    }
    return askOpenAINonStream(prompt, config, signal);
  }
  if (provider === 'perplexity') {
    if (!config.pplxApiKey) {
      throw createAppError('PERPLEXITY_KEY_MISSING', 'PPLX_API_KEY is not set.', 400, false);
    }
    return askPerplexityNonStream(prompt, config, signal);
  }

  return (
    `No live AI provider configured. Echo trace: "${prompt}". ` +
    'Set OPENAI_API_KEY or PPLX_API_KEY, optionally AI_PROVIDER=openai|perplexity.'
  );
}

async function askStream(prompt, config, signal, onToken) {
  const provider = selectProvider(config);
  if (provider === 'openai') {
    if (!config.openaiApiKey) {
      throw createAppError('OPENAI_KEY_MISSING', 'OPENAI_API_KEY is not set.', 400, false);
    }
    const emitted = await askOpenAIStream(prompt, config, signal, onToken);
    if (emitted === 0) {
      const fallback = await askOpenAINonStream(prompt, config, signal);
      onToken(fallback);
    }
    return;
  }
  if (provider === 'perplexity') {
    if (!config.pplxApiKey) {
      throw createAppError('PERPLEXITY_KEY_MISSING', 'PPLX_API_KEY is not set.', 400, false);
    }
    const emitted = await askPerplexityStream(prompt, config, signal, onToken);
    if (emitted === 0) {
      const fallback = await askPerplexityNonStream(prompt, config, signal);
      onToken(fallback);
    }
    return;
  }

  const fallback = `No live AI provider configured. Echo trace: "${prompt}".`;
  for (const token of sanitizeAssistantOutput(fallback, config).split(/(\s+)/)) {
    if (token) onToken(token);
  }
}

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  if (parts[0] === 0) return true;
  return false;
}

function isPrivateIpv6(ip) {
  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized === '::'
  );
}

function isIpPrivate(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return false;
}

async function assertUrlAllowed(rawUrl, config) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_err) {
    throw createAppError('INVALID_URL', 'Invalid URL.', 400, false);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw createAppError('UNSUPPORTED_URL_PROTOCOL', 'Only http:// or https:// URLs are allowed.', 400, false);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!config.allowPrivateUrls) {
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      throw createAppError('URL_NOT_ALLOWED', 'URL hostname is not allowed.', 403, false);
    }
  }

  const ipVersion = net.isIP(hostname);
  if (ipVersion > 0) {
    if (!config.allowPrivateUrls && isIpPrivate(hostname)) {
      throw createAppError('URL_NOT_ALLOWED', 'URL points to a private network address.', 403, false);
    }
    return;
  }

  let records = [];
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch (_err) {
    throw createAppError('URL_DNS_RESOLUTION_FAILED', 'Could not resolve URL hostname.', 400, false);
  }

  if (!records.length) {
    throw createAppError('URL_DNS_RESOLUTION_FAILED', 'Could not resolve URL hostname.', 400, false);
  }

  if (!config.allowPrivateUrls) {
    const privateHit = records.find((record) => isIpPrivate(record.address));
    if (privateHit) {
      throw createAppError('URL_NOT_ALLOWED', 'URL resolves to a private network address.', 403, false);
    }
  }
}

async function fetchTextWithTimeout(url, options, timeoutMs, parentSignal, maxBytes = 1024 * 1024) {
  const timeoutCtx = createRequestSignal(timeoutMs, parentSignal);
  try {
    const res = await fetch(url, { ...options, signal: timeoutCtx.signal });
    if (!res.body) {
      return { res, text: '' };
    }

    const decoder = new TextDecoder();
    let bytes = 0;
    let text = '';
    for await (const chunk of res.body) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        throw createAppError(
          'UPSTREAM_RESPONSE_TOO_LARGE',
          `Upstream response exceeded ${maxBytes} bytes.`,
          413,
          false
        );
      }
      text += decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
    return { res, text };
  } catch (err) {
    if (err?.code === 'UPSTREAM_RESPONSE_TOO_LARGE') throw err;
    if (timeoutCtx.isTimedOut()) {
      throw createAppError('UPSTREAM_TIMEOUT', `Upstream request timed out after ${timeoutMs}ms.`, 504, true);
    }
    throw createAppError('UPSTREAM_NETWORK_ERROR', `Upstream request failed: ${err.message}`, 502, true);
  } finally {
    timeoutCtx.done();
  }
}

async function fetchUrlWithValidation(url, options, config, signal) {
  let currentUrl = String(url || '').trim();
  const maxRedirects = config.maxFetchRedirects;

  for (let step = 0; step <= maxRedirects; step += 1) {
    await assertUrlAllowed(currentUrl, config);
    const result = await fetchTextWithTimeout(
      currentUrl,
      { ...options, redirect: 'manual' },
      config.upstreamTimeoutMs,
      signal,
      config.maxFetchedBytes
    );

    const location = result.res.headers.get('location');
    const isRedirect = [301, 302, 303, 307, 308].includes(result.res.status) && Boolean(location);
    if (!isRedirect) {
      return result;
    }
    if (step >= maxRedirects) {
      throw createAppError('TOO_MANY_REDIRECTS', `URL exceeded redirect limit (${maxRedirects}).`, 400, false);
    }

    try {
      currentUrl = new URL(location, currentUrl).toString();
    } catch (_err) {
      throw createAppError('INVALID_REDIRECT_URL', 'URL redirect target is invalid.', 400, false);
    }
  }

  throw createAppError('TOO_MANY_REDIRECTS', `URL exceeded redirect limit (${maxRedirects}).`, 400, false);
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCommandParts(raw) {
  const [command, ...parts] = String(raw || '').trim().split(/\s+/);
  return {
    command: String(command || '').toLowerCase(),
    args: parts,
    argText: parts.join(' ').trim()
  };
}

function buildDocsResponse(topicRaw) {
  const topic = String(topicRaw || '').toLowerCase().trim();
  const docsMap = {
    javascript: ['MDN JS Guide', 'https://developer.mozilla.org/docs/Web/JavaScript/Guide'],
    js: ['MDN JS Guide', 'https://developer.mozilla.org/docs/Web/JavaScript/Guide'],
    node: ['Node.js Docs', 'https://nodejs.org/docs/latest/api/'],
    react: ['React Docs', 'https://react.dev/learn'],
    css: ['MDN CSS', 'https://developer.mozilla.org/docs/Web/CSS'],
    html: ['MDN HTML', 'https://developer.mozilla.org/docs/Web/HTML'],
    typescript: ['TypeScript Handbook', 'https://www.typescriptlang.org/docs/'],
    python: ['Python Docs', 'https://docs.python.org/3/'],
    openai: ['OpenAI Docs', 'https://platform.openai.com/docs/overview'],
    perplexity: ['Perplexity API Docs', 'https://docs.perplexity.ai/']
  };

  if (!topic) {
    return {
      response:
        'Usage: docs <topic>\n' +
        'Examples: docs javascript, docs react, docs node, docs openai'
    };
  }

  const hit = Object.entries(docsMap).find(([key]) => topic.includes(key));
  if (hit) {
    return { response: `Answer: Documentation for ${hit[0]}\nDetails:\n- ${hit[1][0]}\n- ${hit[1][1]}` };
  }

  const encoded = encodeURIComponent(`${topic} documentation`);
  return {
    response:
      `Answer: No curated docs match for "${topicRaw}".\n` +
      'Details:\n' +
      `- Try search: https://duckduckgo.com/?q=${encoded}\n` +
      '- Or run: docs javascript | docs react | docs node | docs openai'
  };
}

function createPluginRegistry() {
  return {
    async weather(argText, config, signal) {
      const location = argText.trim();
      if (!location) {
        return { response: 'Usage: weather <location>' };
      }
      try {
        const { res, bodyText } = await fetchTextWithTimeout(
          `https://wttr.in/${encodeURIComponent(location)}?format=j1`,
          { method: 'GET', headers: { 'User-Agent': 'ion-phosphor-cli/1.0' } },
          config.upstreamTimeoutMs,
          signal
        );
        if (res.ok) {
          const data = JSON.parse(bodyText);
          const current = data?.current_condition?.[0] || {};
          const area = data?.nearest_area?.[0]?.areaName?.[0]?.value || location;
          const desc = current?.weatherDesc?.[0]?.value || 'Unknown';
          const tempC = current?.temp_C || '?';
          const humidity = current?.humidity || '?';
          const wind = current?.windspeedKmph || '?';
          return {
            response:
              `Answer: Weather for ${area}: ${desc}, ${tempC}°C.\n` +
              'Details:\n' +
              `- Humidity: ${humidity}%\n` +
              `- Wind: ${wind} km/h`
          };
        }
      } catch (_err) {
        // fall through to plain format fallback
      }

      const plain = await fetchTextWithTimeout(
        `https://wttr.in/${encodeURIComponent(location)}?format=3`,
        { method: 'GET', headers: { 'User-Agent': 'ion-phosphor-cli/1.0' } },
        config.upstreamTimeoutMs,
        signal
      );
      if (!plain.res.ok) {
        throw createAppError('WEATHER_REQUEST_FAILED', `Weather lookup failed (${plain.res.status}).`, 502, true);
      }
      return { response: `Answer: ${plain.text.trim()}` };
    },

    async docs(argText) {
      return buildDocsResponse(argText);
    },

    async code(argText, config, signal) {
      const task = argText.trim();
      if (!task) {
        return { response: 'Usage: code <what to generate>' };
      }
      const response = await askNonStream(
        `Write clean code for: ${task}. Include only one short explanation and one code block.`,
        config,
        signal
      );
      return { response };
    },

    async 'summarize-url'(argText, config, signal) {
      const url = argText.trim();
      if (!/^https?:\/\//i.test(url)) {
        return { response: 'Usage: summarize-url <https://...>' };
      }
      const { res, text } = await fetchUrlWithValidation(
        url,
        {
          method: 'GET',
          headers: { 'User-Agent': 'ion-phosphor-cli/1.0' }
        },
        config,
        signal
      );
      if (!res.ok) {
        throw createAppError('URL_FETCH_FAILED', `Could not fetch URL (${res.status}).`, 502, true);
      }
      const plain = stripHtml(text).slice(0, 9000);
      if (!plain) {
        return { response: 'No readable text found at URL.' };
      }
      const summary = await askNonStream(
        `Summarize this page in a compact terminal-friendly format:\n\n${plain}`,
        config,
        signal
      );
      return { response: summary };
    }
  };
}

const pluginRegistry = createPluginRegistry();

async function handleCliCommand(command, config, signal) {
  const raw = String(command || '').trim();
  if (!raw) {
    throw createAppError('EMPTY_COMMAND', 'No command received.', 400, false);
  }
  if (raw.length > config.commandMaxLength) {
    throw createAppError(
      'COMMAND_TOO_LONG',
      `Command exceeds max length (${config.commandMaxLength}).`,
      400,
      false
    );
  }

  const { command: cmd, argText } = parseCommandParts(raw);

  if (cmd === 'status') {
    return {
      response: `STATUS ONLINE | node=${process.version} | host=${os.hostname()} | uptime=${formatDuration(Date.now() - startMs)}`
    };
  }

  if (cmd === 'ask') {
    const prompt = parseAsk(raw);
    if (!prompt) {
      throw createAppError('ASK_PROMPT_REQUIRED', 'Usage: ask <prompt>', 400, false);
    }
    if (prompt.length > config.askMaxLength) {
      throw createAppError(
        'ASK_PROMPT_TOO_LONG',
        `Prompt exceeds max length (${config.askMaxLength}).`,
        400,
        false
      );
    }
    const response = await askNonStream(prompt, config, signal);
    return { response };
  }

  if (pluginRegistry[cmd]) {
    return pluginRegistry[cmd](argText, config, signal);
  }

  return {
    response:
      `Command received by API: "${raw}". ` +
      'Try "help", "ask <prompt>", "weather <location>", "docs <topic>", "code <task>", or "summarize-url <url>".'
  };
}

function readJsonBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';
    let failed = false;

    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limitBytes) {
        failed = true;
        reject(createAppError('PAYLOAD_TOO_LARGE', `Payload exceeds ${limitBytes} bytes.`, 413, false));
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      if (failed) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (_err) {
        reject(createAppError('INVALID_JSON', 'Invalid JSON request payload.', 400, false));
      }
    });

    req.on('error', (err) => {
      if (failed) return;
      failed = true;
      reject(createAppError('REQUEST_STREAM_ERROR', `Request stream failed: ${err.message}`, 400, false));
    });
  });
}

function getClientIp(req, config) {
  const headerIp = req.headers['x-forwarded-for'];
  if (config.trustProxy && typeof headerIp === 'string' && headerIp.trim()) {
    return headerIp.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function getSessionKey(req, requestConfig, config) {
  const ip = getClientIp(req, config);
  const session = requestConfig?.sessionId ? `sid:${requestConfig.sessionId}` : 'anon';
  return `${ip}|${session}`;
}

function estimateTokens(text) {
  const value = String(text || '');
  return Math.max(0, Math.ceil(value.length / 4));
}

function createMetricsStore(config) {
  const sessions = new Map();

  function purgeExpired(now = Date.now()) {
    for (const [key, value] of sessions.entries()) {
      if (now - value.updatedAt > config.metricsTtlMs) {
        sessions.delete(key);
      }
    }
  }

  function evictLeastRecentlyUpdated() {
    let oldestKey = '';
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [key, value] of sessions.entries()) {
      if (value.updatedAt < oldestTs) {
        oldestTs = value.updatedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      sessions.delete(oldestKey);
    }
  }

  function ensureSession(sessionKey, sessionId) {
    purgeExpired();
    if (!sessions.has(sessionKey)) {
      if (sessions.size >= config.metricsMaxSessions) {
        evictLeastRecentlyUpdated();
      }
      sessions.set(sessionKey, {
        sessionKey,
        sessionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        requests: 0,
        askRequests: 0,
        askErrors: 0,
        streamRequests: 0,
        streamSuccess: 0,
        streamErrors: 0,
        provider: {
          openai: { success: 0, error: 0 },
          perplexity: { success: 0, error: 0 },
          none: { success: 0, error: 0 }
        },
        latency: { totalMs: 0, count: 0, avgMs: 0, maxMs: 0 },
        usage: { promptTokens: 0, responseTokens: 0, totalTokens: 0, estimatedCostUsd: 0 }
      });
    }
    const session = sessions.get(sessionKey);
    if (sessionId) {
      session.sessionId = sessionId;
    }
    return session;
  }

  function record(event) {
    const session = ensureSession(event.sessionKey, event.sessionId);
    session.updatedAt = Date.now();
    session.requests += 1;

    const latencyMs = Math.max(0, Number(event.latencyMs || 0));
    session.latency.totalMs += latencyMs;
    session.latency.count += 1;
    session.latency.avgMs = session.latency.totalMs / session.latency.count;
    session.latency.maxMs = Math.max(session.latency.maxMs, latencyMs);

    if (event.kind === 'ask') {
      session.askRequests += 1;
      if (event.stream) {
        session.streamRequests += 1;
        if (event.success) session.streamSuccess += 1;
        else session.streamErrors += 1;
      }
      const providerKey = event.provider === 'openai' || event.provider === 'perplexity' ? event.provider : 'none';
      if (event.success) session.provider[providerKey].success += 1;
      else {
        session.provider[providerKey].error += 1;
        session.askErrors += 1;
      }

      const promptTokens = Number(event.promptTokens || 0);
      const responseTokens = Number(event.responseTokens || 0);
      const totalTokens = promptTokens + responseTokens;
      session.usage.promptTokens += promptTokens;
      session.usage.responseTokens += responseTokens;
      session.usage.totalTokens += totalTokens;

      const inputRate = Number(event.inputRate || 0);
      const outputRate = Number(event.outputRate || 0);
      const estCost = (promptTokens / 1000) * inputRate + (responseTokens / 1000) * outputRate;
      session.usage.estimatedCostUsd += estCost;
    }
  }

  function get(sessionKey, sessionId) {
    return ensureSession(sessionKey, sessionId);
  }

  return { record, get };
}

function createRateLimiter(config) {
  const buckets = new Map();
  return function allow(ip) {
    if (!config.enableRateLimit) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const now = Date.now();
    const existing = buckets.get(ip);
    if (!existing || now >= existing.resetAt) {
      buckets.set(ip, {
        count: 1,
        resetAt: now + config.rateLimitWindowMs
      });
      return { allowed: true, retryAfterSeconds: Math.ceil(config.rateLimitWindowMs / 1000) };
    }

    if (existing.count >= config.rateLimitMax) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
      };
    }

    existing.count += 1;
    return { allowed: true, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  };
}

function hasBasicAuth(req, config) {
  if (!config.requireBasicAuth) return true;
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Basic ')) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  } catch (_err) {
    return false;
  }
  const sep = decoded.indexOf(':');
  if (sep < 0) return false;
  const username = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);
  return username === config.basicAuthUser && password === config.basicAuthPass;
}

function safePathFromUrl(urlPath, publicDir) {
  let pathname = '/';
  try {
    const parsed = new URL(urlPath, 'http://localhost');
    pathname = parsed.pathname;
  } catch (_err) {
    pathname = '/';
  }

  const relative = pathname === '/' ? '/index.html' : pathname;
  const normalized = path.normalize(relative).replace(/^(\.\.[/\\])+/, '');
  return path.join(publicDir, normalized);
}

function isSameOriginApiRequest(req, origin) {
  if (!origin) return false;
  const host = sanitizeSingleHeaderValue(req.headers.host);
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host;
  } catch (_err) {
    return false;
  }
}

function applyApiCors(req, res, config) {
  const origin = sanitizeSingleHeaderValue(req.headers.origin);
  if (!origin) {
    return { allowed: true, applied: false };
  }

  if (isSameOriginApiRequest(req, origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (config.corsAllowedOrigins.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (config.corsAllowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    return { allowed: false, applied: false };
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, x-ai-provider, x-ai-key, x-output-mode, x-show-sources, x-memory-enabled, x-memory-notes, x-memory-turns, x-session-id'
  );
  res.setHeader('Access-Control-Max-Age', '600');
  return { allowed: true, applied: true };
}

function sendSSE(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function createServer(overrides = {}) {
  const config = loadConfig(overrides);
  const allowRate = createRateLimiter(config);
  const metricsStore = createMetricsStore(config);

  const server = http.createServer(async (req, res) => {
    const urlPath = req.url || '/';
    let pathname = '/';
    try {
      pathname = new URL(urlPath, 'http://localhost').pathname;
    } catch (_err) {
      sendError(res, createAppError('INVALID_URL', 'Invalid request URL.', 400, false));
      return;
    }
    const isApiPath = pathname.startsWith('/api/');

    if (isApiPath) {
      const cors = applyApiCors(req, res, config);
      if (!cors.allowed) {
        sendError(res, createAppError('CORS_ORIGIN_DENIED', 'CORS origin not allowed.', 403, false));
        return;
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (!hasBasicAuth(req, config)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Ionized CLI API"');
        sendError(res, createAppError('AUTH_REQUIRED', 'Authentication required.', 401, false));
        return;
      }

      const rate = allowRate(getClientIp(req, config));
      if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfterSeconds));
        sendError(
          res,
          createAppError('RATE_LIMITED', 'Rate limit exceeded. Try again later.', 429, true)
        );
        return;
      }
    }

    try {
      if (req.method === 'GET' && pathname === '/api/config') {
        sendSuccess(res, {
          config: {
            defaultTheme: config.defaultTheme,
            maxCommandLength: config.commandMaxLength,
            askMaxLength: config.askMaxLength,
            streamAsk: true,
            askOutputMode: config.askOutputMode,
            askShowSources: config.askShowSources,
            plugins: ['weather', 'docs', 'code', 'summarize-url']
          }
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/metrics') {
        const requestConfig = resolveRequestConfig(req, config);
        const sessionKey = getSessionKey(req, requestConfig, config);
        const publicSessionId = requestConfig.sessionId || 'anonymous';
        const sessionMetrics = metricsStore.get(sessionKey, publicSessionId);
        const errRate =
          sessionMetrics.askRequests > 0
            ? (sessionMetrics.askErrors / sessionMetrics.askRequests) * 100
            : 0;
        sendSuccess(res, {
          metrics: {
            session: {
              ...sessionMetrics,
              sessionId: publicSessionId,
              errorRate: errRate
            }
          }
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/ask/stream') {
        const requestConfig = resolveRequestConfig(req, config);
        const sessionKey = getSessionKey(req, requestConfig, config);
        const publicSessionId = requestConfig.sessionId || 'anonymous';
        const parsed = new URL(urlPath, 'http://localhost');
        const prompt = String(parsed.searchParams.get('prompt') || '').trim();
        if (!prompt) {
          throw createAppError('ASK_PROMPT_REQUIRED', 'Usage: ask <prompt>', 400, false);
        }
        if (prompt.length > requestConfig.askMaxLength) {
          throw createAppError(
            'ASK_PROMPT_TOO_LONG',
            `Prompt exceeds max length (${requestConfig.askMaxLength}).`,
            400,
            false
          );
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive'
        });

        const clientAbort = new AbortController();
        req.on('close', () => clientAbort.abort());
        const startedAt = Date.now();
        let streamedText = '';

        try {
          await askStream(prompt, requestConfig, clientAbort.signal, (token) => {
            streamedText += token;
            sendSSE(res, 'token', { text: token });
          });
          metricsStore.record({
            kind: 'ask',
            stream: true,
            success: true,
            sessionKey,
            sessionId: publicSessionId,
            provider: selectProvider(requestConfig),
            latencyMs: Date.now() - startedAt,
            promptTokens: estimateTokens(prompt),
            responseTokens: estimateTokens(streamedText),
            inputRate: requestConfig.estimatedInputCostPer1k,
            outputRate: requestConfig.estimatedOutputCostPer1k
          });
          sendSSE(res, 'done', { ok: true });
        } catch (err) {
          const safeErr = normalizeError(err);
          metricsStore.record({
            kind: 'ask',
            stream: true,
            success: false,
            sessionKey,
            sessionId: publicSessionId,
            provider: selectProvider(requestConfig),
            latencyMs: Date.now() - startedAt,
            promptTokens: estimateTokens(prompt),
            responseTokens: estimateTokens(streamedText),
            inputRate: requestConfig.estimatedInputCostPer1k,
            outputRate: requestConfig.estimatedOutputCostPer1k
          });
          sendSSE(res, 'error', {
            code: safeErr.code,
            message: safeErr.message,
            retryable: Boolean(safeErr.retryable)
          });
          sendSSE(res, 'done', { ok: false });
        } finally {
          res.end();
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/api/cli') {
        const parsed = await readJsonBody(req, config.bodyLimitBytes);
        const command = String(parsed?.command || '');
        const requestAbort = new AbortController();
        req.on('close', () => requestAbort.abort());
        const requestConfig = resolveRequestConfig(req, config);
        const sessionKey = getSessionKey(req, requestConfig, config);
        const publicSessionId = requestConfig.sessionId || 'anonymous';
        const startedAt = Date.now();
        const cmdParts = parseCommandParts(command);
        const askLike = cmdParts.command === 'ask' || cmdParts.command === 'code' || cmdParts.command === 'summarize-url';
        try {
          const result = await handleCliCommand(command, requestConfig, requestAbort.signal);
          const commonEvent = {
            success: true,
            sessionKey,
            sessionId: publicSessionId,
            provider: selectProvider(requestConfig),
            latencyMs: Date.now() - startedAt,
            promptTokens: estimateTokens(cmdParts.argText || command),
            responseTokens: estimateTokens(result?.response || ''),
            inputRate: requestConfig.estimatedInputCostPer1k,
            outputRate: requestConfig.estimatedOutputCostPer1k
          };
          metricsStore.record({
            ...commonEvent,
            kind: askLike ? 'ask' : 'command',
            stream: false
          });
          sendSuccess(res, result);
        } catch (err) {
          metricsStore.record({
            kind: askLike ? 'ask' : 'command',
            stream: false,
            success: false,
            sessionKey,
            sessionId: publicSessionId,
            provider: selectProvider(requestConfig),
            latencyMs: Date.now() - startedAt,
            promptTokens: estimateTokens(cmdParts.argText || command),
            responseTokens: 0,
            inputRate: requestConfig.estimatedInputCostPer1k,
            outputRate: requestConfig.estimatedOutputCostPer1k
          });
          throw err;
        }
        return;
      }

      if (req.method === 'GET') {
        const filePath = safePathFromUrl(urlPath, config.publicDir);
        if (!filePath.startsWith(config.publicDir)) {
          throw createAppError('FORBIDDEN_PATH', 'Forbidden', 403, false);
        }

        fs.stat(filePath, (statErr, stats) => {
          if (statErr || !stats.isFile()) {
            sendError(res, createAppError('NOT_FOUND', 'Not Found', 404, false));
            return;
          }

          const ext = path.extname(filePath).toLowerCase();
          const noCacheExtensions = new Set(['.html', '.js', '.mjs', '.css']);
          res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'Cache-Control': noCacheExtensions.has(ext) ? 'no-cache' : 'public, max-age=3600'
          });
          fs.createReadStream(filePath).pipe(res);
        });
        return;
      }

      throw createAppError('METHOD_NOT_ALLOWED', 'Method Not Allowed', 405, false);
    } catch (err) {
      sendError(res, err);
    }
  });

  return { server, config };
}

if (require.main === module) {
  const { server, config } = createServer();
  server.listen(config.port, config.host, () => {
    console.log(`Ionized Phosphor server running at http://${config.host}:${config.port}`);
  });
}

module.exports = {
  createServer,
  loadConfig,
  handleCliCommand,
  parseAsk,
  resolveRequestConfig
};
