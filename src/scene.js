import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import {
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
  createVRMAnimationClip,
} from '@pixiv/three-vrm-animation';

const CDN_BASE = 'https://cdn.jsdelivr.net/gh/dtkienIT/Mentor3D@2d144bf/public';
const MODEL_URL = `${CDN_BASE}/vrm-models/8590256991748008892.vrm`;
const IDLE_ANIMATION_URL = `${CDN_BASE}/animations/Relax.vrma`;
const TARGET_HEIGHT = 2.03;
const CAMERA_TARGET = new THREE.Vector3(0, 1.04, 0);

export async function initScene() {
  const canvas = document.getElementById('stage');
  const loaderProgress = document.getElementById('loader-progress');
  const loaderNote = document.getElementById('loader-note');

  const setProgress = (p) => { if (loaderProgress) loaderProgress.style.width = `${p}%`; };
  const setNote = (t) => { if (loaderNote) loaderNote.textContent = t; };

  THREE.Cache.enabled = true;

  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => {
    const ratio = total > 0 ? Math.round((loaded / total) * 100) : 36;
    setProgress(Math.max(12, Math.min(96, ratio)));
  };

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    canvas,
    powerPreference: 'high-performance',
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
  keyLight.shadow.camera.left = -4;
  keyLight.shadow.camera.right = 4;
  keyLight.shadow.camera.top = 4;
  keyLight.shadow.camera.bottom = -4;
  keyLight.shadow.camera.near = 0.1;
  keyLight.shadow.camera.far = 12;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.42);
  rimLight.position.set(-2.4, 1.8, -1.5);
  scene.add(rimLight);

  // Floor for shadow
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(8.5, 8.5),
    new THREE.ShadowMaterial({ opacity: 0.18, transparent: true }),
  );
  floor.position.set(0, -0.002, 0);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Loaders - set crossOrigin for CDN resources
  const vrmLoader = new GLTFLoader(manager);
  vrmLoader.setCrossOrigin('anonymous');
  vrmLoader.register((parser) => new VRMLoaderPlugin(parser));

  const animLoader = new GLTFLoader(manager);
  animLoader.setCrossOrigin('anonymous');
  animLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));

  setNote('Loading VRM model...');
  const gltf = await vrmLoader.loadAsync(MODEL_URL);
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('VRM not found in model file');

  vrm.scene.rotation.y = Math.PI;
  tuneMaterials(vrm);

  // Mount
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

  // Idle animation
  setNote('Loading animations...');
  const mixer = new THREE.AnimationMixer(vrm.scene);
  const idleClip = await loadAnimClip(animLoader, IDLE_ANIMATION_URL, vrm);
  if (idleClip) {
    const action = mixer.clipAction(idleClip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.fadeIn(0.2);
    action.play();
  }

  // Set default expression
  applyExpression(vrm, 'happy', 0.4);

  setProgress(100);
  setTimeout(() => document.body.classList.add('is-ready'), 150);

  // LookAt mouse tracking
  const lookAtTarget = new THREE.Object3D();
  lookAtTarget.position.set(0, 1.3, -5);
  scene.add(lookAtTarget);
  if (vrm.lookAt) {
    vrm.lookAt.target = lookAtTarget;
  }

  const mouseNDC = new THREE.Vector2(0, 0);
  window.addEventListener('mousemove', (e) => {
    mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  });

  // Animation loop
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 1 / 30);
    mixer.update(delta);

    // Update lookAt target position based on mouse
    const yaw = mouseNDC.x * 25;
    const pitch = mouseNDC.y * 15;
    lookAtTarget.position.set(
      Math.sin(yaw * Math.PI / 180) * 5,
      1.3 + pitch * 0.5,
      -Math.cos(yaw * Math.PI / 180) * 5,
    );

    vrm.update(delta);

    // Subtle bobbing
    root.position.y = Math.sin(clock.elapsedTime * 1.35) * 0.005;

    controls.update();
    renderer.render(scene, camera);
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / Math.max(h, 1);
    const viewHeight = w < 680 ? 2.34 : 2.52;
    camera.left = (-viewHeight * aspect) / 2;
    camera.right = (viewHeight * aspect) / 2;
    camera.top = viewHeight / 2;
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

async function loadAnimClip(loader, url, vrm) {
  try {
    const gltf = await loader.loadAsync(url);
    const vrmAnim = gltf.userData.vrmAnimations?.[0];
    if (!vrmAnim) return null;

    if (vrm.lookAt && !vrm.scene.children.some((c) => c instanceof VRMLookAtQuaternionProxy)) {
      const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
      proxy.name = 'VRMLookAtQuaternionProxy';
      vrm.scene.add(proxy);
    }

    return createVRMAnimationClip(vrmAnim, vrm);
  } catch (e) {
    console.warn('Failed to load animation:', url, e);
    return null;
  }
}

export function applyExpression(vrm, emotion, intensity = 0.7) {
  const mgr = vrm.expressionManager;
  if (!mgr) return;

  const emotions = ['happy', 'sad', 'angry', 'surprised', 'neutral', 'relaxed'];
  emotions.forEach((name) => {
    try { mgr.setValue(name, 0); } catch {}
  });

  if (emotion === 'neutral') {
    mgr.update?.();
    return;
  }

  const mapped = emotion === 'happy' ? 'happy' :
                 emotion === 'sad' ? 'sad' :
                 emotion === 'angry' ? 'angry' :
                 emotion === 'surprised' ? 'surprised' : 'happy';

  try { mgr.setValue(mapped, intensity); } catch {}
  mgr.update?.();
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
      if (m.outlineWidthMode !== undefined) m.outlineWidthMode = 'none';
      m.side = THREE.FrontSide;
      m.needsUpdate = true;
    });
  });
}
