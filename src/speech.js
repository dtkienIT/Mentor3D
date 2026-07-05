let isMuted = false;
let lipSyncInterval = null;
let currentAudio = null;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export function initKokoro() {}

export function speak(text, vrm, onStart, onEnd) {
  if (isMuted) {
    onEnd?.();
    return;
  }

  stopSpeaking(vrm);

  const audio = new Audio();
  currentAudio = audio;

  const mediaSource = new MediaSource();
  audio.src = URL.createObjectURL(mediaSource);

  let sourceBuffer = null;
  let queue = [];
  let streamDone = false;

  mediaSource.addEventListener('sourceopen', () => {
    sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');

    sourceBuffer.addEventListener('updateend', () => {
      if (queue.length > 0 && !sourceBuffer.updating) {
        sourceBuffer.appendBuffer(queue.shift());
      } else if (streamDone && queue.length === 0 && !sourceBuffer.updating) {
        if (mediaSource.readyState === 'open') {
          mediaSource.endOfStream();
        }
      }
    });

    fetchStream();
  });

  audio.addEventListener('canplay', () => {
    audio.play().catch(() => {});
    onStart?.();
    startLipSync(vrm);
  }, { once: true });

  audio.addEventListener('ended', () => {
    clearLipSync(vrm);
    cleanup();
    onEnd?.();
  });

  audio.addEventListener('error', () => {
    clearLipSync(vrm);
    cleanup();
    onEnd?.();
  });

  function cleanup() {
    if (currentAudio === audio) currentAudio = null;
    URL.revokeObjectURL(audio.src);
  }

  function appendChunk(chunk) {
    if (!sourceBuffer) return;
    if (sourceBuffer.updating || queue.length > 0) {
      queue.push(chunk);
    } else {
      sourceBuffer.appendBuffer(chunk);
    }
  }

  async function fetchStream() {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/elevenlabs-tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error(`TTS failed: ${response.status}`);
      }

      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        appendChunk(value);
      }

      streamDone = true;
      if (sourceBuffer && !sourceBuffer.updating && queue.length === 0) {
        if (mediaSource.readyState === 'open') {
          mediaSource.endOfStream();
        }
      }
    } catch (err) {
      console.warn('ElevenLabs TTS error:', err);
      streamDone = true;
      if (mediaSource.readyState === 'open') {
        try { mediaSource.endOfStream(); } catch {}
      }
      clearLipSync(vrm);
      cleanup();
      onEnd?.();
    }
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
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  clearLipSync(vrm);
}

export function toggleMute() {
  isMuted = !isMuted;
  if (isMuted && currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  return isMuted;
}
