import { createAudioEngine } from './audio.js?v=20260213f';
import { createUI } from './ui.js?v=20260213f';
import { COMMAND_LIST, autocompleteCommand, parseCommand } from './commands-parser.mjs?v=20260213f';

const THEME_CONFIG = {
  classic: {
    primary: '#00ff41',
    glow: 'rgba(0, 255, 65, 0.4)',
    dim: '#003b00',
    matrix: '#0f0'
  },
  amber: {
    primary: '#ffbf00',
    glow: 'rgba(255, 191, 0, 0.35)',
    dim: '#4a3300',
    matrix: '#ffcc33'
  },
  ice: {
    primary: '#6ef9ff',
    glow: 'rgba(110, 249, 255, 0.35)',
    dim: '#0d3e42',
    matrix: '#8dfeff'
  }
};

const BOOT_MEMORY_TOTAL_K = 65536;
const BIOS_PCI_ROWS = [
  '  0       7         1      8086        1230       IDE Controller      14',
  '  0      17         0      1274        1371       Multimedia Device   11',
  '  0      18         0      10EC        8139       Ethernet Controller 10',
  '  0      20         0      5333        88F0       VGA Compatible      11'
];

const USER_AI_STORAGE_KEY = 'ion_phosphor_user_ai_v1';
const ONBOARDING_STORAGE_KEY = 'ion_phosphor_onboarding_seen_v1';
const USER_PINS_STORAGE_KEY = 'ion_phosphor_pins_v1';
const USER_MEMORIES_STORAGE_KEY = 'ion_phosphor_memories_v1';
const SESSION_TURNS_STORAGE_KEY = 'ion_phosphor_session_turns_v1';
const SESSION_ID_STORAGE_KEY = 'ion_phosphor_session_id_v1';
const API_BASE_URL_STORAGE_KEY = 'ion_phosphor_api_base_url_v1';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const bootStartMs = Date.now();
const audio = createAudioEngine();

const chatLog = document.getElementById('chat-log');
const cliInput = document.getElementById('cli-input');
const bootScreen = document.getElementById('boot-screen');
const bootBios = document.getElementById('boot-bios');
const bootInitBtn = document.getElementById('boot-init-btn');
const liveRegion = document.getElementById('live-region');
const canvas = document.getElementById('canvas-cascade');
const bootMeterFill = document.getElementById('boot-meter-fill');
const bootPercent = document.getElementById('boot-percent');
const pinsListEl = document.getElementById('pins-list');
const pinsEmptyEl = document.getElementById('pins-empty');
const sourcesListEl = document.getElementById('sources-list');
const sourcesEmptyEl = document.getElementById('sources-empty');
const paletteEl = document.getElementById('command-palette');
const paletteInputEl = document.getElementById('palette-input');
const paletteListEl = document.getElementById('palette-list');
const slashSuggestionsEl = document.getElementById('slash-suggestions');
const ctx = canvas.getContext('2d');

const ui = createUI({
  chatLog,
  liveRegion,
  maxEntries: 140,
  reducedMotion: prefersReducedMotion
});

const userCommandHistory = [];
let historyIndex = 0;
let matrixTheme = 'classic';
let matrixLastFrame = 0;
let matrixWidth = 0;
let matrixHeight = 0;
let matrixColumns = 0;
const matrixFontSize = 16;
let matrixDrops = [];

const commandQueue = [];
let queueRunning = false;
let activeAbortController = null;
let lastFailedCommand = '';
let userAiSettings = {
  provider: '',
  apiKey: '',
  mode: 'standard',
  sources: false,
  memoryEnabled: true,
  soundMuted: false,
  soundVolume: 55,
  postMode: 'full',
  apiBaseUrl: ''
};
let userPins = [];
let userMemories = [];
let sessionTurns = [];
let sourceLinks = [];
let sessionId = '';
let paletteResults = [];
let paletteActiveIndex = 0;
let slashActiveIndex = 0;

function normalizeProvider(provider) {
  const value = String(provider || '').trim().toLowerCase();
  if (value === 'preplexity') return 'perplexity';
  if (value === 'pplx') return 'perplexity';
  if (value === 'open-ai') return 'openai';
  if (value === 'openai' || value === 'perplexity') return value;
  return '';
}

function normalizeMode(mode) {
  const value = String(mode || '').trim().toLowerCase();
  if (value === 'brief' || value === 'standard' || value === 'deep') return value;
  return 'standard';
}

function normalizeSources(value) {
  if (typeof value === 'boolean') return value;
  const lower = String(value || '').trim().toLowerCase();
  if (lower === 'on' || lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'off' || lower === 'false' || lower === '0' || lower === 'no') return false;
  return false;
}

function normalizeSoundMuted(value) {
  if (typeof value === 'boolean') return value;
  const lower = String(value || '').trim().toLowerCase();
  return lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on' || lower === 'mute';
}

function normalizeSoundVolume(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 55;
  return Math.min(100, Math.max(0, Math.round(num)));
}

function normalizeMemoryEnabled(value) {
  if (typeof value === 'boolean') return value;
  const lower = String(value || '').trim().toLowerCase();
  if (['on', 'true', '1', 'yes'].includes(lower)) return true;
  if (['off', 'false', '0', 'no'].includes(lower)) return false;
  return true;
}

function normalizePostMode(value) {
  const lower = String(value || '').trim().toLowerCase();
  if (lower === 'fast' || lower === 'full') return lower;
  return 'full';
}

function normalizeApiBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (['same-origin', 'default', 'off', 'none', 'local'].includes(lower)) return '';
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
}

function loadJsonArray(key, limit = 40) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => String(v)).filter(Boolean).slice(0, limit);
  } catch (_err) {
    return [];
  }
}

function saveJsonArray(key, values, limit = 40) {
  const normalized = (Array.isArray(values) ? values : [])
    .map((v) => String(v).trim())
    .filter(Boolean)
    .slice(0, limit);
  try {
    localStorage.setItem(key, JSON.stringify(normalized));
  } catch (_err) {
    // ignore storage errors
  }
}

function loadSessionTurns() {
  try {
    const raw = sessionStorage.getItem(SESSION_TURNS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        q: String(item?.q || '').trim(),
        a: String(item?.a || '').trim(),
        t: Number(item?.t || Date.now())
      }))
      .filter((item) => item.q && item.a)
      .slice(-6);
  } catch (_err) {
    return [];
  }
}

function saveSessionTurns(values) {
  const normalized = (Array.isArray(values) ? values : []).slice(-6);
  try {
    sessionStorage.setItem(SESSION_TURNS_STORAGE_KEY, JSON.stringify(normalized));
  } catch (_err) {
    // ignore storage errors
  }
}

