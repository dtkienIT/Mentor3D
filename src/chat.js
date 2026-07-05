import { supabase } from './supabase.js';
import { sendToGemini } from './gemini.js';
import { speak, toggleMute, getIsMuted, stopSpeaking } from './speech.js';
import { setExpression } from './scene.js';

let conversationId = null;
let messages = [];
let isProcessing = false;

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
    if (muted) {
      stopSpeaking(vrm);
    }
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
    recognition.lang = 'en-US';

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

      if (msgs) {
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

    if (messages.length === 0) {
      appendMessage('assistant', 'Hi there! I\'m Mika. How can I help you today?');
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

      setExpression(vrm, emotion, 0.7);
      appendMessage('assistant', reply);
      await saveMessage('assistant', reply, emotion);

      setStatus('Speaking...');
      speak(reply, vrm,
        () => setStatus('Speaking...'),
        () => setStatus('')
      );
    } catch (err) {
      console.error('Gemini error:', err);
      const fallback = 'Sorry, I had trouble processing that. Could you try again?';
      appendMessage('assistant', fallback);
      setStatus('');
    }

    isProcessing = false;
  }

  async function saveMessage(sender, content, emotion) {
    if (!conversationId) return;
    const msg = { conversation_id: conversationId, sender, content, emotion };
    messages.push({ ...msg, created_at: new Date().toISOString() });
    await supabase.from('messages').insert(msg);
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
