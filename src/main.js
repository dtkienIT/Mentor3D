import './styles.css';
import { initScene } from './scene.js';
import { initChat } from './chat.js';

async function boot() {
  const scene = await initScene();
  initChat(scene);
}

boot().catch((err) => {
  console.error('Boot failed:', err);
  document.body.classList.add('is-error');
  const note = document.getElementById('loader-note');
  if (note) note.textContent = 'Failed to initialize. Check console.';
});
