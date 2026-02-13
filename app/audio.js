export function createAudioEngine() {
  const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
  const audioCtx = AudioContextImpl ? new AudioContextImpl() : null;
  let keySoundCooldownMs = 0;
  let muted = false;
  let volume = 0.55;
  const masterGain = audioCtx ? audioCtx.createGain() : null;
  const compressor = audioCtx ? audioCtx.createDynamicsCompressor() : null;
  const noiseBuffer = (() => {
    if (!audioCtx) return null;
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.2, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  })();

  if (audioCtx && masterGain && compressor) {
    compressor.threshold.setValueAtTime(-20, audioCtx.currentTime);
    compressor.knee.setValueAtTime(20, audioCtx.currentTime);
    compressor.ratio.setValueAtTime(10, audioCtx.currentTime);
    compressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
    compressor.release.setValueAtTime(0.25, audioCtx.currentTime);
    masterGain.gain.setValueAtTime(volume, audioCtx.currentTime);
    masterGain.connect(compressor);
    compressor.connect(audioCtx.destination);
  }

  function playBeep(freq, dur, type = 'sine', vol = 0.1) {
    if (!audioCtx || !masterGain || muted) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const now = audioCtx.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.00001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.00001, vol), now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.00001, now + dur);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start();
    osc.stop(now + dur + 0.01);
  }

  function playNoiseBurst(dur = 0.06, vol = 0.02, highpassHz = 400) {
    if (!audioCtx || !masterGain || muted || !noiseBuffer) return;
    const now = audioCtx.currentTime;
    const source = audioCtx.createBufferSource();
    source.buffer = noiseBuffer;
    const hp = audioCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(highpassHz, now);
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(Math.max(0.00001, vol), now);
    gain.gain.exponentialRampToValueAtTime(0.00001, now + dur);
    source.connect(hp);
    hp.connect(gain);
    gain.connect(masterGain);
    source.start(now);
    source.stop(now + dur);
  }

  function playKeySound() {
    if (!audioCtx || muted) return;
    const now = performance.now();
    if (now - keySoundCooldownMs < 40) return;
    keySoundCooldownMs = now;
    playBeep(2200, 0.035, 'triangle', 0.02);
    playBeep(720, 0.03, 'sine', 0.008);
  }

  function playBootSound() {
    if (!audioCtx || muted) return;
    const now = audioCtx.currentTime;

    // Starter click + low rumble "engine spin-up".
    playNoiseBurst(0.08, 0.03, 120);
    setTimeout(() => playNoiseBurst(0.05, 0.022, 240), 70);

    const oscA = audioCtx.createOscillator();
    const oscB = audioCtx.createOscillator();
    const filter = audioCtx.createBiquadFilter();
    const gain = audioCtx.createGain();

    oscA.type = 'sawtooth';
    oscB.type = 'sawtooth';
    oscA.detune.setValueAtTime(-7, now);
    oscB.detune.setValueAtTime(7, now);
    oscA.frequency.setValueAtTime(38, now);
    oscB.frequency.setValueAtTime(41, now);
    oscA.frequency.exponentialRampToValueAtTime(92, now + 0.42);
    oscB.frequency.exponentialRampToValueAtTime(100, now + 0.42);
    oscA.frequency.exponentialRampToValueAtTime(130, now + 0.72);
    oscB.frequency.exponentialRampToValueAtTime(138, now + 0.72);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180, now);
    filter.frequency.exponentialRampToValueAtTime(1400, now + 0.72);
    filter.Q.setValueAtTime(2.2, now);

    gain.gain.setValueAtTime(0.00001, now);
    gain.gain.exponentialRampToValueAtTime(0.028, now + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.48);
    gain.gain.exponentialRampToValueAtTime(0.00001, now + 0.82);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    oscA.start(now);
    oscB.start(now);
    oscA.stop(now + 0.86);
    oscB.stop(now + 0.86);

    // BIOS confirmation chirps after spin-up.
    setTimeout(() => playBeep(740, 0.065, 'square', 0.028), 860);
    setTimeout(() => playBeep(1010, 0.07, 'square', 0.03), 980);
  }

  function playPostTick() {
    if (!audioCtx || muted) return;
    playBeep(980, 0.025, 'square', 0.014);
  }

  function playDriveSeek() {
    if (!audioCtx || muted) return;
    playNoiseBurst(0.04, 0.018, 900);
    playBeep(240, 0.02, 'sawtooth', 0.012);
    setTimeout(() => {
      playNoiseBurst(0.035, 0.015, 1100);
      playBeep(320, 0.02, 'sawtooth', 0.01);
    }, 35);
    setTimeout(() => {
      playNoiseBurst(0.028, 0.012, 1300);
      playBeep(190, 0.018, 'sawtooth', 0.009);
    }, 68);
  }

  function playAckSound() {
    if (!audioCtx || muted) return;
    playBeep(980, 0.08, 'sine', 0.03);
    setTimeout(() => playBeep(1240, 0.08, 'sine', 0.025), 90);
  }

  function playErrorSound() {
    if (!audioCtx || muted) return;
    playBeep(420, 0.12, 'sawtooth', 0.025);
    setTimeout(() => playBeep(260, 0.16, 'sawtooth', 0.02), 100);
  }

  function playBiosCode(kind = 'ok') {
    if (!audioCtx || muted) return;

    if (kind === 'warning') {
      playBeep(620, 0.28, 'square', 0.035);
      setTimeout(() => playBeep(510, 0.22, 'square', 0.03), 320);
      return;
    }

    if (kind === 'error') {
      playBeep(290, 0.42, 'sawtooth', 0.04);
      setTimeout(() => playBeep(250, 0.42, 'sawtooth', 0.04), 470);
      return;
    }

    playBeep(950, 0.08, 'square', 0.03);
  }

  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    if (audioCtx && masterGain) {
      masterGain.gain.setValueAtTime(muted ? 0 : volume, audioCtx.currentTime);
    }
  }

  function setVolume(nextVolume) {
    const normalized = Number.isFinite(Number(nextVolume)) ? Number(nextVolume) : volume;
    volume = Math.min(1, Math.max(0, normalized));
    if (audioCtx && masterGain && !muted) {
      masterGain.gain.setValueAtTime(volume, audioCtx.currentTime);
    }
  }

  function getStatus() {
    return {
      available: Boolean(audioCtx),
      muted,
      volume
    };
  }

  async function resume() {
    if (!audioCtx) return;
    if (audioCtx.state !== 'running') {
      await audioCtx.resume();
    }
  }

  return {
    playKeySound,
    playBootSound,
    playPostTick,
    playDriveSeek,
    playAckSound,
    playErrorSound,
    playBiosCode,
    setMuted,
    setVolume,
    getStatus,
    resume
  };
}
