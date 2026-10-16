// ui-feedback.js — Esqueleto de la mano, cursor, efectos, indicador de estado y modo debug.

import { CONFIG, LM, POSE_LABELS } from './gestures.js';

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
const TIPS = [LM.THUMB_TIP, LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
const PALM_POINTS = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];

const RGB = {
  cyan: '62, 242, 255',
  sleep: '130, 170, 210',
  amber: '255, 190, 92',
  green: '96, 255, 170',
  red: '255, 104, 128',
};
const STATE_RGB = { extended: RGB.green, half: RGB.amber, curled: RGB.red };

const STATUS = {
  sleep: 'Dormido',
  active: 'Activo',
  resize: 'Modo tamaño',
  recents: 'Apps recientes',
};

const HINTS = {
  noHands: 'Muestra tu mano a la cámara',
  sleep: 'Palma abierta y quieta 2 s para activar',
  active: 'Mueve el índice para mover el cursor · palma quieta 2 s para dormir',
};

const FINGER_NAMES = { thumb: 'Pulgar', index: 'Índice', middle: 'Medio', ring: 'Anular', pinky: 'Meñique' };
const HAND_NAMES = { Left: 'Izquierda', Right: 'Derecha' };

export class UIFeedback {
  constructor(doc = document) {
    this.canvas = doc.getElementById('hud');
    this.ctx = this.canvas.getContext('2d');
    this.cursorEl = doc.getElementById('cursor');
    this.statusEl = doc.getElementById('status');
    this.hintEl = doc.getElementById('hint');
    this.debugEl = doc.getElementById('debug');
    this.fxEl = doc.getElementById('fx');
    this.body = doc.body;

    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.mode = null;
    this.hint = null;
    this.cursorVisible = false;
    this.debug = false;
    this.lastDebugUpdate = 0;
    this.stats = { camFps: 0, renderFps: 0, inferenceMs: 0, camFrames: 0, renderFrames: 0, since: performance.now() };

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get viewport() {
    return { width: this.width, height: this.height };
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  setDebug(on) {
    this.debug = on;
    this.body.classList.toggle('is-debug', on);
    if (!on) this.debugEl.innerHTML = '';
  }

  toggleDebug() {
    this.setDebug(!this.debug);
  }

  // ── Estadísticas de rendimiento ──
  countRenderFrame(now) {
    this.stats.renderFrames++;
    const dt = now - this.stats.since;
    if (dt >= 1000) {
      this.stats.camFps = (this.stats.camFrames * 1000) / dt;
      this.stats.renderFps = (this.stats.renderFrames * 1000) / dt;
      this.stats.camFrames = 0;
      this.stats.renderFrames = 0;
      this.stats.since = now;
    }
  }

  countCameraFrame(inferenceMs) {
    this.stats.camFrames++;
    this.stats.inferenceMs = this.stats.inferenceMs ? this.stats.inferenceMs * 0.9 + inferenceMs * 0.1 : inferenceMs;
  }

  // ── Dibujo de cada frame de la cámara ──
  render(frame, state, project, tracker) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    if (this.debug) this.#drawCursorBox(project);
    for (const hand of state.hands) {
      this.#drawHand(hand, state.active, hand.id === state.cursor.handId);
      if (this.debug) this.#drawFingerLabels(hand);
    }
    const ringHand = state.activation && state.hands.find((h) => h.id === state.activation.handId);
    if (ringHand) this.#drawActivationRing(ringHand, state.activation);
    this.body.classList.toggle('has-ring', Boolean(ringHand));

    this.#updateCursor(state.cursor);
    this.#updateStatus(state.mode);
    this.#updateHint(state.hands.length === 0 ? 'noHands' : state.mode === 'sleep' ? 'sleep' : 'active');
    for (const e of state.events) this.#playEvent(e, project);

    if (this.debug && frame.timestamp - this.lastDebugUpdate > 100) {
      this.lastDebugUpdate = frame.timestamp;
      this.#updateDebugPanel(state, tracker);
    }
  }

  #drawHand(hand, active, primary) {
    const ctx = this.ctx;
    const pts = hand.screen;
    const rgb = active ? RGB.cyan : RGB.sleep;
    const alpha = active ? 1 : 0.55;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      ctx.moveTo(pts[a].x, pts[a].y);
      ctx.lineTo(pts[b].x, pts[b].y);
    }
    // Brillo falso (dos trazos) en lugar de shadowBlur, que es muy caro en móviles.
    ctx.strokeStyle = `rgba(${rgb}, ${0.16 * alpha})`;
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.strokeStyle = `rgba(${rgb}, ${0.85 * alpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = `rgba(${rgb}, ${0.95 * alpha})`;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const r = TIPS.includes(i) ? 4.5 : 3;
      ctx.moveTo(pts[i].x + r, pts[i].y);
      ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
    }
    ctx.fill();

    // Marca la punta del índice de la mano que controla el cursor.
    if (active && primary) {
      const tip = pts[LM.INDEX_TIP];
      ctx.strokeStyle = `rgba(${RGB.cyan}, 0.9)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  #drawActivationRing(hand, activation) {
    const ctx = this.ctx;
    const pts = hand.screen;
    let cx = 0;
    let cy = 0;
    for (const i of PALM_POINTS) {
      cx += pts[i].x / PALM_POINTS.length;
      cy += pts[i].y / PALM_POINTS.length;
    }
    const size = Math.hypot(pts[LM.WRIST].x - pts[LM.MIDDLE_MCP].x, pts[LM.WRIST].y - pts[LM.MIDDLE_MCP].y);
    const r = Math.max(36, size * 0.75);
    const rgb = activation.activating ? RGB.cyan : RGB.amber;
    const start = -Math.PI / 2;
    const end = start + Math.PI * 2 * activation.progress;

    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(${rgb}, 0.18)`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end);
    ctx.strokeStyle = `rgba(${rgb}, 0.25)`;
    ctx.lineWidth = 14;
    ctx.stroke();
    ctx.strokeStyle = `rgba(${rgb}, 1)`;
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = `rgba(${rgb}, 0.95)`;
    ctx.font = '600 13px Rajdhani, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(activation.activating ? 'ACTIVAR' : 'DORMIR', cx, cy - r - 14);
  }

  #drawCursorBox(project) {
    const { left, right, top, bottom } = CONFIG.CURSOR_BOX;
    const a = project(left, top);
    const b = project(right, bottom);
    const ctx = this.ctx;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = `rgba(${RGB.amber}, 0.6)`;
    ctx.lineWidth = 1;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(${RGB.amber}, 0.8)`;
    ctx.font = '500 11px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('zona del cursor', a.x + 4, a.y - 3);
  }

  #drawFingerLabels(hand) {
    const ctx = this.ctx;
    const f = hand.features;
    const tips = { thumb: LM.THUMB_TIP, index: LM.INDEX_TIP, middle: LM.MIDDLE_TIP, ring: LM.RING_TIP, pinky: LM.PINKY_TIP };
    ctx.font = '600 11px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const [name, i] of Object.entries(tips)) {
      const p = hand.screen[i];
      const finger = f.fingers[name];
      ctx.fillStyle = `rgba(${STATE_RGB[finger.state]}, 0.95)`;
      ctx.fillText(`${Math.round(finger.bend)}°`, p.x, p.y - 9);
    }
  }

  #updateCursor(cursor) {
    if (cursor.visible) {
      this.cursorEl.style.transform = `translate3d(${cursor.x}px, ${cursor.y}px, 0)`;
    }
    if (cursor.visible !== this.cursorVisible) {
      this.cursorVisible = cursor.visible;
      this.cursorEl.classList.toggle('visible', cursor.visible);
    }
  }

  #updateStatus(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.statusEl.dataset.mode = mode;
    this.statusEl.querySelector('.label').textContent = STATUS[mode] ?? mode;
    this.body.classList.toggle('is-active', mode !== 'sleep');
  }

  #updateHint(key) {
    if (key === this.hint) return;
    this.hint = key;
    this.hintEl.textContent = HINTS[key];
  }

  #playEvent(event, project) {
    if (event.type !== 'activate' && event.type !== 'deactivate') return;
    const p = project(event.at.x, event.at.y);
    const el = document.createElement('div');
    el.className = `pulse ${event.type}`;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.addEventListener('animationend', () => el.remove());
    this.fxEl.appendChild(el);

    this.statusEl.classList.remove('bump');
    void this.statusEl.offsetWidth; // reinicia la animación
    this.statusEl.classList.add('bump');
  }

  #updateDebugPanel(state, tracker) {
    const s = this.stats;
    const cfg = CONFIG;
    const cell = (finger, text) => `<td style="color:rgb(${STATE_RGB[finger.state]})">${text}</td>`;
    const rows = [
      `<div class="dbg-title">DEBUG <span>tecla D · ${tracker.delegate ?? '—'} · ${tracker.resolution}</span></div>`,
      `<div>Cámara <b>${s.camFps.toFixed(1)} fps</b> · inferencia <b>${s.inferenceMs.toFixed(1)} ms</b> · pantalla ${s.renderFps.toFixed(0)} fps</div>`,
      `<div>${STATUS[state.mode]} · gesto <b>${state.gesture}</b></div>`,
    ];
    if (state.hands.length) {
      const head = Object.values(FINGER_NAMES).map((n) => `<th>${n.slice(0, 3)}</th>`).join('');
      const body = state.hands
        .map((hand) => {
          const f = hand.features;
          const act = hand.activation ?? { drift: 0, elapsed: 0 };
          const fingers = Object.keys(FINGER_NAMES)
            .map((key) => {
              const finger = f.fingers[key];
              const extra = key === 'thumb' ? `<small>/${finger.ratio.toFixed(2)}</small>` : '';
              return cell(finger, `${Math.round(finger.bend)}°${extra}`);
            })
            .join('');
          const side = (HAND_NAMES[hand.handedness] ?? hand.handedness).slice(0, 3);
          return (
            `<tr><th>#${hand.id} ${side}${hand.id === state.cursor.handId ? '◉' : ''}</th>${fingers}</tr>` +
            `<tr class="sub"><td colspan="6"><b>${POSE_LABELS[f.pose]}</b> · pellizco ${f.pinchRatio.toFixed(2)} · ${f.pinchCm.toFixed(1)}cm` +
            ` · mov ${act.drift.toFixed(2)} · ${(act.elapsed / 1000).toFixed(1)}s${act.locked ? ' · suelta' : ''}</td></tr>`
          );
        })
        .join('');
      rows.push(`<table><tr><th></th>${head}</tr>${body}</table>`);
    }
    rows.push(
      `<div class="dbg-cfg">dedo ext ≤${cfg.FINGER_EXTENDED_MAX_BEND}° dob ≥${cfg.FINGER_CURLED_MIN_BEND}° · pulgar ≤${cfg.THUMB_MAX_BEND}°/sep ≥${cfg.THUMB_EXTENDED_RATIO}` +
        ` · pellizco &lt;${cfg.PINCH_GRAB_RATIO}/&gt;${cfg.PINCH_RELEASE_RATIO} · quietud ≤${cfg.ACTIVATION_STILL_TOLERANCE}</div>`,
    );
    this.debugEl.innerHTML = rows.join('');
  }
}
