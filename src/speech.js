let isMuted = false;
let lipSyncInterval = null;
let audioContext = null;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

export function initKokoro() {}

export function speak(text, vrm, onStart, onEnd) {
  if (isMuted) {
    onEnd?.();
    return;
  }

  if (window._currentAudioSource) {
    try { window._currentAudioSource.stop(); } catch {}
    window._currentAudioSource = null;
  }
  clearLipSync(vrm);

  fetch(`${SUPABASE_URL}/functions/v1/elevenlabs-tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ text }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
      return res.arrayBuffer();
    })
    .then((arrayBuffer) => {
      const ctx = getAudioContext();
      return ctx.decodeAudioData(arrayBuffer);
    })
    .then((audioBuffer) => {
      const ctx = getAudioContext();
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      source.onended = () => {
        clearLipSync(vrm);
        onEnd?.();
      };

      onStart?.();
      startLipSync(vrm);
      source.start();
      window._currentAudioSource = source;
    })
    .catch((err) => {
      console.warn('ElevenLabs TTS error:', err);
      onEnd?.();
    });
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
  if (window._currentAudioSource) {
    try { window._currentAudioSource.stop(); } catch {}
    window._currentAudioSource = null;
  }
  clearLipSync(vrm);
}

export function toggleMute() {
  isMuted = !isMuted;
  if (isMuted) {
    if (window._currentAudioSource) {
      try { window._currentAudioSource.stop(); } catch {}
      window._currentAudioSource = null;
    }
  }
  return isMuted;
}
