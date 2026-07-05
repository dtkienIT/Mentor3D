import { supabase, isSupabaseConfigured } from './supabase.js';
import { sendToGemini } from './gemini.js';
import { speak, toggleMute, stopSpeaking } from './speech.js';
import { applyExpression } from './scene.js';

const STORAGE_KEY = 'mika_local_messages';

let conversationId = null;
let messages = [];
let isProcessing = false;

function isVietnamese() {
  return (window.navigator.language || '').startsWith('vi');
}

function getWelcomeMessage() {
  return isVietnamese()
    ? 'Xin ch\u00e0o! M\u00ecnh l\u00e0 Mika, tr\u1ee3 l\u00fd h\u1ecdc t\u1eadp 3D. H\u00f4m nay m\u00ecnh c\u00f3 th\u1ec3 gi\u00fap g\u00ec cho b\u1ea1n?'
    : 'Hi there! I\'m Mika. How can I help you today?';
}

function loadLocalMessages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalMessages(msgs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
  } catch {}
}

export function initChat(sceneCtx) {
  const { vrm } = sceneCtx;

  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');
  const btnMic = document.getElementById('btn-mic');
  const btnMute = document.getElementById('btn-mute');
  const statusText = document.getElementById('status-text');
  const iconUnmuted = document.getElementById('icon-unmuted');
  const iconMuted = document.getElementById('icon-muted');

  loadOrCreateConversation();

  btnSend.addEventListener('click', () => handleSend());
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  btnMute.addEventListener('click', () => {
    const muted = toggleMute();
    if (muted) stopSpeaking(vrm);
    iconUnmuted.style.display = muted ? 'none' : 'block';
    iconMuted.style.display = muted ? 'block' : 'none';
    btnMute.classList.toggle('muted', muted);
  });

  // Voice input
  let recognition = null;
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = window.navigator.language.startsWith('vi') ? 'vi-VN' : 'en-US';

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      chatInput.value = transcript;
      btnMic.classList.remove('active');
      handleSend();
    };

    recognition.onerror = () => {
      btnMic.classList.remove('active');
    };

    recognition.onend = () => {
      btnMic.classList.remove('active');
    };
  }

  btnMic.addEventListener('click', () => {
    if (!recognition) return;
    if (btnMic.classList.contains('active')) {
      recognition.stop();
      btnMic.classList.remove('active');
    } else {
      recognition.start();
      btnMic.classList.add('active');
    }
  });

  async function loadOrCreateConversation() {
    if (!isSupabaseConfigured) {
      conversationId = 'local-convo';
      messages = loadLocalMessages();
      messages.forEach((m) => appendMessage(m.sender, m.content));
      if (messages.length === 0) {
        appendMessage('assistant', getWelcomeMessage());
      }
      return;
    }

    try {
      const { data: convos } = await supabase
        .from('conversations')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(1);

      if (convos && convos.length > 0) {
        conversationId = convos[0].id;
        const { data: msgs } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true });

        if (msgs && msgs.length > 0) {
          messages = msgs;
          msgs.forEach((m) => appendMessage(m.sender, m.content));
        }
      } else {
        const { data } = await supabase
          .from('conversations')
          .insert({})
          .select('id')
          .maybeSingle();

        if (data) conversationId = data.id;
      }
    } catch (err) {
      console.warn('Supabase unavailable, using localStorage:', err);
      conversationId = 'local-convo';
      messages = loadLocalMessages();
      messages.forEach((m) => appendMessage(m.sender, m.content));
    }

    if (messages.length === 0) {
      appendMessage('assistant', getWelcomeMessage());
    }
  }

  async function handleSend() {
    const text = chatInput.value.trim();
    if (!text || isProcessing) return;

    isProcessing = true;
    chatInput.value = '';
    appendMessage('user', text);
    await saveMessage('user', text, null);

    setStatus('Thinking...');

    try {
      const response = await sendToGemini(text, messages);
      const { reply, emotion } = response;

      applyExpression(vrm, emotion, 0.7);
      appendMessage('assistant', reply);
      await saveMessage('assistant', reply, emotion);

      setStatus('Speaking...');
      speak(reply, vrm,
        () => setStatus('Speaking...'),
        () => setStatus('')
      );
    } catch (err) {
      console.error('Gemini error:', err);
      const fallback = isVietnamese()
        ? 'Xin l\u1ed7i, m\u00ecnh g\u1eb7p s\u1ef1 c\u1ed1. B\u1ea1n th\u1eed l\u1ea1i nh\u00e9?'
        : 'Sorry, I had trouble processing that. Could you try again?';
      appendMessage('assistant', fallback);
      setStatus('');
    }

    isProcessing = false;
  }

  async function saveMessage(sender, content, emotion) {
    const msg = { sender, content, emotion, created_at: new Date().toISOString() };
    messages.push(msg);

    if (!isSupabaseConfigured || conversationId === 'local-convo') {
      saveLocalMessages(messages);
      return;
    }

    try {
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender,
        content,
        emotion,
      });
    } catch (err) {
      console.warn('Failed to save message to Supabase:', err);
      saveLocalMessages(messages);
    }
  }

  function appendMessage(sender, content) {
    const div = document.createElement('div');
    div.className = `message ${sender}`;
    div.textContent = content;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function setStatus(text) {
    statusText.textContent = text;
  }
}
