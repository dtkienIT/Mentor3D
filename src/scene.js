import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import {
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
  createVRMAnimationClip,
} from '@pixiv/three-vrm-animation';
import { GreetingAnimator } from './animator.js';

const CDN_BASE           = 'https://raw.githubusercontent.com/dtkienIT/Mentor3D/2d144bffba9d4e66a2a2045abc3531d97eaca96c';
const LOCAL_MODEL_URL    = '/vrm-models/8590256991748008892.vrm';
const CDN_MODEL_URL      = `${CDN_BASE}/vrm-models/8590256991748008892.vrm`;
const IDLE_ANIMATION_URL = '/animations/Relax.vrma';
const TARGET_HEIGHT = 2.03;
const CAMERA_TARGET = new THREE.Vector3(0, 1.04, 0);

// Layered sine noise for organic-looking movement
function snoise(t, freq, seed = 0) {
  return (
    Math.sin(t * freq + seed) * 0.5 +
    Math.sin(t * freq * 2.13 + seed * 1.7) * 0.25 +
    Math.sin(t * freq * 4.37 + seed * 3.1) * 0.125
  );
}

// ── Blink controller ──────────────────────────────────────────
class BlinkController {
  constructor() {
    this._phase = 'idle';
    this._timer = this._nextInterval();
    this._value = 0;
    this._speed = 9;
  }
  _nextInterval() { return 2.2 + Math.random() * 3.5; }
  update(dt, vrm) {
    const mgr = vrm.expressionManager;
    if (!mgr) return;
    if (this._phase === 'idle') {
      this._timer -= dt;
      if (this._timer <= 0) this._phase = 'closing';
      return;
    }
    if (this._phase === 'closing') {
      this._value = Math.min(1, this._value + dt * this._speed);
      _setExpr(mgr, 'blink', this._value);
      if (this._value >= 1) this._phase = 'opening';
      return;
    }
    if (this._phase === 'opening') {
      this._value = Math.max(0, this._value - dt * this._speed);
      _setExpr(mgr, 'blink', this._value);
      if (this._value <= 0) {
        this._phase = 'idle';
        this._timer = this._nextInterval();
      }
    }
  }
}

function _setExpr(mgr, name, val) {
  try { mgr.setValue(name, val); } catch {}
  try { mgr.setValue('blinkLeft', val); } catch {}
  try { mgr.setValue('blinkRight', val); } catch {}
}

