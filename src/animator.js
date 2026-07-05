import * as THREE from 'three';

// ── Utilities ────────────────────────────────────────────────
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
function lerp(a, b, t) { return a + (b - a) * t; }

function captureRot(bone) {
  if (!bone) return { x: 0, y: 0, z: 0 };
  return { x: bone.rotation.x, y: bone.rotation.y, z: bone.rotation.z };
}
function applyRot(bone, r) {
  if (!bone) return;
  bone.rotation.x = r.x;
  bone.rotation.y = r.y;
  bone.rotation.z = r.z;
}
function lerpRot(bone, from, to, t) {
  if (!bone || !from) return;
  bone.rotation.x = lerp(from.x, to.x, t);
  bone.rotation.y = lerp(from.y, to.y, t);
  bone.rotation.z = lerp(from.z, to.z, t);
}

// ── Target poses (all values in radians) ─────────────────────
// rightUpperArm.z < 0 = raise arm; leftUpperArm.z > 0 = raise arm
const POSE = {
  rest: {
    rShoulder: { x: 0,    y: 0,    z: -0.06 },
    rElbow:    { x: 0,    y: 0,    z: 0 },
    rHand:     { x: 0,    y: 0,    z: 0 },
    lShoulder: { x: 0,    y: 0,    z:  0.06 },
    lElbow:    { x: 0,    y: 0,    z: 0 },
    lHand:     { x: 0,    y: 0,    z: 0 },
    spine:     { x: 0,    y: 0,    z: 0 },
    chest:     { x: 0,    y: 0,    z: 0 },
  },
  waveRaise: {
    rShoulder: { x: 0,    y: 0,    z: -1.25 }, // arm raised ~72 deg
    rElbow:    { x: 0,    y: 0.35, z: 0 },
    rHand:     { x: 0,    y: 0,    z: 0 },
  },
  behindBack: {
    rShoulder: { x: 0.65, y: 0.25, z: -0.55 },
    rElbow:    { x: 0.55, y: 0,    z: 0 },
    lShoulder: { x: 0.65, y: -0.25, z: 0.55 },
    lElbow:    { x: 0.55, y: 0,    z: 0 },
  },
  stretch: {
    rShoulder: { x: 0,    y: 0,    z: -1.45 }, // nearly straight up
    rElbow:    { x: 0,    y: 0,    z: -0.15 },
    lShoulder: { x: 0,    y: 0,    z:  1.45 },
    lElbow:    { x: 0,    y: 0,    z:  0.15 },
    spine:     { x: -0.14, y: 0,   z: 0 },   // slight arch back
    chest:     { x: -0.08, y: 0,   z: 0 },
  },
  doubleWaveUp: {
    rShoulder: { x: 0,    y: 0,    z: -1.52 },
    lShoulder: { x: 0,    y: 0,    z:  1.52 },
  },
  bow: {
    rShoulder: { x: 0.12, y: 0,    z: -0.22 },
    rElbow:    { x: 0.2,  y: 0,    z: 0 },
    lShoulder: { x: 0.12, y: 0,    z:  0.22 },
    lElbow:    { x: 0.2,  y: 0,    z: 0 },
    spine:     { x: 0.30, y: 0,    z: 0 },   // bow forward
    chest:     { x: 0.16, y: 0,    z: 0 },
  },
};

// ── State IDs ─────────────────────────────────────────────────
const S = {
  WAVE_ENTER:   0,
  WAVE_CYCLE:   1,
  BEHIND_ENTER: 2,
  BEHIND_HOLD:  3,
  STRETCH_IN:   4,
  DWAVE_ENTER:  5,
  DWAVE_CYCLE:  6,
  BOW_ENTER:    7,
  BOW_HOLD:     8,
  RETURN:       9,
  DONE:        10,
};

// ── Duration table (ms) — tweak freely ───────────────────────
const DUR = {
  [S.WAVE_ENTER]:   550,
  [S.WAVE_CYCLE]:   1800,  // 3 waves × 600 ms
  [S.BEHIND_ENTER]: 750,
  [S.BEHIND_HOLD]:  2000,  // exactly 2 s
  [S.STRETCH_IN]:   850,
  [S.DWAVE_ENTER]:  350,
  [S.DWAVE_CYCLE]:  2400,  // 4 waves × 600 ms
  [S.BOW_ENTER]:    650,
  [S.BOW_HOLD]:     700,
  [S.RETURN]:       750,
};

