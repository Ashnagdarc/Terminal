const SPINNER_FRAMES = ['|', '/', '-', '\\'];

export function createUI({ chatLog, liveRegion, maxEntries = 140, reducedMotion = false }) {
  function trimLog() {
    while (chatLog.children.length > maxEntries) {
      chatLog.removeChild(chatLog.firstElementChild);
    }
  }

  function announce(text) {
    if (!liveRegion) return;
    liveRegion.textContent = '';
    window.requestAnimationFrame(() => {
      liveRegion.textContent = text;
    });
  }

  function makeEntry(type = 'bot') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const label = type === 'user' ? 'GUEST@SYS' : 'CASCADE@OS';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'label';
    labelSpan.textContent = `[${label}]`;

    const contentSpan = document.createElement('span');
    contentSpan.className = 'content';

    entry.appendChild(labelSpan);
    entry.appendChild(contentSpan);
    chatLog.appendChild(entry);
    trimLog();
    chatLog.scrollTop = chatLog.scrollHeight;

    return { entry, contentSpan };
  }

  function addEntry(text, type = 'bot', options = {}) {
    const animate = options.animate !== false && !reducedMotion;
    const { contentSpan } = makeEntry(type);
    const value = String(text ?? '');

    return new Promise((resolve) => {
      if (!animate) {
        contentSpan.textContent = value;
        announce(value);
        resolve();
        return;
      }

      let i = 0;
      const timer = setInterval(() => {
        contentSpan.textContent += value.charAt(i);
        i += 1;
        if (i >= value.length) {
          clearInterval(timer);
          announce(value);
          resolve();
        }
      }, 12);
    });
  }

  function createLoadingEntry(label = 'Processing request') {
    const { entry, contentSpan } = makeEntry('bot');
    let frame = 0;
    let streamingMode = false;
    const startMs = Date.now();
    let appendBuffer = '';
    let flushQueued = false;

    const spinner = setInterval(() => {
      if (!streamingMode) {
        const elapsed = Math.floor((Date.now() - startMs) / 1000);
        contentSpan.textContent = `${label} ${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} (${elapsed}s)`;
        frame += 1;
      }
    }, 120);

    function flushBuffer() {
      if (!appendBuffer) return;
      contentSpan.textContent += appendBuffer;
      appendBuffer = '';
      flushQueued = false;
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    return {
      startStream(initialText = '') {
        streamingMode = true;
        clearInterval(spinner);
        contentSpan.textContent = initialText;
      },
      append(text) {
        if (!streamingMode) this.startStream('');
        appendBuffer += text;
        if (!flushQueued) {
          flushQueued = true;
          window.requestAnimationFrame(flushBuffer);
        }
      },
      done(finalText) {
        clearInterval(spinner);
        flushBuffer();
        if (typeof finalText === 'string') {
          contentSpan.textContent = finalText;
        }
        announce(contentSpan.textContent || label);
      },
      fail(message, retryHint = '') {
        clearInterval(spinner);
        flushBuffer();
        entry.classList.add('system');
        contentSpan.textContent = retryHint ? `${message} ${retryHint}` : message;
        announce(contentSpan.textContent);
      },
      remove() {
        clearInterval(spinner);
        entry.remove();
      }
    };
  }

  function clearTerminal() {
    chatLog.innerHTML = '';
  }

  function setPromptSymbol(symbol = '>') {
    const prompt = document.querySelector('.prompt');
    if (prompt) prompt.textContent = symbol;
  }

  return {
    addEntry,
    clearTerminal,
    createLoadingEntry,
    setPromptSymbol
  };
}