// ── Scene init ────────────────────────────────────────────────
export async function initScene() {
  const canvas = document.getElementById('stage');
  const loaderProgress = document.getElementById('loader-progress');
  const loaderNote = document.getElementById('loader-note');

  const setProgress = (p) => { if (loaderProgress) loaderProgress.style.width = `${p}%`; };
  const setNote = (t) => { if (loaderNote) loaderNote.textContent = t; };

  // Do NOT enable THREE.Cache — it can create blob URLs that fail in sandboxed iframes.
  THREE.Cache.enabled = false;

  const renderer = new THREE.WebGLRenderer({
    alpha: true, antialias: true, canvas, powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.94;

  const scene = new THREE.Scene();

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 1.13, 10);
  camera.lookAt(CAMERA_TARGET);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.minPolarAngle = Math.PI / 2;
  controls.maxPolarAngle = Math.PI / 2;
  controls.minZoom = 0.82;
  controls.maxZoom = 1.55;
  controls.target.copy(CAMERA_TARGET);
  controls.update();

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.72);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.26);
  keyLight.position.set(1.7, 3.4, 2.3);
  keyLight.castShadow = true;
  keyLight.shadow.bias = -0.00012;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left   = -4;
  keyLight.shadow.camera.right  =  4;
  keyLight.shadow.camera.top    =  4;
  keyLight.shadow.camera.bottom = -4;
  keyLight.shadow.camera.near   =  0.1;
  keyLight.shadow.camera.far    =  12;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.42);
  rimLight.position.set(-2.4, 1.8, -1.5);
  scene.add(rimLight);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(8.5, 8.5),
    new THREE.ShadowMaterial({ opacity: 0.18, transparent: true }),
  );
  floor.position.set(0, -0.002, 0);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const vrmLoader = new GLTFLoader();
  vrmLoader.setCrossOrigin('anonymous');
  vrmLoader.register((parser) => new VRMLoaderPlugin(parser));

  const animLoader = new GLTFLoader();
  animLoader.setCrossOrigin('anonymous');
  animLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));

  setNote('Loading VRM model...');
  setProgress(20);
  const gltf = await fetchAndParse(vrmLoader, LOCAL_MODEL_URL, CDN_MODEL_URL);
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('VRM not found in model file');

  setProgress(70);
  vrm.scene.rotation.y = Math.PI;
  tuneMaterials(vrm);

  const root = new THREE.Group();
  root.name = 'Mika';
  vrm.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(vrm.scene);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bounds.getSize(size);
  bounds.getCenter(center);
  const scale = TARGET_HEIGHT / Math.max(size.y, 0.1);
  vrm.scene.position.set(-center.x, -bounds.min.y, -center.z);
  root.scale.setScalar(scale);
  root.add(vrm.scene);
  scene.add(root);

  setNote('Loading animations...');
  setProgress(85);
  const mixer = new THREE.AnimationMixer(vrm.scene);
  const idleClip = await loadAnimClip(animLoader, IDLE_ANIMATION_URL, vrm);
  let idleAction = null;
  if (idleClip) {
    idleAction = mixer.clipAction(idleClip);
    idleAction.setLoop(THREE.LoopRepeat, Infinity);
    idleAction.fadeIn(0.2);
    idleAction.play();
  }

  applyExpression(vrm, 'happy', 0.4);

  setProgress(100);
  setTimeout(() => document.body.classList.add('is-ready'), 150);

  // LookAt mouse tracking
  const lookAtTarget = new THREE.Object3D();
  lookAtTarget.position.set(0, 1.3, -5);
  scene.add(lookAtTarget);
  if (vrm.lookAt) vrm.lookAt.target = lookAtTarget;

  const mouseNDC = new THREE.Vector2(0, 0);
  window.addEventListener('mousemove', (e) => {
    mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  });

  // Procedural bones
  const spineBone = vrm.humanoid?.getNormalizedBoneNode?.('spine');
  const chestBone = vrm.humanoid?.getNormalizedBoneNode?.('upperChest')
                 ?? vrm.humanoid?.getNormalizedBoneNode?.('chest');
  const headBone  = vrm.humanoid?.getNormalizedBoneNode?.('head');

  const blinkCtrl    = new BlinkController();
  const greetingAnim = new GreetingAnimator(vrm);

  // Auto-start: begin greeting immediately once the scene is ready
  setTimeout(() => {
    console.log('[Mika] Starting greeting animation');
    greetingAnim.play();
  }, 300);

  // Replay button
  const btnReplay = document.getElementById('btn-replay');
  if (btnReplay) {
    btnReplay.addEventListener('click', () => {
      if (!greetingAnim.isPlaying) {
        console.log('[Mika] Replaying greeting animation');
        greetingAnim.play();
      }
    });
  }

  const smoothMouse = new THREE.Vector2(0, 0);
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 1 / 30);
    const t = clock.elapsedTime;

    smoothMouse.lerp(mouseNDC, 1 - Math.pow(0.04, delta));

    // Step 1 – animation clip writes initial bone poses
    mixer.update(delta);

    // Step 2 – ALL bone / expression overrides must happen BEFORE vrm.update()
    //          because vrm.update() copies normalized-bone rotations → raw mesh skeleton.

    // Greeting state machine (overrides arm/spine bones each frame while playing)
    greetingAnim.update(delta);

    // Procedural organic motion (only when greeting is not running, to avoid fighting)
    if (!greetingAnim.isPlaying) {
      if (spineBone) {
        spineBone.rotation.z = snoise(t, 0.19, 13.4) * 0.018;
        spineBone.rotation.x = snoise(t, 0.12, 55.2) * 0.010;
      }
      if (chestBone) {
        chestBone.rotation.z = snoise(t, 0.21, 29.7) * 0.015;
      }
      if (headBone) {
        // read current value so we add micro-tilt on top of whatever the clip set
        headBone.rotation.z = headBone.rotation.z + snoise(t, 0.13, 67.8) * 0.018;
      }
    }

    // LookAt target (read by vrm.update's lookAt resolver)
    const driftScale = greetingAnim.isPlaying ? 0.3 : 1.0;
    const driftX = snoise(t, 0.18, 7.3)  * 4  * driftScale;
    const driftY = snoise(t, 0.14, 22.1) * 2.5 * driftScale;
    const yawR = (smoothMouse.x * 25 + driftX) * (Math.PI / 180);
    lookAtTarget.position.set(
      Math.sin(yawR) * 5,
      1.3 + (smoothMouse.y * 15 + driftY) * 0.035,
      -Math.cos(yawR) * 5,
    );

    // Expressions (vrm.update calls expressionManager.update internally)
    blinkCtrl.update(delta, vrm);
    const mgr = vrm.expressionManager;
    if (mgr) {
      const happyPulse = 0.38 + snoise(t, 0.25, 111.5) * 0.06;
      try { mgr.setValue('happy', Math.max(0, Math.min(1, happyPulse))); } catch {}
    }

    // Step 3 – VRM processes all inputs: bone poses, lookAt, expressions → raw mesh
    vrm.update(delta);

    // Step 4 – root-level transforms (Object3D, not bones; always safe after vrm.update)
    root.position.y = snoise(t, 0.55, 0) * 0.007;
    root.rotation.z = snoise(t, 0.22, 44.6) * 0.012;
    root.rotation.x = snoise(t, 0.17, 88.2) * 0.006;

    controls.update();
    renderer.render(scene, camera);
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / Math.max(h, 1);
    const viewHeight = w < 680 ? 2.34 : 2.52;
    camera.left   = (-viewHeight * aspect) / 2;
    camera.right  =  (viewHeight * aspect) / 2;
    camera.top    =  viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.setSize(w, h);
  }

  window.addEventListener('resize', resize);
  resize();
  animate();

  return { vrm };
}