// ── Main class ────────────────────────────────────────────────
export class GreetingAnimator {
  constructor(vrm) {
    this._vrm = vrm;
    this._state = S.DONE;
    this._ms = 0;
    this._playing = false;
    this._from = {};

    const h = vrm.humanoid;
    // Try normalized bone API (VRM 1.0 + three-vrm v3), fall back to raw
    const g = (name) => {
      const n = h?.getNormalizedBoneNode?.(name);
      if (n) return n;
      const r = h?.getRawBoneNode?.(name);
      if (r) return r;
      return null;
    };

    this._b = {
      rShoulder: g('rightUpperArm'),
      rElbow:    g('rightLowerArm'),
      rHand:     g('rightHand'),
      lShoulder: g('leftUpperArm'),
      lElbow:    g('leftLowerArm'),
      lHand:     g('leftHand'),
      spine:     g('spine'),
      chest:     g('upperChest') ?? g('chest'),
    };

    const found = Object.entries(this._b).filter(([, v]) => v !== null).map(([k]) => k);
    const missing = Object.entries(this._b).filter(([, v]) => v === null).map(([k]) => k);
    console.log('[Mika] GreetingAnimator bones found:', found.join(', ') || 'none');
    if (missing.length) console.warn('[Mika] Missing bones:', missing.join(', '));
  }

  get isPlaying() { return this._playing; }

  play() {
    this._playing = true;
    this._goto(S.WAVE_ENTER);
  }

  _capture() {
    for (const [k, bone] of Object.entries(this._b)) {
      this._from[k] = captureRot(bone);
    }
  }

  _goto(state) {
    this._state = state;
    this._ms = 0;
    this._capture();
  }

