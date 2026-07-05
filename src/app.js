import * as THREE from "../../frontend/node_modules/three/build/three.module.js";
import { OrbitControls } from "../../frontend/node_modules/three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "../../frontend/node_modules/three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "../../frontend/node_modules/three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin } from "../../frontend/node_modules/@pixiv/three-vrm/lib/three-vrm.module.js";
import {
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
  createVRMAnimationClip,
} from "../../frontend/node_modules/@pixiv/three-vrm-animation/lib/three-vrm-animation.module.js";

const MODEL_URL = "./vrm-models/8590256991748008892.vrm";
const WAVE_ANIMATION_URL = "./animations/vrma_02.vrma";
const FALLBACK_WAVE_ANIMATION_URL = "./animations/Goodbye.vrma";
const IDLE_ANIMATION_URL = "./animations/Relax.vrma";
const TARGET_HEIGHT = 2.03;
const CAMERA_TARGET = new THREE.Vector3(0, 1.04, 0);

const canvas = document.querySelector("#stage");
const loaderProgress = document.querySelector("#loader-progress");
const loaderNote = document.querySelector("#loader-note");

if (window.location.protocol === "file:") {
  setLoaderNote("Run start-mika.bat so the browser can load the 3D files.");
}

THREE.Cache.enabled = true;

const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => {
  const ratio = total > 0 ? Math.round((loaded / total) * 100) : 36;
  setLoaderProgress(Math.max(12, Math.min(96, ratio)));
};

const renderer = new THREE.WebGLRenderer({
  alpha: true,
  antialias: true,
  canvas,
  powerPreference: "high-performance",
});

renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.94;

const scene = new THREE.Scene();
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

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

const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.13);
rimLight.position.set(-2.4, 1.8, 1.5);
scene.add(rimLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(8.5, 8.5),
  new THREE.ShadowMaterial({ opacity: 0.18, transparent: true }),
);
floor.position.set(0, -0.002, 0);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const softShadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.72, 48),
  new THREE.MeshBasicMaterial({
    color: 0x101828,
    depthWrite: false,
    opacity: 0.12,
    transparent: true,
  }),
);
softShadow.position.set(0, 0.004, 0.04);
softShadow.rotation.x = -Math.PI / 2;
softShadow.scale.set(1.15, 0.44, 1);
scene.add(softShadow);

const clock = new THREE.Clock();
const vrmLoader = new GLTFLoader(manager);
vrmLoader.register((parser) => new VRMLoaderPlugin(parser));

const animationLoader = new GLTFLoader(manager);
animationLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));

let mixer = null;
let currentVrm = null;
let modelRoot = null;

main().catch((error) => {
  console.error(error);
  document.body.classList.add("is-error");
  setLoaderProgress(100);
  setLoaderNote("Could not load Mika. Run start-mika.bat from this folder and keep the asset folders beside index.html.");
});

async function main() {
  setLoaderNote("Loading VRM model...");
  const vrm = await loadVRM(MODEL_URL);
  currentVrm = vrm;
  modelRoot = mountVRM(vrm);
  scene.add(modelRoot);

  setHappyExpression(vrm);
  setLoaderNote("Loading wave animation...");
  await playWaveAnimation(vrm);

  setLoaderProgress(100);
  window.setTimeout(() => document.body.classList.add("is-ready"), 120);
  animate();
}

async function loadVRM(url) {
  const gltf = await vrmLoader.loadAsync(url);
  const vrm = gltf.userData.vrm;

  if (!vrm) {
    throw new Error(`VRM not found in ${url}`);
  }

  vrm.scene.rotation.y = Math.PI;
  vrm.scene.userData.isMikaModel = true;
  tuneVRMMaterials(vrm);
  return vrm;
}

function mountVRM(vrm) {
  const root = new THREE.Group();
  root.name = "Mika";

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
  return root;
}

async function playWaveAnimation(vrm) {
  mixer = new THREE.AnimationMixer(vrm.scene);
  const clip = await loadAnimationClip(WAVE_ANIMATION_URL, vrm).catch(async (error) => {
    console.warn("Falling back to Goodbye.vrma", error);
    return loadAnimationClip(FALLBACK_WAVE_ANIMATION_URL, vrm);
  }).catch(async (error) => {
    console.warn("Falling back to Relax.vrma", error);
    return loadAnimationClip(IDLE_ANIMATION_URL, vrm);
  });

  const action = mixer.clipAction(clip);
  action.reset();
  action.enabled = true;
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.fadeIn(0.18);
  action.play();
}

async function loadAnimationClip(url, vrm) {
  const originalWarn = console.warn;
  console.warn = (...args) => {
    const firstArg = args[0] ?? "";
    const message = typeof firstArg === "string" ? firstArg : "";
    if (message.includes("specVersion of the VRMA is not defined")) {
      return;
    }
    originalWarn(...args);
  };

  try {
    const gltf = await animationLoader.loadAsync(url);
    const vrmAnimation = gltf.userData.vrmAnimations?.[0];

    if (!vrmAnimation) {
      throw new Error(`VRM animation not found in ${url}`);
    }

    if (vrm.lookAt && !vrm.scene.children.some((child) => child instanceof VRMLookAtQuaternionProxy)) {
      const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
      proxy.name = "VRMLookAtQuaternionProxy";
      vrm.scene.add(proxy);
    }

    return createVRMAnimationClip(vrmAnimation, vrm);
  } finally {
    console.warn = originalWarn;
  }
}