// Fetch binary → parse in-memory to avoid Three.js URL/blob issues in sandboxed iframes.
// If the local file is a truncated stub (Bolt caps large binary uploads at 512 KB),
// the GLB declared-length check catches it and the CDN copy is fetched as fallback.
async function fetchAndParse(loader, primaryUrl, fallbackUrl) {
  const buf = await fetchBuffer(primaryUrl, fallbackUrl);
  return new Promise((resolve, reject) => {
    loader.parse(buf, '', resolve, reject);
  });
}

async function fetchBuffer(primaryUrl, fallbackUrl) {
  const resp = await fetch(primaryUrl);
  if (resp.ok) {
    const buf = await resp.arrayBuffer();
    // GLB integrity: declared length (bytes 8-11 LE) must fit inside the buffer.
    if (buf.byteLength >= 12) {
      const declaredLen = new DataView(buf).getUint32(8, true);
      if (buf.byteLength >= declaredLen) return buf;           // complete ✓
      console.warn(`[Mika] Local file truncated (${buf.byteLength}/${declaredLen} B)${fallbackUrl ? ', trying CDN...' : ''}`);
    }
  }
  if (!fallbackUrl) throw new Error(`Failed to fetch ${primaryUrl}`);
  const cdn = await fetch(fallbackUrl);
  if (!cdn.ok) throw new Error(`HTTP ${cdn.status} fetching ${fallbackUrl}`);
  return cdn.arrayBuffer();
}

async function loadAnimClip(loader, url, vrm) {
  try {
    const gltf = await fetchAndParse(loader, url);
    const vrmAnim = gltf.userData.vrmAnimations?.[0];
    if (!vrmAnim) return null;
    if (vrm.lookAt && !vrm.scene.children.some((c) => c instanceof VRMLookAtQuaternionProxy)) {
      const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
      proxy.name = 'VRMLookAtQuaternionProxy';
      vrm.scene.add(proxy);
    }
    return createVRMAnimationClip(vrmAnim, vrm);
  } catch (e) {
    console.warn('[Mika] Failed to load animation:', url, e);
    return null;
  }
}

export function applyExpression(vrm, emotion, intensity = 0.7) {
  const mgr = vrm.expressionManager;
  if (!mgr) return;
  const emotions = ['happy', 'sad', 'angry', 'surprised', 'neutral', 'relaxed'];
  emotions.forEach((name) => { try { mgr.setValue(name, 0); } catch {} });
  if (emotion === 'neutral') return;
  const mapped = { happy: 'happy', sad: 'sad', angry: 'angry', surprised: 'surprised' }[emotion] ?? 'happy';
  try { mgr.setValue(mapped, intensity); } catch {}
}

function tuneMaterials(vrm) {
  vrm.scene.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    node.frustumCulled = false;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    mats.forEach((m) => {
      if (!m) return;
      if (m.outlineWidthFactor !== undefined) m.outlineWidthFactor = 0;
      if (m.outlineWidthMode  !== undefined) m.outlineWidthMode   = 'none';
      m.side = THREE.FrontSide;
      m.needsUpdate = true;
    });
  });
}