function getOrCreateSessionId() {
  try {
    const existing = localStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (existing) return existing;
  } catch (_err) {
    // ignore storage errors
  }

  const generated = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `sid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    localStorage.setItem(SESSION_ID_STORAGE_KEY, generated);
  } catch (_err) {
    // ignore storage errors
  }
  return generated;
}

function encodeHeaderPayload(data) {
  try {
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    let binary = '';
    for (let i = 0; i < encoded.length; i += 1) {
      binary += String.fromCharCode(encoded[i]);
    }
    return btoa(binary);
  } catch (_err) {
    return '';
  }
}

function truncateText(value, max = 280) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function extractUrls(text) {
  const value = String(text || '');
  const regex = /\bhttps?:\/\/[^\s)]+/gi;
  const matches = value.match(regex) || [];
  return [...new Set(matches)].slice(0, 8);
}

function renderPinsPanel() {
  if (!pinsListEl || !pinsEmptyEl) return;
  pinsListEl.innerHTML = '';
  if (userPins.length === 0) {
    pinsEmptyEl.style.display = 'block';
    return;
  }
  pinsEmptyEl.style.display = 'none';
  userPins.forEach((item, index) => {
    const li = document.createElement('li');
    li.textContent = `${index + 1}. ${item}`;
    pinsListEl.appendChild(li);
  });
}

function renderSourcesPanel() {
  if (!sourcesListEl || !sourcesEmptyEl) return;
  sourcesListEl.innerHTML = '';
  if (sourceLinks.length === 0) {
    sourcesEmptyEl.style.display = 'block';
    return;
  }
  sourcesEmptyEl.style.display = 'none';
  sourceLinks.forEach((url) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noreferrer noopener';
    a.textContent = url;
    a.style.color = 'var(--phosphor-primary)';
    li.appendChild(a);
    sourcesListEl.appendChild(li);
  });
}

function getPaletteItems() {
  return [
    'help',
    'settings',
    'key set perplexity <your_key>',
    'ask where is lagos',
    'mode brief',
    'sources off',
    'memory on',
    'remember I am preparing for interviews',
    'memories',
    'pin Explain Lagos quickly',
    'pins',
    'sound show',
    'sound volume 35',
    'post fast',
    'post full',
    'api set https://your-backend.example.com',
    'metrics'
  ];
}

function renderPalette(filter = '') {
  if (!paletteListEl) return;
  const q = String(filter || '').trim().toLowerCase();
  const items = getPaletteItems();
  paletteResults = items.filter((item) => item.toLowerCase().includes(q));
  if (paletteResults.length === 0) {
    paletteResults = ['help'];
  }
  paletteActiveIndex = Math.min(paletteActiveIndex, paletteResults.length - 1);
  paletteListEl.innerHTML = '';
  paletteResults.forEach((item, index) => {
    const li = document.createElement('li');
    li.textContent = item;
    if (index === paletteActiveIndex) li.classList.add('active');
    li.addEventListener('click', () => {
      cliInput.value = item;
      closePalette();
      cliInput.focus();
    });
    paletteListEl.appendChild(li);
  });
}

function openPalette() {
  if (!paletteEl || !paletteInputEl) return;
  paletteEl.classList.add('open');
  paletteEl.setAttribute('aria-hidden', 'false');
  paletteActiveIndex = 0;
  paletteInputEl.value = '';
  renderPalette('');
  paletteInputEl.focus();
}

function closePalette() {
  if (!paletteEl || !paletteInputEl) return;
  paletteEl.classList.remove('open');
  paletteEl.setAttribute('aria-hidden', 'true');
  paletteInputEl.value = '';
}

function renderSlashSuggestions(inputValue) {
  if (!slashSuggestionsEl) return;
  const value = String(inputValue || '');
  if (!value.startsWith('/')) {
    slashSuggestionsEl.classList.remove('open');
    slashSuggestionsEl.innerHTML = '';
    slashActiveIndex = 0;
    return;
  }

  const q = value.slice(1).trim().toLowerCase();
  const options = COMMAND_LIST.filter((cmd) => cmd.includes(q)).slice(0, 8);
  if (options.length === 0) {
    slashSuggestionsEl.classList.remove('open');
    slashSuggestionsEl.innerHTML = '';
    slashActiveIndex = 0;
    return;
  }

  slashActiveIndex = Math.min(slashActiveIndex, options.length - 1);
  slashSuggestionsEl.innerHTML = '';
  options.forEach((cmd, index) => {
    const li = document.createElement('li');
    li.textContent = `/${cmd}`;
    if (index === slashActiveIndex) li.classList.add('active');
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      cliInput.value = `${cmd} `;
      slashSuggestionsEl.classList.remove('open');
      slashSuggestionsEl.innerHTML = '';
      cliInput.focus();
    });
    slashSuggestionsEl.appendChild(li);
  });
  slashSuggestionsEl.classList.add('open');
}

function maskApiKey(value) {
  const key = String(value || '').trim();
  if (!key) return '(not set)';
  if (key.length <= 8) return '********';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function loadUserAiSettings() {
  try {
    const raw = localStorage.getItem(USER_AI_STORAGE_KEY);
    if (!raw) {
      return {
        provider: '',
        apiKey: '',
        mode: 'standard',
        sources: false,
        memoryEnabled: true,
        soundMuted: false,
        soundVolume: 55,
        postMode: 'full',
        apiBaseUrl: ''
      };
    }
    const parsed = JSON.parse(raw);
    const storedApiBase = localStorage.getItem(API_BASE_URL_STORAGE_KEY) || '';
    return {
      provider: normalizeProvider(parsed?.provider),
      apiKey: String(parsed?.apiKey || '').trim(),
      mode: normalizeMode(parsed?.mode),
      sources: normalizeSources(parsed?.sources),
      memoryEnabled: normalizeMemoryEnabled(parsed?.memoryEnabled),
      soundMuted: normalizeSoundMuted(parsed?.soundMuted),
      soundVolume: normalizeSoundVolume(parsed?.soundVolume),
      postMode: normalizePostMode(parsed?.postMode),
      apiBaseUrl: normalizeApiBaseUrl(parsed?.apiBaseUrl || storedApiBase)
    };
  } catch (_err) {
    return {
      provider: '',
      apiKey: '',
      mode: 'standard',
      sources: false,
      memoryEnabled: true,
      soundMuted: false,
      soundVolume: 55,
      postMode: 'full',
      apiBaseUrl: ''
    };
  }
}

function hasStoredUserAiSettings() {
  try {
    return Boolean(localStorage.getItem(USER_AI_STORAGE_KEY));
  } catch (_err) {
    return false;
  }
}

function saveUserAiSettings(next) {
  userAiSettings = {
    provider: normalizeProvider(next?.provider),
    apiKey: String(next?.apiKey || '').trim(),
    mode: normalizeMode(next?.mode),
    sources: normalizeSources(next?.sources),
    memoryEnabled: normalizeMemoryEnabled(next?.memoryEnabled),
    soundMuted: normalizeSoundMuted(next?.soundMuted),
    soundVolume: normalizeSoundVolume(next?.soundVolume),
    postMode: normalizePostMode(next?.postMode),
    apiBaseUrl: normalizeApiBaseUrl(next?.apiBaseUrl)
  };
  applySoundSettings();
  try {
    localStorage.setItem(USER_AI_STORAGE_KEY, JSON.stringify(userAiSettings));
    if (userAiSettings.apiBaseUrl) {
      localStorage.setItem(API_BASE_URL_STORAGE_KEY, userAiSettings.apiBaseUrl);
    } else {
      localStorage.removeItem(API_BASE_URL_STORAGE_KEY);
    }
  } catch (_err) {
    // Ignore storage write failures (e.g. private mode); keep in-memory settings.
  }
}

function applySoundSettings() {
  audio.setVolume(userAiSettings.soundVolume / 100);
  audio.setMuted(userAiSettings.soundMuted);
}

function getEffectiveApiBaseUrl() {
  const runtimeBase = normalizeApiBaseUrl(
    window.__ION_API_BASE__ || document.querySelector('meta[name="ion-api-base"]')?.content || ''
  );
  if (runtimeBase) return runtimeBase;
  const settingBase = normalizeApiBaseUrl(userAiSettings.apiBaseUrl);
  if (settingBase) return settingBase;
  try {
    return normalizeApiBaseUrl(localStorage.getItem(API_BASE_URL_STORAGE_KEY) || '');
  } catch (_err) {
    return '';
  }
}

function apiUrl(pathname) {
  const base = getEffectiveApiBaseUrl();
  return base ? `${base}${pathname}` : pathname;
}

function hasSeenOnboarding() {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1';
  } catch (_err) {
    return false;
  }
}

function markOnboardingSeen() {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
  } catch (_err) {
    // Ignore storage failures.
  }
}

function buildAiHeaders() {
  const headers = {};
  if (sessionId) headers['x-session-id'] = sessionId;
  if (userAiSettings.provider) headers['x-ai-provider'] = userAiSettings.provider;
  if (userAiSettings.apiKey) headers['x-ai-key'] = userAiSettings.apiKey;
  headers['x-output-mode'] = normalizeMode(userAiSettings.mode);
  headers['x-show-sources'] = userAiSettings.sources ? 'true' : 'false';
  headers['x-memory-enabled'] = userAiSettings.memoryEnabled ? 'true' : 'false';

  if (userAiSettings.memoryEnabled) {
    const trimmedNotes = userMemories.map((item) => truncateText(item, 180)).slice(0, 12);
    const trimmedTurns = sessionTurns
      .slice(-4)
      .map((item) => ({ q: truncateText(item.q, 180), a: truncateText(item.a, 220), t: item.t }));
    const notesPayload = encodeHeaderPayload(trimmedNotes);
    const turnsPayload = encodeHeaderPayload(trimmedTurns);
    if (notesPayload) headers['x-memory-notes'] = notesPayload;
    if (turnsPayload) headers['x-memory-turns'] = turnsPayload;
  }

  return headers;
}

function sanitizeModelText(value, showSources) {
  let text = String(value || '');
  if (!showSources) {
    text = text.replace(/\[\d+\]/g, '');
    text = text.replace(/(^|\n)\s*Sources?:[\s\S]*$/i, '').trim();
  }

  const normalized = text.replace(/\r\n/g, '\n').trim();
  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const deduped = [];
  for (const p of paragraphs) {
    if (!deduped.includes(p)) deduped.push(p);
  }
  return deduped.join('\n\n').trim() || normalized;
}

function formatUptime(ms) {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

function applyTheme(name) {
  const cfg = THEME_CONFIG[name];
  if (!cfg) return false;
  matrixTheme = name;
  document.documentElement.style.setProperty('--phosphor-primary', cfg.primary);
  document.documentElement.style.setProperty('--phosphor-glow', cfg.glow);
  document.documentElement.style.setProperty('--phosphor-dim', cfg.dim);
  return true;
}

function resizeMatrix() {
  matrixWidth = canvas.width = window.innerWidth;
  matrixHeight = canvas.height = window.innerHeight;
  matrixColumns = Math.floor(matrixWidth / matrixFontSize);
  matrixDrops = Array(matrixColumns).fill(1);
}

function drawMatrix() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
  ctx.fillRect(0, 0, matrixWidth, matrixHeight);
  ctx.fillStyle = THEME_CONFIG[matrixTheme]?.matrix || THEME_CONFIG.classic.matrix;
  ctx.font = `${matrixFontSize}px monospace`;

  for (let i = 0; i < matrixDrops.length; i += 1) {
    const text = String.fromCharCode(0x30a0 + Math.random() * 96);
    ctx.fillText(text, i * matrixFontSize, matrixDrops[i] * matrixFontSize);
    if (matrixDrops[i] * matrixFontSize > matrixHeight && Math.random() > 0.975) matrixDrops[i] = 0;
    matrixDrops[i] += 1;
  }
}

function animateMatrix(ts) {
  if (!matrixLastFrame || ts - matrixLastFrame >= 42) {
    drawMatrix();
    matrixLastFrame = ts;
  }
  window.requestAnimationFrame(animateMatrix);
}

function parseSSEEvent(block) {
  const lines = block.split('\n');
  let event = 'message';
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  const rawData = dataLines.join('\n');
  let data = rawData;
  try {
    data = JSON.parse(rawData);
  } catch (_err) {
    data = rawData;
  }
  return { event, data };
}

async function callBackend(command, signal) {
  const res = await fetch(apiUrl('/api/cli'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAiHeaders()
    },
    body: JSON.stringify({ command }),
    signal
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const message = data?.error?.message || data?.response || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data;
}

async function fetchMetrics(signal) {
  const res = await fetch(apiUrl('/api/metrics'), {
    method: 'GET',
    headers: {
      ...buildAiHeaders()
    },
    signal
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const message = data?.error?.message || data?.response || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data;
}

async function streamAsk(prompt, signal, onToken) {
  const res = await fetch(`${apiUrl('/api/ask/stream')}?prompt=${encodeURIComponent(prompt)}`, {
    method: 'GET',
    headers: {
      Accept: 'text/event-stream',
      ...buildAiHeaders()
    },
    signal
  });

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    if (contentType.includes('application/json')) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error?.message || data?.response || `HTTP ${res.status}`);
    }
    throw new Error(`HTTP ${res.status}`);
  }

  if (!res.body) {
    throw new Error('Streaming unavailable: empty response body.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalText = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let splitAt = buffer.indexOf('\n\n');
    while (splitAt !== -1) {
      const chunk = buffer.slice(0, splitAt).trim();
      buffer = buffer.slice(splitAt + 2);
      splitAt = buffer.indexOf('\n\n');
      if (!chunk) continue;

      const evt = parseSSEEvent(chunk);
      if (evt.event === 'token') {
        const token = String(evt?.data?.text || '');
        finalText += token;
        onToken(token);
      } else if (evt.event === 'error') {
        const message = evt?.data?.message || 'Stream failed.';
        throw new Error(message);
      } else if (evt.event === 'done') {
        return finalText || String(evt?.data?.text || '');
      }
    }
  }

  return finalText;
}

function cancelActiveAndQueue(source = 'manual') {
  commandQueue.length = 0;
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
    if (source === 'keyboard') {
      ui.addEntry('Active command cancelled via keyboard. Queue cleared.', 'bot', { animate: false });
    } else {
      ui.addEntry('Active command cancelled. Queue cleared.', 'bot', { animate: false });
    }
    return;
  }
  ui.addEntry('No active command. Queue cleared.', 'bot', { animate: false });
}

function enqueueCommand(raw) {
  commandQueue.push(raw);
  if (!queueRunning) {
    processQueue();
  }
}

async function runBackendCommand(commandText, loadingLabel) {
  const loading = ui.createLoadingEntry(loadingLabel);
  const controller = new AbortController();
  activeAbortController = controller;

  try {
    const data = await callBackend(commandText, controller.signal);
    const responseText = String(data.response || 'No response payload.');
    const urls = extractUrls(responseText);
    sourceLinks = urls;
    renderSourcesPanel();
    loading.done(responseText);
    audio.playAckSound();
  } catch (err) {
    if (controller.signal.aborted) {
      loading.fail('Command cancelled.', 'Hint: re-run your command.');
      return;
    }
    lastFailedCommand = commandText;
    loading.fail(err.message || 'Command failed.', 'Hint: type "retry" to run the last failed command.');
    audio.playErrorSound();
  } finally {
    if (activeAbortController === controller) activeAbortController = null;
  }
}

async function runAskCommand(prompt, rawCommand) {
  if (!prompt) {
    await ui.addEntry('Usage: ask <prompt>');
    return;
  }

  const loading = ui.createLoadingEntry('Querying backend intelligence node');
  const controller = new AbortController();
  activeAbortController = controller;
  let startedStream = false;

  try {
    const finalText = await streamAsk(prompt, controller.signal, (token) => {
      if (!startedStream) {
        loading.startStream('');
        startedStream = true;
      }
      loading.append(token);
    });

    const cleaned = sanitizeModelText(finalText, userAiSettings.sources);
    sourceLinks = extractUrls(cleaned);
    renderSourcesPanel();
    sessionTurns = [...sessionTurns, { q: prompt, a: cleaned || finalText || '', t: Date.now() }].slice(-6);
    saveSessionTurns(sessionTurns);
    if (!startedStream) {
      loading.done(cleaned || 'No response payload received.');
    } else {
      loading.done(cleaned || finalText || 'No response payload received.');
    }
    audio.playAckSound();
  } catch (err) {
    if (controller.signal.aborted) {
      loading.fail('Command cancelled.', 'Hint: queued commands were dropped.');
      return;
    }
    lastFailedCommand = rawCommand;
    loading.fail(err.message || 'Ask failed.', 'Hint: type "retry" to run the last failed command.');
    audio.playErrorSound();
  } finally {
    if (activeAbortController === controller) activeAbortController = null;
  }
}

async function executeCommand(rawInput) {
  const parsed = parseCommand(rawInput);
  if (parsed.type === 'empty') return;

  if (parsed.type === 'help') {
    await ui.addEntry('Available commands: help, clear, about, status, metrics, uptime, time, theme [classic|amber|ice], post <show|fast|full>, api <show|set|clear>, mode <brief|standard|deep>, sources <on|off>, memory <on|off|show>, remember <text>, memories, forget <index|all>, pin <text>, pins, unpin <index|all>, sound <show|mute|unmute|volume>, ask <prompt>, weather <location>, docs <topic>, code <task>, summarize-url <url>, key <show|set|clear|provider>, settings, cancel, retry');
    await ui.addEntry('First-time setup (per browser): key set perplexity <their_key>');
    await ui.addEntry('Then ask with: ask <prompt> (or just type your question). Ctrl+K opens command palette.');
    return;
  }

  if (parsed.type === 'clear') {
    ui.clearTerminal();
    await ui.addEntry('Terminal buffer cleared.');
    return;
  }

  if (parsed.type === 'about') {
    await ui.addEntry('ION_PHOSPHOR Terminal v0.9.4 | Frontend: HTML/CSS/JS | Backend API: Node.js');
    return;
  }

  if (parsed.type === 'time') {
    await ui.addEntry(`Local time: ${new Date().toLocaleString()}`);
    return;
  }

  if (parsed.type === 'uptime') {
    await ui.addEntry(`Session uptime: ${formatUptime(Date.now() - bootStartMs)}`);
    return;
  }

  if (parsed.type === 'theme') {
    if (!Object.keys(THEME_CONFIG).includes(parsed.theme)) {
      await ui.addEntry('Usage: theme classic | amber | ice');
      return;
    }
    applyTheme(parsed.theme);
    await ui.addEntry(`Theme switched to ${parsed.theme}.`);
    return;
  }

  if (parsed.type === 'mode') {
    if (!parsed.value) {
      await ui.addEntry(`Current mode: ${normalizeMode(userAiSettings.mode)} | Usage: mode brief|standard|deep`);
      return;
    }
    if (!['brief', 'standard', 'deep'].includes(parsed.value)) {
      await ui.addEntry('Usage: mode brief | standard | deep');
      return;
    }
    saveUserAiSettings({ ...userAiSettings, mode: parsed.value });
    await ui.addEntry(`Output mode set to ${parsed.value}.`);
    return;
  }

  if (parsed.type === 'sources') {
    if (!parsed.value) {
      await ui.addEntry(`Sources are currently ${userAiSettings.sources ? 'on' : 'off'} | Usage: sources on|off`);
      return;
    }
    if (!['on', 'off'].includes(parsed.value)) {
      await ui.addEntry('Usage: sources on | sources off');
      return;
    }
    const enabled = parsed.value === 'on';
    saveUserAiSettings({ ...userAiSettings, sources: enabled });
    await ui.addEntry(`Sources turned ${enabled ? 'on' : 'off'}.`);
    return;
  }

  if (parsed.type === 'memory') {
    if (!parsed.value || parsed.value === 'show') {
      await ui.addEntry(`Memory is ${userAiSettings.memoryEnabled ? 'on' : 'off'} | saved notes: ${userMemories.length} | session turns: ${sessionTurns.length}`);
      return;
    }
    if (!['on', 'off'].includes(parsed.value)) {
      await ui.addEntry('Usage: memory on | memory off | memory show');
      return;
    }
    const enabled = parsed.value === 'on';
    saveUserAiSettings({ ...userAiSettings, memoryEnabled: enabled });
    await ui.addEntry(`Memory turned ${enabled ? 'on' : 'off'}.`);
    return;
  }

  if (parsed.type === 'remember') {
    const note = parsed.argText.trim();
    if (!note) {
      await ui.addEntry('Usage: remember <note>');
      return;
    }
    userMemories = [note, ...userMemories.filter((item) => item !== note)].slice(0, 30);
    saveJsonArray(USER_MEMORIES_STORAGE_KEY, userMemories, 30);
    await ui.addEntry(`Saved memory #${1}: ${truncateText(note, 100)}`);
    return;
  }

  if (parsed.type === 'memories') {
    if (userMemories.length === 0) {
      await ui.addEntry('No saved memories. Use: remember <note>');
      return;
    }
    await ui.addEntry(`Memories (${userMemories.length}): ${userMemories.map((m, i) => `${i + 1}) ${truncateText(m, 90)}`).join(' | ')}`);
    return;
  }

  if (parsed.type === 'forget') {
    if (!parsed.target) {
      await ui.addEntry('Usage: forget <index|all>');
      return;
    }
    if (parsed.target === 'all') {
      userMemories = [];
      saveJsonArray(USER_MEMORIES_STORAGE_KEY, userMemories, 30);
      await ui.addEntry('All saved memories removed.');
      return;
    }
    const idx = Number(parsed.target);
    if (!Number.isInteger(idx) || idx < 1 || idx > userMemories.length) {
      await ui.addEntry('Invalid memory index.');
      return;
    }
    const removed = userMemories[idx - 1];
    userMemories.splice(idx - 1, 1);
    saveJsonArray(USER_MEMORIES_STORAGE_KEY, userMemories, 30);
    await ui.addEntry(`Removed memory ${idx}: ${truncateText(removed, 90)}`);
    return;
  }

  if (parsed.type === 'pin') {
    const value = parsed.argText.trim();
    if (!value) {
      await ui.addEntry('Usage: pin <text>');
      return;
    }
    userPins = [value, ...userPins.filter((item) => item !== value)].slice(0, 25);
    saveJsonArray(USER_PINS_STORAGE_KEY, userPins, 25);
    renderPinsPanel();
    await ui.addEntry(`Pinned snippet #${1}.`);
    return;
  }

  if (parsed.type === 'pins') {
    if (userPins.length === 0) {
      await ui.addEntry('No pins yet. Use: pin <text>');
      return;
    }
    await ui.addEntry(`Pins (${userPins.length}): ${userPins.map((p, i) => `${i + 1}) ${truncateText(p, 80)}`).join(' | ')}`);
    return;
  }

  if (parsed.type === 'unpin') {
    if (!parsed.target) {
      await ui.addEntry('Usage: unpin <index|all>');
      return;
    }
    if (parsed.target === 'all') {
      userPins = [];
      saveJsonArray(USER_PINS_STORAGE_KEY, userPins, 25);
      renderPinsPanel();
      await ui.addEntry('All pins removed.');
      return;
    }
    const idx = Number(parsed.target);
    if (!Number.isInteger(idx) || idx < 1 || idx > userPins.length) {
      await ui.addEntry('Invalid pin index.');
      return;
    }
    userPins.splice(idx - 1, 1);
    saveJsonArray(USER_PINS_STORAGE_KEY, userPins, 25);
    renderPinsPanel();
    await ui.addEntry(`Removed pin ${idx}.`);
    return;
  }

  if (parsed.type === 'sound') {
    if (parsed.action === 'show') {
      const status = audio.getStatus();
      if (!status.available) {
        await ui.addEntry('Sound unavailable in this browser.');
        return;
      }
      await ui.addEntry(`Sound | muted: ${userAiSettings.soundMuted ? 'yes' : 'no'} | volume: ${userAiSettings.soundVolume}%`);
      return;
    }

    if (parsed.action === 'mute') {
      saveUserAiSettings({ ...userAiSettings, soundMuted: true });
      await ui.addEntry('Sound muted.');
      return;
    }

    if (parsed.action === 'unmute') {
      saveUserAiSettings({ ...userAiSettings, soundMuted: false });
      audio.playAckSound();
      await ui.addEntry(`Sound unmuted. Volume ${userAiSettings.soundVolume}%.`);
      return;
    }

    if (parsed.action === 'volume') {
      const level = normalizeSoundVolume(parsed.value);
      if (!parsed.value || Number.isNaN(Number(parsed.value))) {
        await ui.addEntry('Usage: sound volume <0-100>');
        return;
      }
      saveUserAiSettings({ ...userAiSettings, soundMuted: false, soundVolume: level });
      audio.playAckSound();
      await ui.addEntry(`Sound volume set to ${level}%.`);
      return;
    }

    await ui.addEntry('Usage: sound show | sound mute | sound unmute | sound volume <0-100>');
    return;
  }

  if (parsed.type === 'post') {
    if (!parsed.value || parsed.value === 'show') {
      await ui.addEntry(`POST mode is ${normalizePostMode(userAiSettings.postMode)} | Usage: post fast | post full`);
      return;
    }
    if (!['fast', 'full'].includes(parsed.value)) {
      await ui.addEntry('Usage: post fast | post full | post show');
      return;
    }
    saveUserAiSettings({ ...userAiSettings, postMode: parsed.value });
    await ui.addEntry(`POST mode set to ${parsed.value}. Applies on next boot.`);
    return;
  }

  if (parsed.type === 'api') {
    if (!parsed.action || parsed.action === 'show') {
      const base = getEffectiveApiBaseUrl() || '(same-origin)';
      await ui.addEntry(`API base is ${base} | Usage: api set <https://backend.example.com> | api clear`);
      return;
    }
    if (parsed.action === 'set') {
      const base = normalizeApiBaseUrl(parsed.value);
      if (!base) {
        await ui.addEntry('Usage: api set <https://backend.example.com>');
        return;
      }
      saveUserAiSettings({ ...userAiSettings, apiBaseUrl: base });
      await ui.addEntry(`API base set to ${base}`);
      return;
    }
    if (parsed.action === 'clear') {
      saveUserAiSettings({ ...userAiSettings, apiBaseUrl: '' });
      await ui.addEntry('API base cleared. Using same-origin endpoints.');
      return;
    }
    await ui.addEntry('Usage: api show | api set <https://backend.example.com> | api clear');
    return;
  }

  if (parsed.type === 'key') {
    if (parsed.action === 'help') {
      await ui.addEntry('Usage: key show | key set <openai|perplexity> <api_key> | key provider <openai|perplexity> | key clear');
      return;
    }

    if (parsed.action === 'show') {
      const providerText = userAiSettings.provider || '(not set)';
      const keyText = maskApiKey(userAiSettings.apiKey);
      await ui.addEntry(`User key settings | provider: ${providerText} | key: ${keyText} | api: ${getEffectiveApiBaseUrl() || '(same-origin)'} | mode: ${normalizeMode(userAiSettings.mode)} | sources: ${userAiSettings.sources ? 'on' : 'off'} | memory: ${userAiSettings.memoryEnabled ? 'on' : 'off'} | sound: ${userAiSettings.soundMuted ? 'muted' : `${userAiSettings.soundVolume}%`} | post: ${normalizePostMode(userAiSettings.postMode)}`);
      return;
    }

    if (parsed.action === 'clear') {
      saveUserAiSettings({ ...userAiSettings, provider: '', apiKey: '' });
      await ui.addEntry('Stored provider and API key cleared from this browser.');
      return;
    }

    if (parsed.action === 'provider') {
      const provider = normalizeProvider(parsed.provider);
      if (!provider) {
        await ui.addEntry('Usage: key provider <openai|perplexity>');
        return;
      }
      saveUserAiSettings({ ...userAiSettings, provider });
      await ui.addEntry(`Provider set to ${provider}.`);
      return;
    }

    if (parsed.action === 'set') {
      const provider = normalizeProvider(parsed.provider);
      const key = String(parsed.apiKey || '').trim();
      if (!provider || !key) {
        await ui.addEntry('Usage: key set <openai|perplexity> <api_key>');
        return;
      }
      saveUserAiSettings({ ...userAiSettings, provider, apiKey: key });
      await ui.addEntry(`Saved API key for ${provider}. Stored locally in this browser and reused after refresh.`);
      return;
    }

    await ui.addEntry('Usage: key show | key set <openai|perplexity> <api_key> | key provider <openai|perplexity> | key clear');
    return;
  }

  if (parsed.type === 'cancel') {
    cancelActiveAndQueue();
    return;
  }

  if (parsed.type === 'retry') {
    if (!lastFailedCommand) {
      await ui.addEntry('No failed command available to retry.');
      return;
    }
    await ui.addEntry(`Retrying: ${lastFailedCommand}`);
    await executeCommand(lastFailedCommand);
    return;
  }

  if (parsed.type === 'status') {
    await runBackendCommand('status', 'Collecting system status');
    return;
  }

  if (parsed.type === 'metrics') {
    const loading = ui.createLoadingEntry('Collecting metrics');
    const controller = new AbortController();
    activeAbortController = controller;
    try {
      const data = await fetchMetrics(controller.signal);
      const metrics = data?.metrics?.session || {};
      const avg = Number(metrics?.latency?.avgMs || 0).toFixed(0);
      const errRate = Number(metrics?.errorRate || 0).toFixed(1);
      const provider = metrics?.provider || {};
      const usage = metrics?.usage || {};
      loading.done(
        `Metrics | asks: ${metrics.askRequests || 0} | avg latency: ${avg}ms | error rate: ${errRate}% | stream ok/fail: ${metrics.streamSuccess || 0}/${metrics.streamErrors || 0} | provider ok: OAI ${provider.openai?.success || 0}, PPLX ${provider.perplexity?.success || 0} | est tokens: ${usage.totalTokens || 0} | est cost: $${Number(usage.estimatedCostUsd || 0).toFixed(4)}`
      );
      audio.playAckSound();
    } catch (err) {
      if (controller.signal.aborted) {
        loading.fail('Metrics request cancelled.');
      } else {
        loading.fail(err.message || 'Failed to load metrics.');
      }
      audio.playErrorSound();
    } finally {
      if (activeAbortController === controller) activeAbortController = null;
    }
    return;
  }

  if (parsed.type === 'settings') {
    const providerText = userAiSettings.provider || '(not set)';
    const keyText = maskApiKey(userAiSettings.apiKey);
    await ui.addEntry(`Settings | provider: ${providerText} | key: ${keyText} | api: ${getEffectiveApiBaseUrl() || '(same-origin)'} | mode: ${normalizeMode(userAiSettings.mode)} | sources: ${userAiSettings.sources ? 'on' : 'off'} | memory: ${userAiSettings.memoryEnabled ? 'on' : 'off'} | sound: ${userAiSettings.soundMuted ? 'muted' : `${userAiSettings.soundVolume}%`} | post: ${normalizePostMode(userAiSettings.postMode)} | pins: ${userPins.length}`);
    return;
  }

  if (parsed.type === 'ask') {
    await runAskCommand(parsed.prompt, rawInput.trim());
    return;
  }

  if (parsed.type === 'remote') {
    if (['weather', 'docs', 'code', 'summarize-url'].includes(parsed.command)) {
      await runBackendCommand(rawInput.trim(), `Running ${parsed.command} plugin`);
      return;
    }
  }

  await runAskCommand(rawInput.trim(), rawInput.trim());
}