function tuneVRMMaterials(vrm) {
  vrm.scene.traverse((node) => {
    if (!node.isMesh) {
      return;
    }

    node.castShadow = true;
    node.receiveShadow = true;
    node.frustumCulled = false;
    const material = stripOutlineMaterials(node.material);
    if (material) {
      node.material = material;
    }
    softenMaterial(node.material, node.name);
  });
}

function stripOutlineMaterials(material) {
  if (!material) {
    return material;
  }

  if (Array.isArray(material)) {
    const stripped = material
      .filter((candidate) => !candidate?.isOutline)
      .map((candidate) => sanitizeMaterial(candidate))
      .filter(Boolean);
    return stripped.length > 0 ? stripped : material.map((candidate) => sanitizeMaterial(candidate)).filter(Boolean);
  }

  if (material.isOutline) {
    return sanitizeMaterial(material);
  }

  return sanitizeMaterial(material);
}

function sanitizeMaterial(material) {
  if (!material) {
    return material;
  }

  if ("outlineWidthFactor" in material) material.outlineWidthFactor = 0;
  if ("outlineWidthMode" in material) material.outlineWidthMode = "none";
  if ("outlineLightingMixFactor" in material) material.outlineLightingMixFactor = 0;
  if ("shadingToonyFactor" in material) material.shadingToonyFactor = Math.min(material.shadingToonyFactor ?? 1, 0.42);
  if ("shadingShiftFactor" in material) material.shadingShiftFactor = Math.max(material.shadingShiftFactor ?? 0, -0.02);
  if ("alphaToCoverage" in material && material.transparent) material.alphaToCoverage = true;
  material.side = THREE.FrontSide;
  material.needsUpdate = true;
  return material;
}

function softenMaterial(material, meshName = "") {
  if (!material) {
    return;
  }

  const materials = Array.isArray(material) ? material : [material];

  materials.forEach((candidate) => {
    const hairLike = isHairLikeName(candidate.name) || isHairLikeName(meshName);

    multiplyNumber(candidate, "rimLightingMixFactor", hairLike ? 0.35 : 0.5);
    multiplyNumber(candidate, "parametricRimFresnelPowerFactor", hairLike ? 0.45 : 0.6);
    multiplyNumber(candidate, "parametricRimLiftFactor", hairLike ? 0.45 : 0.55);
    multiplyNumber(candidate, "outlineLightingMixFactor", 0.6);
    multiplyNumber(candidate, "envMapIntensity", hairLike ? 0.35 : 0.5);
    multiplyNumber(candidate, "specularIntensity", hairLike ? 0.25 : 0.45);
    multiplyNumber(candidate, "emissiveIntensity", hairLike ? 0.3 : 0.55);
    multiplyNumber(candidate, "metalness", hairLike ? 0.4 : 0.65);

    if (candidate.matcapFactor?.multiplyScalar) {
      candidate.matcapFactor.multiplyScalar(hairLike ? 0.35 : 0.5);
    } else {
      multiplyNumber(candidate, "matcapFactor", hairLike ? 0.35 : 0.5);
    }

    if (candidate.shadeColorFactor?.multiplyScalar && hairLike) {
      candidate.shadeColorFactor.multiplyScalar(0.94);
    }

    if (typeof candidate.roughness === "number") {
      candidate.roughness = Math.min(1, candidate.roughness + (hairLike ? 0.24 : 0.18));
    }

    candidate.needsUpdate = true;
  });
}

function multiplyNumber(target, key, factor) {
  if (typeof target[key] === "number") {
    target[key] *= factor;
  }
}

function isHairLikeName(value) {
  return typeof value === "string" && /(hair|bang|fringe|fronthair|backhair|sidehair|ahoge|tail|twintail)/i.test(value);
}

function setHappyExpression(vrm) {
  const manager = vrm.expressionManager;
  if (!manager) {
    return;
  }

  ["happy", "relaxed", "sad", "angry", "surprised"].forEach((name) => {
    try {
      manager.setValue(name, name === "happy" ? 0.72 : 0);
    } catch {
      // Expressions vary by model; unsupported names can be ignored.
    }
  });
  manager.update?.();
}

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 1 / 30);
  mixer?.update(delta);
  currentVrm?.update(delta);

  if (modelRoot) {
    const time = clock.elapsedTime;
    modelRoot.position.y = Math.sin(time * 1.35) * 0.006;
  }

  controls.update();
  renderer.render(scene, camera);
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const aspect = width / Math.max(height, 1);
  const viewHeight = width < 680 ? 2.34 : 2.52;

  camera.left = (-viewHeight * aspect) / 2;
  camera.right = (viewHeight * aspect) / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.setSize(width, height);
}

function setLoaderProgress(percent) {
  if (loaderProgress) {
    loaderProgress.style.width = `${percent}%`;
  }
}

function setLoaderNote(text) {
  if (loaderNote) {
    loaderNote.textContent = text;
  }
}

window.addEventListener("resize", resize);
resize();
