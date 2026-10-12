import * as THREE from 'three';

const TAU = Math.PI * 2;
const wrap = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const ease = (t) => t * t * (3 - 2 * t);
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _f = new THREE.Vector3();

/**
 * Third-person orbit camera. It circles a focus point (the selected unit's eye anchor): left-drag
 * orbits, the wheel zooms between 8 and 150 m, changing the target glides over 0.8 s and swings the
 * view behind the new vehicle, and the camera never goes under the ground. padlock(point) swings the
 * view to sit behind the vehicle looking toward a world point (a track); null releases it.
 * free(true) detaches from the unit for a free orbit (wheel out to 3 km, WASD moves the focus).
 * follow(obj) chases a flying object ({ pos, vel, alive }) from behind and above; when it ends the view
 * holds on the last point for a moment (the burst), then calls onEnd. follow(null) releases.
 * cine(true) is the title screen's slow drifting orbit (distance and pitch breathe).
 */
export class ChaseCamera {
  constructor(camera, dom, { ground = () => 0 } = {}) {
    this.camera = camera;
    this.dom = dom;
    this.ground = ground;
    this.target = null;
    this.focus = new THREE.Vector3(0, 10, 0);
    this.from = new THREE.Vector3();
    this.t = 1; // glide progress 0..1
    this.yaw = 0; // camera azimuth around the focus: the camera sits at focus + (sin yaw, ., cos yaw) * d
    this.pitch = 0.2;
    this.dist = 28;
    this.goalYaw = 0;
    this.goalPitch = 0.2;
    this.goalDist = 28;
    this.minDist = 8;
    this.maxDist = 150;
    this.pad = null;
    this.padYaw = 0;
    this.dragging = false;
    this.freeMode = false;
    this.autoOrbit = 0; // rad/s, for the title screen
    this.lookAt = new THREE.Vector3();
    this.keys = new Set();
    this.height = 3.2; // look this far above the target origin when no anchor is given
    this.enabled = true;
    this.fol = null; // the chased flyer
    this.folHold = 0;
    this.folEnd = null;
    this.folLast = new THREE.Vector3();
    this.folDir = new THREE.Vector3(0, 0, -1);
    this.cineOn = false;
    this.cineT = 0;

    dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.button !== 0) return;
      this.dragging = true;
      this.lx = e.clientX;
      this.ly = e.clientY;
      dom.setPointerCapture?.(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lx, dy = e.clientY - this.ly;
      this.lx = e.clientX;
      this.ly = e.clientY;
      this.goalYaw -= dx * 0.0055;
      this.goalPitch = THREE.MathUtils.clamp(this.goalPitch + dy * 0.0042, -0.12, 1.45);
      this.yaw = this.goalYaw; // direct: dragging should not lag
      this.pitch = this.goalPitch;
      this.autoOrbit = 0;
    });
    const up = (e) => {
      this.dragging = false;
      dom.releasePointerCapture?.(e.pointerId);
    };
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.goalDist = THREE.MathUtils.clamp(this.goalDist * Math.exp(e.deltaY * 0.0012), this.minDist, this.maxDist);
      },
      { passive: false }
    );
    addEventListener('keydown', (e) => {
      if (this.freeMode && !e.ctrlKey && !e.metaKey) this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  /** Orbit this Object3D (its world position is the focus). Glides over 0.8 s and swings behind it. */
  setTarget(obj, { behind = true } = {}) {
    this.fol = null;
    this.folEnd = null;
    this.minDist = 8;
    this.freeMode = false;
    this.maxDist = 150;
    this.goalDist = Math.min(this.goalDist, 150);
    this.from.copy(this.focus);
    this.t = 0;
    this.target = obj;
    this.pad = null;
    if (behind && obj) {
      obj.getWorldQuaternion(_q);
      _f.set(0, 0, -1).applyQuaternion(_q); // the vehicle's front
      // the camera sits opposite the front
      this.goalYaw = this.yaw + wrap(Math.atan2(-_f.x, -_f.z) - this.yaw);
      this.goalPitch = 0.2;
    }
  }

  /** Swing the view so the unit is between the camera and a world point; null releases. */
  padlock(point) {
    this.pad = point ? (this.pad || new THREE.Vector3()).copy(point) : null;
  }

  /** Chase a flyer ({ pos, vel, alive }); onEnd runs once it has been gone for a moment. */
  follow(obj, onEnd = null) {
    this.fol = obj;
    this.folEnd = onEnd;
    this.folHold = 0;
    if (!obj) return;
    this.freeMode = false;
    this.pad = null;
    this.minDist = 5;
    this.maxDist = 150;
    this.folLast.copy(obj.pos);
    this.folDir.copy(obj.vel).normalize();
    this.from.copy(this.focus);
    this.t = 0;
    this.goalDist = 26;
    this.goalPitch = 0.16;
  }

  /** Title screen drift: orbit with a breathing distance and pitch. */
  cine(on) {
    this.cineOn = on;
    if (on) this.cineT = 0;
  }

  /** Free orbit around the current focus (detached from the unit). */
  free(on) {
    if (on) this.follow(null);
    if (on === this.freeMode) return;
    this.freeMode = on;
    this.pad = null;
    this.maxDist = on ? 3000 : 150;
    if (!on) this.goalDist = Math.min(this.goalDist, 150);
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 7);
    if (this.fol) {
      const f = this.fol;
      if (f.alive) {
        this.folLast.copy(f.pos);
        if (f.vel.lengthSq() > 1) this.folDir.copy(f.vel).normalize();
      } else this.folHold += dt;
      if (this.t < 1) {
        this.t = Math.min(1, this.t + dt / 0.35);
        this.focus.lerpVectors(this.from, this.folLast, ease(this.t));
      } else this.focus.copy(this.folLast);
      if (!this.dragging && f.alive) {
        // sit behind and a little above, swinging with the flight path
        const h = Math.hypot(this.folDir.x, this.folDir.z);
        if (h > 0.2) this.goalYaw = this.yaw + wrap(Math.atan2(-this.folDir.x, -this.folDir.z) - this.yaw);
      }
      if (!f.alive && this.folHold > 2.4) {
        const cb = this.folEnd;
        this.fol = null;
        this.folEnd = null;
        this.minDist = 8;
        cb?.();
      }
    } else if (!this.freeMode && this.target) {
      this.target.getWorldPosition(_w);
      if (this.t < 1) {
        this.t = Math.min(1, this.t + dt / 0.8);
        this.focus.lerpVectors(this.from, _w, ease(this.t));
      } else this.focus.copy(_w);
    } else if (this.freeMode) {
      const sp = (this.keys.has('ShiftLeft') ? 6 : 1.4) * this.dist * dt;
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      if (this.keys.has('KeyW')) this.focus.x += fx * sp, this.focus.z += fz * sp;
      if (this.keys.has('KeyS')) this.focus.x -= fx * sp, this.focus.z -= fz * sp;
      if (this.keys.has('KeyA')) this.focus.x += fz * sp, this.focus.z -= fx * sp;
      if (this.keys.has('KeyD')) this.focus.x -= fz * sp, this.focus.z += fx * sp;
      if (this.keys.has('KeyQ')) this.focus.y -= sp * 0.5;
      if (this.keys.has('KeyE')) this.focus.y += sp * 0.5;
    }

    if (this.pad && !this.freeMode && !this.dragging) {
      // sit behind the unit on the line from the point through the unit
      const dx = this.focus.x - this.pad.x, dz = this.focus.z - this.pad.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz > 1) {
        this.goalYaw = this.yaw + wrap(Math.atan2(dx, dz) - this.yaw);
        const elev = Math.atan2(this.pad.y - this.focus.y, horiz);
        this.goalPitch = THREE.MathUtils.clamp(0.16 + Math.max(0, elev) * 0.35, 0.1, 0.6);
      }
    }
    if (this.autoOrbit) this.goalYaw += this.autoOrbit * dt;
    if (this.cineOn && !this.dragging && !this.fol) {
      this.cineT += dt;
      this.goalYaw += 0.05 * dt;
      this.goalDist = 62 + 34 * Math.sin(this.cineT * 0.09);
      this.goalPitch = 0.2 + 0.13 * Math.sin(this.cineT * 0.13 + 1.3);
    }

    if (!this.dragging) {
      this.yaw += wrap(this.goalYaw - this.yaw) * k;
      this.pitch += (this.goalPitch - this.pitch) * k;
    }
    this.dist += (this.goalDist - this.dist) * (1 - Math.exp(-dt * 9));

    const cp = Math.cos(this.pitch);
    const off = _w.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.dist);
    const cam = this.camera.position;
    cam.copy(this.focus).add(off);
    // stay above the ground, here and a little toward the focus (so a rise does not cut the view)
    for (let i = 0; i < 3; i++) {
      const gx = cam.x + (this.focus.x - cam.x) * i * 0.12, gz = cam.z + (this.focus.z - cam.z) * i * 0.12;
      const g = this.ground(gx, gz) + 1.8 + i * 0.4;
      if (cam.y < g) cam.y = g;
    }
    this.lookAt.copy(this.focus);
    if (this.fol) {
      // keep the nose in the lower half of the frame so what it is flying at shows
      _f.copy(this.folDir).multiplyScalar(this.dist * (this.fol.alive ? 0.4 : 0));
      this.lookAt.add(_f);
    } else if (this.pad && !this.freeMode) {
      // look a little toward the point so it stays in the frame
      _f.subVectors(this.pad, this.focus).normalize().multiplyScalar(Math.min(60, this.dist * 1.2));
      this.lookAt.add(_f);
    }
    this.camera.lookAt(this.lookAt);
  }
}
