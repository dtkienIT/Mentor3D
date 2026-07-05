import './styles.css';
import { initScene } from './scene.js';
import { initChat } from './chat.js';

async function boot() {
  const sceneCtx = await initScene();
  initChat(sceneCtx);
}

boot().catch((err) => {
  console.error('Boot failed:', err);
  const note = document.getElementById('loader-note');
  if (note) {
    note.textContent = `Error: ${err.message || 'Failed to load. Check console.'}`;
    note.style.color = '#f87171';
  }
});