async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (commandQueue.length > 0) {
      const next = commandQueue.shift();
      try {
        await executeCommand(next);
      } catch (err) {
        await ui.addEntry(`Unexpected command failure: ${err?.message || 'Unknown error'}`, 'bot', { animate: false });
        audio.playErrorSound();
      }
    }
  } finally {
    queueRunning = false;
  }
}

function sleepMs(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPostRow(leftLabel, leftValue, rightLabel, rightValue) {
  const left = `${leftLabel.padEnd(17)}: ${leftValue}`;
  const right = `${rightLabel.padEnd(17)}: ${rightValue}`;
  return `${left.padEnd(42)}${right}`;
}

function formatRtcStamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

function createBootScenario(postMode) {
  const cmosWarning = Math.random() < 0.14;
  const rtcWarning = Math.random() < 0.08;
  const noBootable = Math.random() < (postMode === 'full' ? 0.03 : 0.015);
  const smartWarning = Math.random() < 0.06;
  return {
    cmosWarning,
    rtcWarning,
    noBootable,
    smartWarning,
    hasWarning: cmosWarning || rtcWarning || smartWarning || noBootable
  };
}

async function renderBootBios() {
  const postMode = normalizePostMode(userAiSettings.postMode);
  const scenario = createBootScenario(postMode);
  if (!bootBios) return scenario;

  const lines = [];
  const pciRows = postMode === 'fast' ? BIOS_PCI_ROWS.slice(0, 2) : BIOS_PCI_ROWS;
  const memoryStep = postMode === 'fast' ? 8192 : 2048;
  const memoryIterations = Math.ceil(BOOT_MEMORY_TOTAL_K / memoryStep);
  const delBlinkCycles = prefersReducedMotion ? 1 : postMode === 'fast' ? 5 : 8;
  const delayScale = prefersReducedMotion ? 0 : postMode === 'fast' ? 1.6 : 2.15;
  const baseDelay = Math.round((postMode === 'fast' ? 22 : 44) * delayScale);
  const totalOps =
    23 +
    memoryIterations +
    pciRows.length +
    delBlinkCycles +
    (scenario.cmosWarning ? 1 : 0) +
    (scenario.noBootable ? 2 : 0);
  let doneOps = 0;

  const commit = (showDelPrompt = false) => {
    const prompt = showDelPrompt ? '\nPress DEL to enter SETUP' : '\n';
    bootBios.textContent = `${lines.join('\n')}${prompt}`;
  };

  const advanceProgress = (weight = 1) => {
    doneOps += weight;
    const progress = Math.min(64, Math.round((doneOps / totalOps) * 64));
    if (bootMeterFill) bootMeterFill.style.width = `${progress}%`;
    if (bootPercent) bootPercent.textContent = `${progress}%`;
  };

  const addLine = async (line, delayMs = baseDelay) => {
    lines.push(line);
    commit(false);
    advanceProgress();
    if (Math.random() > 0.7) audio.playPostTick();
    await sleepMs(delayMs);
  };

  await addLine('Award Modular BIOS v4.51PG, An Energy Star Ally');
  await addLine('Copyright (C) 1984-1998, Award Software, Inc.');
  await addLine('ION_PHOSPHOR BIOS Build 09/13/1998');
  await addLine('');
  await addLine(formatPostRow('CPU Type', 'PENTIUM-S', 'Base Memory', '640K'));
  await addLine(formatPostRow('Co-Processor', 'Installed', 'Extended Memory', '31744K'));
  await addLine(formatPostRow('CPU Clock', '75MHz', 'Cache Memory', 'None'));

  const memoryLineIndex = lines.length;
  lines.push(`Memory Test        : ${String(0).padStart(5, ' ')}K`);
  commit(false);
  for (let memory = memoryStep; memory <= BOOT_MEMORY_TOTAL_K; memory += memoryStep) {
    const shown = Math.min(memory, BOOT_MEMORY_TOTAL_K);
    lines[memoryLineIndex] = `Memory Test        : ${String(shown).padStart(5, ' ')}K`;
    commit(false);
    advanceProgress();
    if ((memory / memoryStep) % 2 === 0) audio.playPostTick();
    await sleepMs(baseDelay);
  }
  lines[memoryLineIndex] = `Memory Test        : ${String(BOOT_MEMORY_TOTAL_K).padStart(5, ' ')}K OK`;
  commit(false);
  await sleepMs(baseDelay);
  await sleepMs(prefersReducedMotion ? 0 : baseDelay * 2);

  await addLine('--------------------------------------------------------------------------');
  await addLine(formatPostRow('Diskette Drive A', '2.88M, 3.5 in.', 'Display Type', 'EGA/VGA'));
  audio.playDriveSeek();
  await addLine(formatPostRow('Diskette Drive B', 'None', 'Serial Port(s)', '3F8 2F8'));
  await addLine(formatPostRow('Primary Master', 'LBA,Mode 2,2621MB', 'Parallel Port(s)', '378'));
  audio.playDriveSeek();
  await addLine(formatPostRow('Primary Slave', 'CDROM,Mode 4', 'EDO DRAM Rows', 'None'));
  await addLine(formatPostRow('Secondary Master', 'None', 'SDRAM Rows', '0 1 2 3 4'));
  await addLine(formatPostRow('Secondary Slave', 'None', 'L2 Cache Type', 'None'));
  await addLine(formatPostRow('Keyboard', 'Detected', 'PS/2 Mouse', 'Detected'));
  await addLine(formatPostRow('USB Legacy', 'Enabled', 'SMART Status', scenario.smartWarning ? 'WARNING' : 'GOOD'));
  await addLine(formatPostRow('Boot Sequence', 'A:, C:, CDROM', 'DMI Checksum', 'OK'));

  if (scenario.rtcWarning) {
    await addLine('CMOS Date/Time Not Set - Press F1 to continue');
  } else {
    await addLine(`RTC Time           : ${formatRtcStamp()}`);
  }

  if (scenario.cmosWarning) {
    await addLine('CMOS checksum error - Defaults loaded');
  }

  await addLine('');
  await addLine('PCI device listing.....');
  await addLine('Bus No. Device No. Func No. Vendor ID  Device ID  Device Class       IRQ');
  await addLine('--------------------------------------------------------------------------');
  for (const row of pciRows) {
    await addLine(row);
  }
  await sleepMs(prefersReducedMotion ? 0 : baseDelay * 2);

  await addLine('');
  await addLine('Initializing IDE/SATA channels...');
  audio.playDriveSeek();
  await addLine('Primary Master   ... OK');
  audio.playDriveSeek();
  await addLine('Primary Slave    ... OK');
  await addLine('Secondary Master ... None');
  await addLine('Secondary Slave  ... None');
  await addLine('Verifying DMI Pool Data .......');

  for (let i = 0; i < delBlinkCycles; i += 1) {
    commit(i % 2 === 0);
    advanceProgress();
    await sleepMs(prefersReducedMotion ? 0 : 120);
  }
  commit(false);

  if (scenario.noBootable) {
    audio.playBiosCode('error');
    await addLine('No bootable device -- insert boot disk and press any key');
    await addLine('Fallback boot sector found on C: ... continuing');
  } else if (scenario.hasWarning) {
    audio.playBiosCode('warning');
  } else {
    audio.playBiosCode('ok');
  }

  await addLine('Starting CASCADE OS....', prefersReducedMotion ? 0 : 280);
  return scenario;
}

async function initSystem() {
  await audio.resume();
  applySoundSettings();
  bootInitBtn.style.display = 'none';
  if (bootBios) bootBios.textContent = '';
  if (bootMeterFill) bootMeterFill.style.width = '0%';
  if (bootPercent) bootPercent.textContent = '0%';
  audio.playBootSound();

  const scenario = await renderBootBios();

  if (!prefersReducedMotion) {
    if (bootMeterFill) bootMeterFill.style.width = '100%';
    if (bootPercent) bootPercent.textContent = '100%';
    await sleepMs(scenario?.noBootable ? 1500 : 1100);
  }

  const finishBoot = () => {
    bootScreen.remove();
    cliInput.focus();
  };

  if (prefersReducedMotion) {
    finishBoot();
    return;
  }

  setTimeout(() => {
    if (bootMeterFill) bootMeterFill.style.width = '100%';
    if (bootPercent) bootPercent.textContent = '100%';
    bootScreen.style.opacity = '0';
    setTimeout(finishBoot, 1000);
  }, 500);
}

async function loadRuntimeConfig() {
  try {
    const res = await fetch(apiUrl('/api/config'));
    const data = await res.json();
    if (data?.ok && data?.config) {
      applyTheme(data.config.defaultTheme || 'classic');
      if (!hasStoredUserAiSettings()) {
        saveUserAiSettings({
          ...userAiSettings,
          mode: data.config.askOutputMode || 'standard',
          sources: Boolean(data.config.askShowSources)
        });
      }
      return;
    }
    applyTheme('classic');
  } catch (_err) {
    applyTheme('classic');
  }
}

async function showStartupGuidance() {
  if (!hasSeenOnboarding()) {
    await ui.addEntry('Welcome. Type help to see terminal commands.', 'bot', { animate: false });
    await ui.addEntry('Tip: press Ctrl+K for command palette or type / for slash suggestions.', 'bot', { animate: false });
    await ui.addEntry('Tip: use sound volume 35 or sound mute for quieter operation.', 'bot', { animate: false });
    await ui.addEntry('Tip: use post fast (or post full) to control BIOS boot detail.', 'bot', { animate: false });
    markOnboardingSeen();
  }

  if (!userAiSettings.provider || !userAiSettings.apiKey) {
    await ui.addEntry('To enable AI replies, run: key set perplexity <your_key>', 'bot', { animate: false });
    await ui.addEntry('Your key will stay saved in this browser after refresh.', 'bot', { animate: false });
  }

  if (!getEffectiveApiBaseUrl() && window.location.hostname.includes('netlify')) {
    await ui.addEntry('Hosted frontend detected. Set backend endpoint: api set <https://your-backend.example.com>', 'bot', { animate: false });
  }
}

function wireInputHandlers() {
  ui.setPromptSymbol('>');

  if (paletteInputEl) {
    paletteInputEl.addEventListener('input', () => {
      paletteActiveIndex = 0;
      renderPalette(paletteInputEl.value);
    });

    paletteInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
        cliInput.focus();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (paletteResults.length > 0) {
          paletteActiveIndex = Math.min(paletteResults.length - 1, paletteActiveIndex + 1);
          renderPalette(paletteInputEl.value);
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (paletteResults.length > 0) {
          paletteActiveIndex = Math.max(0, paletteActiveIndex - 1);
          renderPalette(paletteInputEl.value);
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const selected = paletteResults[paletteActiveIndex] || paletteResults[0] || '';
        if (selected) {
          cliInput.value = selected;
        }
        closePalette();
        cliInput.focus();
      }
    });
  }

  cliInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
      return;
    }

    if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter' || e.key === 'Tab') {
      audio.playKeySound();
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      ui.clearTerminal();
      ui.addEntry('Terminal buffer cleared.', 'bot', { animate: false });
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      cancelActiveAndQueue('keyboard');
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const auto = autocompleteCommand(cliInput.value, COMMAND_LIST);
      if (auto.matches.length === 1) {
        cliInput.value = auto.nextInput;
      } else if (auto.matches.length > 1) {
        ui.addEntry(`Matches: ${auto.matches.join(', ')}`, 'bot', { animate: false });
      }
      return;
    }

    if (slashSuggestionsEl?.classList.contains('open')) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const items = [...slashSuggestionsEl.querySelectorAll('li')];
        if (items.length > 0) {
          slashActiveIndex = Math.min(items.length - 1, slashActiveIndex + 1);
          items.forEach((el, idx) => el.classList.toggle('active', idx === slashActiveIndex));
        }
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const items = [...slashSuggestionsEl.querySelectorAll('li')];
        if (items.length > 0) {
          slashActiveIndex = Math.max(0, slashActiveIndex - 1);
          items.forEach((el, idx) => el.classList.toggle('active', idx === slashActiveIndex));
        }
        return;
      }

      if (e.key === 'Enter' && cliInput.value.trim().startsWith('/')) {
        e.preventDefault();
        const items = [...slashSuggestionsEl.querySelectorAll('li')];
        const active = items[slashActiveIndex] || items[0];
        if (active) {
          const cmd = active.textContent.replace('/', '').trim();
          cliInput.value = `${cmd} `;
          slashSuggestionsEl.classList.remove('open');
          slashSuggestionsEl.innerHTML = '';
        }
        return;
      }
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (userCommandHistory.length === 0) return;
      historyIndex = Math.max(0, historyIndex - 1);
      cliInput.value = userCommandHistory[historyIndex];
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (userCommandHistory.length === 0) return;
      historyIndex = Math.min(userCommandHistory.length, historyIndex + 1);
      cliInput.value = historyIndex >= userCommandHistory.length ? '' : userCommandHistory[historyIndex];
      return;
    }

    if (e.key === 'Enter' && cliInput.value.trim() !== '') {
      const normalized = cliInput.value.trim();
      const val = normalized.startsWith('/') ? normalized.slice(1).trim() : normalized;
      if (!val) {
        cliInput.value = '';
        return;
      }
      ui.addEntry(val, 'user', { animate: false });
      userCommandHistory.push(val);
      historyIndex = userCommandHistory.length;
      cliInput.value = '';
      if (slashSuggestionsEl) {
        slashSuggestionsEl.classList.remove('open');
        slashSuggestionsEl.innerHTML = '';
      }

      const parsed = parseCommand(val);
      if (parsed.type === 'cancel') {
        cancelActiveAndQueue();
        return;
      }

      enqueueCommand(val);
    }
  });

  cliInput.addEventListener('input', () => {
    renderSlashSuggestions(cliInput.value);
  });

  document.body.addEventListener('click', (event) => {
    if (paletteEl?.contains(event.target)) return;
    if (paletteEl?.classList.contains('open')) closePalette();
    cliInput.focus();
  });
}

bootInitBtn.addEventListener('click', initSystem);
window.addEventListener('resize', resizeMatrix);
resizeMatrix();
window.requestAnimationFrame(animateMatrix);
wireInputHandlers();
userAiSettings = loadUserAiSettings();
userPins = loadJsonArray(USER_PINS_STORAGE_KEY, 25);
userMemories = loadJsonArray(USER_MEMORIES_STORAGE_KEY, 30);
sessionTurns = loadSessionTurns();
sessionId = getOrCreateSessionId();
renderPinsPanel();
renderSourcesPanel();
applySoundSettings();
loadRuntimeConfig();
showStartupGuidance();
