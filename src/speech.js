let isMuted = false;
let currentUtterance = null;
let lipSyncInterval = null;

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

  const voices = window.speechSynthesis.getVoices();
  const femaleVoice = voices.find((v) =>
    v.name.includes('Female') || v.name.includes('Samantha') ||
    v.name.includes('Google UK English Female') || v.name.includes('Zira')
  );
  if (femaleVoice) utterance.voice = femaleVoice;

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