  // Called every frame AFTER vrm.update() so we override bone positions
  update(delta) {
    if (!this._playing) return;

    this._ms += delta * 1000;
    const dur = DUR[this._state] ?? 1000;
    const raw = Math.min(this._ms / dur, 1);
    const te  = easeInOut(raw);

    switch (this._state) {

      // 1. Raise right arm
      case S.WAVE_ENTER:
        lerpRot(this._b.rShoulder, this._from.rShoulder, POSE.waveRaise.rShoulder, te);
        lerpRot(this._b.rElbow,    this._from.rElbow,    POSE.waveRaise.rElbow,    te);
        if (raw >= 1) this._goto(S.WAVE_CYCLE);
        break;

      // 2. Wave hand 3 times (600 ms per wave)
      case S.WAVE_CYCLE:
        applyRot(this._b.rShoulder, POSE.waveRaise.rShoulder);
        applyRot(this._b.rElbow,    POSE.waveRaise.rElbow);
        {
          const swing = Math.sin((this._ms / 600) * Math.PI * 2) * 0.55;
          applyRot(this._b.rHand, { x: 0, y: 0, z: swing });
        }
        if (raw >= 1) this._goto(S.BEHIND_ENTER);
        break;

      // 3. Both arms swing behind back
      case S.BEHIND_ENTER:
        lerpRot(this._b.rShoulder, this._from.rShoulder, POSE.behindBack.rShoulder, te);
        lerpRot(this._b.rElbow,    this._from.rElbow,    POSE.behindBack.rElbow,    te);
        lerpRot(this._b.lShoulder, this._from.lShoulder, POSE.behindBack.lShoulder, te);
        lerpRot(this._b.lElbow,    this._from.lElbow,    POSE.behindBack.lElbow,    te);
        applyRot(this._b.rHand, POSE.rest.rHand);
        if (raw >= 1) this._goto(S.BEHIND_HOLD);
        break;

      // 4. Hold — 2 s
      case S.BEHIND_HOLD:
        applyRot(this._b.rShoulder, POSE.behindBack.rShoulder);
        applyRot(this._b.rElbow,    POSE.behindBack.rElbow);
        applyRot(this._b.lShoulder, POSE.behindBack.lShoulder);
        applyRot(this._b.lElbow,    POSE.behindBack.lElbow);
        if (raw >= 1) this._goto(S.STRETCH_IN);
        break;

      // 5. Wide stretch
      case S.STRETCH_IN:
        lerpRot(this._b.rShoulder, this._from.rShoulder, POSE.stretch.rShoulder, te);
        lerpRot(this._b.rElbow,    this._from.rElbow,    POSE.stretch.rElbow,    te);
        lerpRot(this._b.lShoulder, this._from.lShoulder, POSE.stretch.lShoulder, te);
        lerpRot(this._b.lElbow,    this._from.lElbow,    POSE.stretch.lElbow,    te);
        lerpRot(this._b.spine,     this._from.spine,     POSE.stretch.spine,     te);
        lerpRot(this._b.chest,     this._from.chest,     POSE.stretch.chest,     te);
        if (raw >= 1) this._goto(S.DWAVE_ENTER);
        break;

      // 6. Raise both arms to double-wave position
      case S.DWAVE_ENTER:
        lerpRot(this._b.rShoulder, this._from.rShoulder, POSE.doubleWaveUp.rShoulder, te);
        lerpRot(this._b.lShoulder, this._from.lShoulder, POSE.doubleWaveUp.lShoulder, te);
        lerpRot(this._b.rElbow,    this._from.rElbow,    POSE.rest.rElbow,   te);
        lerpRot(this._b.lElbow,    this._from.lElbow,    POSE.rest.lElbow,   te);
        lerpRot(this._b.spine,     this._from.spine,     POSE.rest.spine,    te);
        lerpRot(this._b.chest,     this._from.chest,     POSE.rest.chest,    te);
        if (raw >= 1) this._goto(S.DWAVE_CYCLE);
        break;

      // 7. Double wave (both hands, 4 cycles × 600 ms)
      case S.DWAVE_CYCLE:
        applyRot(this._b.rShoulder, POSE.doubleWaveUp.rShoulder);
        applyRot(this._b.lShoulder, POSE.doubleWaveUp.lShoulder);
        {
          const swing = Math.sin((this._ms / 600) * Math.PI * 2) * 0.50;
          applyRot(this._b.rHand, { x: 0, y: 0, z:  swing });
          applyRot(this._b.lHand, { x: 0, y: 0, z: -swing });
          applyRot(this._b.rElbow, { x: 0, y:  swing * 0.4, z: 0 });
          applyRot(this._b.lElbow, { x: 0, y: -swing * 0.4, z: 0 });
        }
        if (raw >= 1) this._goto(S.BOW_ENTER);
        break;

      // 8. Arms down + bow forward
      case S.BOW_ENTER:
        lerpRot(this._b.rShoulder, this._from.rShoulder, POSE.bow.rShoulder, te);
        lerpRot(this._b.rElbow,    this._from.rElbow,    POSE.bow.rElbow,    te);
        lerpRot(this._b.rHand,     this._from.rHand,     POSE.rest.rHand,    te);
        lerpRot(this._b.lShoulder, this._from.lShoulder, POSE.bow.lShoulder, te);
        lerpRot(this._b.lElbow,    this._from.lElbow,    POSE.bow.lElbow,    te);
        lerpRot(this._b.lHand,     this._from.lHand,     POSE.rest.lHand,    te);
        lerpRot(this._b.spine,     this._from.spine,     POSE.bow.spine,     te);
        lerpRot(this._b.chest,     this._from.chest,     POSE.bow.chest,     te);
        if (raw >= 1) this._goto(S.BOW_HOLD);
        break;

      // 9. Hold bow
      case S.BOW_HOLD:
        applyRot(this._b.rShoulder, POSE.bow.rShoulder);
        applyRot(this._b.rElbow,    POSE.bow.rElbow);
        applyRot(this._b.lShoulder, POSE.bow.lShoulder);
        applyRot(this._b.lElbow,    POSE.bow.lElbow);
        applyRot(this._b.spine,     POSE.bow.spine);
        applyRot(this._b.chest,     POSE.bow.chest);
        if (raw >= 1) this._goto(S.RETURN);
        break;

      // 10. Return to neutral
      case S.RETURN:
        lerpRot(this._b.rShoulder, this._from.rShoulder, POSE.rest.rShoulder, te);
        lerpRot(this._b.rElbow,    this._from.rElbow,    POSE.rest.rElbow,    te);
        lerpRot(this._b.rHand,     this._from.rHand,     POSE.rest.rHand,     te);
        lerpRot(this._b.lShoulder, this._from.lShoulder, POSE.rest.lShoulder, te);
        lerpRot(this._b.lElbow,    this._from.lElbow,    POSE.rest.lElbow,    te);
        lerpRot(this._b.lHand,     this._from.lHand,     POSE.rest.lHand,     te);
        lerpRot(this._b.spine,     this._from.spine,     POSE.rest.spine,     te);
        lerpRot(this._b.chest,     this._from.chest,     POSE.rest.chest,     te);
        if (raw >= 1) {
          this._state = S.DONE;
          this._playing = false;
        }
        break;
    }
  }
}
