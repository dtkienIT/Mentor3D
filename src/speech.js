let isMuted = false;
let currentUtterance = null;
let lipSyncInterval = null;

const VIETNAMESE_REGEX = /[\u00C0-\u00C3\u00C8-\u00CA\u00CC-\u00CD\u00D2-\u00D5\u00D9-\u00DA\u00DD\u00E0-\u00E3\u00E8-\u00EA\u00EC-\u00ED\u00F2-\u00F5\u00F9-\u00FA\u00FD\u0102-\u0103\u0110-\u0111\u0128-\u0129\u0168-\u0169\u01A0-\u01B0\u1EA0-\u1EF9]/;

function isVietnameseText(text) {
  return VIETNAMESE_REGEX.test(text);
}

function selectVoice(text) {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  if (isVietnameseText(text)) {
    const viVoice = voices.find((v) =>
      v.lang.startsWith('vi') ||
      v.name.includes('Linh') ||
      v.name.includes('An')
    );
    if (viVoice) return viVoice;
  }

  return voices.find((v) =>
    v.name.includes('Female') ||
    v.name.includes('Samantha') ||
    v.name.includes('Google UK English Female') ||
    v.name.includes('Zira')
  ) || null;
}

export function speak(text, vrm, onStart, onEnd) {
  if (isMuted || !window.speechSynthesis) {
    onEnd?.();
    return;
  }

  window.speechSynthesis.cancel();
  clearLipSync(vrm);

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.2;
  utterance.volume = 0.9;

  const voice = selectVoice(text);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }

  utterance.onstart = () => {
    onStart?.();
    startLipSync(vrm);
  };

  utterance.onend = () => {
    clearLipSync(vrm);
    onEnd?.();
  };

  utterance.onerror = () => {
    clearLipSync(vrm);
    onEnd?.();
  };

  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
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
  window.speechSynthesis.cancel();
  clearLipSync(vrm);
}

export function toggleMute() {
  isMuted = !isMuted;
  if (isMuted) window.speechSynthesis.cancel();
  return isMuted;
}

export function getIsMuted() {
  return isMuted;
}
