let isMuted = false;
let lipSyncInterval = null;
let currentUtterance = null;

export function initKokoro() {}

function pickVietnameseFemaleVoice() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;

  // prefer vi-VN voices
  const viVoices = voices.filter((v) => v.lang.startsWith('vi'));

  const femaleKeywords = ['female', 'woman', 'girl', 'thu', 'lan', 'mai', 'hoa', 'linh', 'ha', 'huong'];

  const pool = viVoices.length ? viVoices : voices;

  const scored = pool.map((v) => {
    const name = v.name.toLowerCase();
    let score = 0;
    if (femaleKeywords.some((k) => name.includes(k))) score += 10;
    if (name.includes('male') && !name.includes('female')) score -= 20;
    if (v.lang === 'vi-VN') score += 5;
    if (v.localService) score += 2;
    return { v, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.v ?? pool[0] ?? voices[0];
}

export function speak(text, vrm, onStart, onEnd) {
  if (isMuted) {
    onEnd?.();
    return;
  }

  stopSpeaking(vrm);

  const utterance = new SpeechSynthesisUtterance(text);
  currentUtterance = utterance;

  const assignVoice = () => {
    const voice = pickVietnameseFemaleVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || 'vi-VN';
    } else {
      utterance.lang = 'vi-VN';
    }
    utterance.rate = 0.95;
    utterance.pitch = 1.1;
    utterance.volume = 1.0;

    utterance.onstart = () => {
      onStart?.();
      startLipSync(vrm);
    };

    utterance.onend = () => {
      clearLipSync(vrm);
      currentUtterance = null;
      onEnd?.();
    };

    utterance.onerror = () => {
      clearLipSync(vrm);
      currentUtterance = null;
      onEnd?.();
    };

    speechSynthesis.speak(utterance);
  };

  // voices may not be loaded yet on first call
  if (speechSynthesis.getVoices().length > 0) {
    assignVoice();
  } else {
    speechSynthesis.addEventListener('voiceschanged', assignVoice, { once: true });
  }
}

function startLipSync(vrm) {
  const mgr = vrm.expressionManager;
  if (!mgr) return;

  const mouthShapes = ['aa', 'ih', 'ou', 'ee', 'oh'];
  let frame = 0;

  lipSyncInterval = setInterval(() => {
    const shape = mouthShapes[frame % mouthShapes.length];
    const openness = 0.3 + Math.random() * 0.5;

    mouthShapes.forEach((s) => {
      try { mgr.setValue(s, 0); } catch {}
    });
    try { mgr.setValue(shape, openness); } catch {}
    mgr.update?.();
    frame++;
  }, 100);
}

function clearLipSync(vrm) {
  if (lipSyncInterval) {
    clearInterval(lipSyncInterval);
    lipSyncInterval = null;
  }
  const mgr = vrm.expressionManager;
  if (!mgr) return;
  ['aa', 'ih', 'ou', 'ee', 'oh'].forEach((s) => {
    try { mgr.setValue(s, 0); } catch {}
  });
  mgr.update?.();
}

export function stopSpeaking(vrm) {
  speechSynthesis.cancel();
  currentUtterance = null;
  clearLipSync(vrm);
}

export function toggleMute() {
  isMuted = !isMuted;
  if (isMuted) {
    speechSynthesis.cancel();
    currentUtterance = null;
  }
  return isMuted;
}
