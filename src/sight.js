import * as THREE from 'three';

// The consoles' sight pictures: the scene rendered a second time, small, from the unit's sight along
// its sight line, read back and drawn into the panel's sight canvas (the console draws its reticle
// over it). The Strela's is a direct-view optical sight (natural colour); the Pantsir's EO channel is
// a monochrome TV picture. Linear HDR is read back and tone-mapped here, with its own exposure.

const W = 320, H = 200;

// Sight poses for units whose sim state has no `sight` of their own (the WW2 era's gun sights and the
// predictor's telescope): an era's consoles register pose(unit) -> { az, el, fov, part } by unit kind
// (compass radians, the horizontal field of view, the part whose rig's sight anchor the picture is taken
// from), or null for no picture. sightPose(u) is the unit's own `sight` when it has one, else its kind's
// pose; main passes it to update() with that part's anchor position.
const POSES = {};
export function registerSightPose(kind, pose) {
  POSES[kind] = pose;
}
export const sightPose = (u) => u?.sight ?? POSES[u?.kind]?.(u) ?? null;

export class SightRenderer {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, depthBuffer: true });
    this.cam = new THREE.PerspectiveCamera(10, W / H, 1, 60000);
    this.buf = new Float32Array(W * H * 4);
    this.small = document.createElement('canvas');
    this.small.width = W;
    this.small.height = H;
    this.sctx = this.small.getContext('2d');
    this.img = this.sctx.createImageData(W, H);
    this.exposure = 1;
    this.timer = 0;
    this.rate = 1 / 15;
  }

  /**
   * unit: the sim unit (sight az/el/fov), pos: the sight's world position, canvas: the panel's sight
   * canvas, mono: TV picture, pose: { az, el, fov } instead of unit.sight (sightPose). Throttled to ~15 Hz.
   */
  update(rawDt, unit, pos, canvas, mono, entities = null, pose = null) {
    this.timer -= rawDt;
    const s = pose ?? unit?.sight;
    if (this.timer > 0 || !s || !canvas || !pos) return;
    this.timer = this.rate;
    // when this picture was taken, so a console can tell whether its sight is fed
    canvas._fedAt = performance.now();
    const cam = this.cam;
    const hfov = Math.max(0.01, s.fov ?? 0.12);
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / (W / H)));
    cam.updateProjectionMatrix();
    cam.position.copy(pos);
    const ce = Math.cos(s.el);
    cam.lookAt(pos.x + Math.sin(s.az) * ce, pos.y + Math.sin(s.el), pos.z - Math.cos(s.az) * ce);
    cam.updateMatrixWorld();

    const r = this.renderer;
    const prev = r.getRenderTarget();
    const shadow = r.shadowMap.needsUpdate;
    r.shadowMap.needsUpdate = false;
    entities?.plain(true);
    r.setRenderTarget(this.rt);
    r.render(this.scene, cam);
    entities?.plain(false);
    r.readRenderTargetPixels(this.rt, 0, 0, W, H, this.buf);
    r.setRenderTarget(prev);
    r.shadowMap.needsUpdate = shadow;

    // auto exposure from the log-average luminance, held down so the brightest tenth (usually the sky
    // along the horizon) stays short of white, eased
    const b = this.buf, d = this.img.data;
    const lum = this.lum ?? (this.lum = new Float32Array(Math.ceil(b.length / 16)));
    let sum = 0, n = 0;
    for (let i = 0; i < b.length; i += 16) {
      const L = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
      lum[n++] = L;
      sum += Math.log(1e-4 + L);
    }
    const avg = Math.exp(sum / n);
    lum.sort();
    const p90 = lum[Math.floor(n * 0.9)];
    const goal = Math.min(0.22 / Math.max(avg, 1e-3), 1.1 / Math.max(p90, 1e-3));
    this.exposure += (goal - this.exposure) * 0.25;
    const k = this.exposure;
    const tone = (x) => {
      x *= k;
      x = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14); // ACES fit
      return Math.pow(Math.min(Math.max(x, 0), 1), 1 / 2.2) * 255;
    };
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4, dst = y * W * 4;
      for (let x = 0; x < W * 4; x += 4) {
        const R = b[src + x], G = b[src + x + 1], B = b[src + x + 2];
        if (mono) {
          // TV channel: luminance, a touch of contrast and sensor noise
          const L = tone(0.25 * R + 0.65 * G + 0.1 * B) * 1.08 - 10 + (Math.random() - 0.5) * 14;
          d[dst + x] = d[dst + x + 1] = d[dst + x + 2] = L;
        } else {
          // the optical sight: natural colour through slightly yellowed glass
          d[dst + x] = tone(R) * 0.98;
          d[dst + x + 1] = tone(G) * 0.97;
          d[dst + x + 2] = tone(B) * 0.86;
        }
        d[dst + x + 3] = 255;
      }
    }
    this.sctx.putImageData(this.img, 0, 0);
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.drawImage(this.small, 0, 0, canvas.width, canvas.height);
  }
}
