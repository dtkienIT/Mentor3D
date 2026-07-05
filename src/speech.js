let isMuted = false;
let lipSyncInterval = null;
let kokoroTTS = null;
let kokoroLoading = false;
let kokoroReady = false;
let audioContext = null;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const VIETNAMESE_REGEX = /[\u00C0-\u00C3\u00C8-\u00CA\u00CC-\u00CD\u00D2-\u00D5\u00D9-\u00DA\u00DD\u00E0-\u00E3\u00E8-\u00EA\u00EC-\u00ED\u00F2-\u00F5\u00F9-\u00FA\u00FD\u0102-\u0103\u0110-\u0111\u0128-\u0129\u0168-\u0169\u01A0-\u01B0\u1EA0-\u1EF9]/;

function isVietnameseText(text) {
  return VIETNAMESE_REGEX.test(text);
}

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

export function initKokoro() {
  if (kokoroLoading || kokoroReady) return;
  kokoroLoading = true;

  import('kokoro-js').then(({ KokoroTTS }) => {
    return KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'q8',
      device: 'wasm',
    });
  }).then((tts) => {
    kokoroTTS = tts;
    kokoroReady = true;
    kokoroLoading = false;
    console.log('Kokoro TTS ready');
  }).catch((err) => {
    console.warn('Kokoro TTS failed to load:', err);
    kokoroLoading = false;
  });
}

function playAudioBuffer(arrayBuffer, vrm, onStart, onEnd) {
  const ctx = getAudioContext();
  ctx.decodeAudioData(arrayBuffer).then((audioBuffer) => {
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
  }).catch((err) => {
    console.warn('Audio decode failed:', err);
    clearLipSync(vrm);
    onEnd?.();
  });
}

async function speakWithEdgeTTS(text, vrm, onStart, onEnd) {
  const voice = isVietnameseText(text)
    ? 'vi-VN-HoaiMyNeural'
    : 'en-US-AvaMultilingualNeural';

  const response = await fetch(`${SUPABASE_URL}/functions/v1/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ text, voice }),
  });

  if (!response.ok) {
    throw new Error(`Edge TTS: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength < 100) {
    throw new Error('Edge TTS returned empty audio');
  }

  playAudioBuffer(arrayBuffer, vrm, onStart, onEnd);
}

async function speakWithKokoro(text, vrm, onStart, onEnd) {
  const audio = await kokoroTTS.generate(text, { voice: 'af_heart' });
  const ctx = getAudioContext();
  const floatData = audio.audio;
  const sampleRate = audio.sampling_rate || 24000;
  const audioBuffer = ctx.createBuffer(1, floatData.length, sampleRate);
  audioBuffer.getChannelData(0).set(floatData);

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
}

function speakWithWebSpeech(text, vrm, onStart, onEnd) {
  if (!window.speechSynthesis) {
    onEnd?.();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.1;
  utterance.volume = 0.9;

  const voices = window.speechSynthesis.getVoices();

  if (isVietnameseText(text)) {
    const viVoice = voices.find((v) => v.lang.startsWith('vi'));
    if (viVoice) {
      utterance.voice = viVoice;
      utterance.lang = viVoice.lang;
    }
  } else {
    const femaleVoice = voices.find((v) =>
      v.name.includes('Female') ||
      v.name.includes('Samantha') ||
      (v.name.includes('Google') && v.name.includes('Female')) ||
      v.name.includes('Zira')
    );
    if (femaleVoice) {
      utterance.voice = femaleVoice;
      utterance.lang = femaleVoice.lang;
    }
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

  window.speechSynthesis.speak(utterance);
}

export function speak(text, vrm, onStart, onEnd) {
  if (isMuted) {
    onEnd?.();
    return;
  }

  window.speechSynthesis?.cancel();
  if (window._currentAudioSource) {
    try { window._currentAudioSource.stop(); } catch {}
    window._currentAudioSource = null;
  }
  clearLipSync(vrm);

  const isVi = isVietnameseText(text);

  if (isVi) {
    speakWithEdgeTTS(text, vrm, onStart, onEnd).catch(() => {
      speakWithWebSpeech(text, vrm, onStart, onEnd);
    });
  } else if (kokoroReady) {
    speakWithKokoro(text, vrm, onStart, onEnd).catch(() => {
      speakWithEdgeTTS(text, vrm, onStart, onEnd).catch(() => {
        speakWithWebSpeech(text, vrm, onStart, onEnd);
      });
    });
  } else {
    speakWithEdgeTTS(text, vrm, onStart, onEnd).catch(() => {
      speakWithWebSpeech(text, vrm, onStart, onEnd);
    });
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
  window.speechSynthesis?.cancel();
  if (window._currentAudioSource) {
    try { window._currentAudioSource.stop(); } catch {}
    window._currentAudioSource = null;
  }
  clearLipSync(vrm);
}

export function toggleMute() {
  isMuted = !isMuted;
  if (isMuted) {
    window.speechSynthesis?.cancel();
    if (window._currentAudioSource) {
      try { window._currentAudioSource.stop(); } catch {}
      window._currentAudioSource = null;
    }
  }
  return isMuted;
}
