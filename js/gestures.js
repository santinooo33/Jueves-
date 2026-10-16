// gestures.js — Detecta gestos a partir de los landmarks de hand-tracking.js.
//
// Fase 1: forma de la mano (dedos extendidos/doblados, pulgar, pellizco), activación
// con palma abierta quieta y cursor suavizado con la punta del índice.

import { OneEuroFilter } from './one-euro-filter.js';

// ─────────────────────────────────────────────────────────────────────────────
// UMBRALES CONFIGURABLES — ajústalos mirando los valores del modo debug (tecla D).
// Las razones son adimensionales: no dependen de lo lejos que esté la mano.
// ─────────────────────────────────────────────────────────────────────────────
export const CONFIG = {
  // Activación / desactivación: palma abierta y quieta.
  ACTIVATION_HOLD_MS: 2000, // tiempo que hay que sostener la palma
  ACTIVATION_RING_DELAY_MS: 300, // el anillo de progreso aparece tras este tiempo (evita parpadeos)
  ACTIVATION_STILL_TOLERANCE: 0.3, // desplazamiento máx. de la palma (× tamaño de la palma) para contar como "quieta"
  ACTIVATION_COOLDOWN_MS: 1000, // pausa mínima entre dos cambios de estado
  POSE_GRACE_MS: 180, // tolerancia a fallos breves del detector antes de cancelar un gesto

  // Forma de los dedos: "flexión" = suma de los ángulos de sus 3 articulaciones (en grados).
  // Recto ≈ 0–60°, relajado ≈ 60–100°, doblado del todo ≈ 150–240°.
  FINGER_EXTENDED_MAX_BEND: 110, // ≤ esto: dedo extendido
  FINGER_CURLED_MIN_BEND: 140, // ≥ esto: dedo doblado
  // También cuenta como doblado si la punta está más cerca de la palma que el nudillo (PIP):
  // dist(punta, palma) / dist(nudillo, palma) ≤ esto.
  FINGER_CURLED_RATIO: 1.0,
  // Pulgar abierto = recto Y separado de los demás dedos.
  THUMB_MAX_BEND: 50, // flexión máx. del pulgar (°) para considerarlo recto
  THUMB_EXTENDED_RATIO: 0.45, // dist(punta del pulgar, índice/medio/anular más cercano) / largo de la palma
  PALM_REQUIRES_THUMB: false, // ¿la "palma abierta" exige además el pulgar abierto?

  // Pellizco. razón = dist(punta del pulgar, punta del índice) / largo de la palma
  // (se usa desde la fase 2; ya se muestra en debug para ir calibrando)
  PINCH_GRAB_RATIO: 0.22, // < esto: agarra
  PINCH_RELEASE_RATIO: 0.38, // > esto: suelta (histéresis)

  // Cursor. Zona del encuadre de la cámara (0..1, en espejo) que se estira a toda la
  // pantalla: más pequeña = menos movimiento de brazo, pero menos precisión.
  CURSOR_BOX: { left: 0.25, right: 0.75, top: 0.18, bottom: 0.58 },
  // Suavizado One Euro (en píxeles). minCutoff menor = menos temblor; beta mayor = menos retraso.
  CURSOR_MIN_CUTOFF: 1.0,
  CURSOR_BETA: 0.015,
  CURSOR_D_CUTOFF: 1.0,
};

// Índices de los 21 landmarks de MediaPipe.
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

// [nudillo base (MCP), PIP, DIP, punta] de cada dedo.
const FINGERS = {
  index: [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP],
  middle: [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP],
  ring: [LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP],
  pinky: [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP],
};
const PALM_POINTS = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
// El pulgar está "separado" cuando su punta se aleja de estos puntos del índice, medio y anular.
const THUMB_REFERENCE = [
  LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP,
  LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP,
  LM.RING_MCP, LM.RING_PIP,
];

export const POSE_LABELS = {
  palma: 'Palma abierta',
  puno: 'Puño',
  pulgar: '4 dedos doblados + pulgar',
  L: 'Forma de L',
  senalar: 'Señalar',
  pellizco: 'Pellizco',
  otro: '—',
};

const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Ángulo (°) entre dos vectores 3D.
function angle(u, v) {
  const d = Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z) || 1e-9;
  const c = (u.x * v.x + u.y * v.y + u.z * v.z) / d;
  return (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI;
}

// Flexión total de una cadena de puntos: suma de los ángulos en cada articulación.
function chainBend(w, chain) {
  let total = 0;
  for (let i = 1; i < chain.length - 1; i++) {
    total += angle(sub(w[chain[i]], w[chain[i - 1]]), sub(w[chain[i + 1]], w[chain[i]]));
  }
  return total;
}

function centroid(points, indices) {
  const c = { x: 0, y: 0, z: 0 };
  for (const i of indices) {
    c.x += points[i].x;
    c.y += points[i].y;
    c.z += points[i].z ?? 0;
  }
  c.x /= indices.length;
  c.y /= indices.length;
  c.z /= indices.length;
  return c;
}

/**
 * Analiza la forma de una mano. Usa los landmarks 3D en metros ("world"), que no cambian
 * con la distancia a la cámara ni con la rotación de la mano.
 * @param {object} hand  mano de hand-tracking.js
 * @param {number} aspect  ancho/alto del video, para medir distancias 2D sin deformar
 */
export function analyzeHand(hand, aspect, cfg = CONFIG) {
  // Respaldo por si el modelo no entrega landmarks 3D: los normalizados, corregidos por aspecto.
  const w = hand.world?.length === 21
    ? hand.world
    : hand.landmarks.map((p) => ({ x: p.x * aspect, y: p.y, z: p.z * aspect }));

  const palm = centroid(w, PALM_POINTS);
  const palmLen = dist3(w[LM.WRIST], w[LM.MIDDLE_MCP]) || 1e-6;

  const fingers = {};
  for (const [name, [mcp, pip, dip, tip]] of Object.entries(FINGERS)) {
    // La muñeca entra en la cadena para medir también la flexión del nudillo base.
    const bend = chainBend(w, [LM.WRIST, mcp, pip, dip, tip]);
    const ratio = dist3(w[tip], palm) / (dist3(w[pip], palm) || 1e-6);
    let state = 'half';
    if (bend >= cfg.FINGER_CURLED_MIN_BEND || ratio <= cfg.FINGER_CURLED_RATIO) state = 'curled';
    else if (bend <= cfg.FINGER_EXTENDED_MAX_BEND) state = 'extended';
    fingers[name] = { bend, ratio, state };
  }

  const thumbBend = chainBend(w, [LM.THUMB_CMC, LM.THUMB_MCP, LM.THUMB_IP, LM.THUMB_TIP]);
  const thumbRatio = Math.min(...THUMB_REFERENCE.map((i) => dist3(w[LM.THUMB_TIP], w[i]))) / palmLen;
  const thumbExtended = thumbBend <= cfg.THUMB_MAX_BEND && thumbRatio >= cfg.THUMB_EXTENDED_RATIO;
  fingers.thumb = { bend: thumbBend, ratio: thumbRatio, state: thumbExtended ? 'extended' : 'curled' };

  const pinchDist = dist3(w[LM.THUMB_TIP], w[LM.INDEX_TIP]);

  // Medidas 2D en el encuadre (para "quieto"/movimiento): x corregida por aspecto.
  const lm = hand.landmarks;
  const palmNorm = centroid(lm, PALM_POINTS);
  const palm2D = { x: palmNorm.x * aspect, y: palmNorm.y };
  const size2D =
    dist2({ x: lm[LM.WRIST].x * aspect, y: lm[LM.WRIST].y }, { x: lm[LM.MIDDLE_MCP].x * aspect, y: lm[LM.MIDDLE_MCP].y }) ||
    1e-6;

  const features = {
    fingers,
    thumbExtended,
    pinchRatio: pinchDist / palmLen,
    pinchCm: pinchDist * 100,
    palmLenCm: palmLen * 100,
    palmNorm,
    palm2D,
    size2D,
  };
  features.pose = classifyPose(features, cfg);
  return features;
}

function classifyPose(f, cfg) {
  const { index, middle, ring, pinky } = f.fingers;
  const ext = (finger) => finger.state === 'extended';
  const cur = (finger) => finger.state === 'curled';
  const four = [index, middle, ring, pinky];
  const rest = [middle, ring, pinky];

  if (four.every(cur)) return f.thumbExtended ? 'pulgar' : 'puno';
  if (f.pinchRatio < cfg.PINCH_GRAB_RATIO) return 'pellizco';
  if (four.every(ext) && (f.thumbExtended || !cfg.PALM_REQUIRES_THUMB)) return 'palma';
  if (ext(index) && rest.every(cur)) return f.thumbExtended ? 'L' : 'senalar';
  return 'otro';
}

/**
 * Motor de gestos. Se llama una vez por cada frame nuevo de la cámara.
 * Devuelve el estado para la interfaz y una lista de eventos ("activate", "deactivate").
 */
export class GestureEngine {
  constructor(cfg = CONFIG) {
    this.cfg = cfg;
    this.active = false;
    this.holds = new Map(); // id de mano -> progreso de "palma quieta"
    this.lastToggle = -Infinity;
    this.cursor = { x: 0, y: 0, visible: false, handId: null };
    this.cursorFilter = new OneEuroFilter({
      minCutoff: cfg.CURSOR_MIN_CUTOFF,
      beta: cfg.CURSOR_BETA,
      dCutoff: cfg.CURSOR_D_CUTOFF,
    });
  }

  get mode() {
    return this.active ? 'active' : 'sleep';
  }

  /**
   * @param {{hands: object[], timestamp: number, videoWidth: number, videoHeight: number}} frame
   * @param {{width: number, height: number}} viewport  tamaño de la pantalla en px CSS
   */
  update(frame, viewport) {
    const now = frame.timestamp;
    const aspect = frame.videoWidth / frame.videoHeight || 4 / 3;
    for (const hand of frame.hands) hand.features = analyzeHand(hand, aspect, this.cfg);

    const events = [];
    const activation = this.#updateActivation(frame.hands, now, events);
    this.#updateCursor(frame.hands, now, viewport);

    const cursorHand = frame.hands.find((h) => h.id === this.cursor.handId) ?? frame.hands[0];
    let gesture = cursorHand ? POSE_LABELS[cursorHand.features.pose] : 'Sin manos';
    if (activation) gesture = `${activation.activating ? 'Activando' : 'Desactivando'} ${Math.round(activation.progress * 100)}%`;

    return {
      mode: this.mode,
      active: this.active,
      hands: frame.hands,
      cursor: { ...this.cursor },
      activation,
      events,
      gesture,
    };
  }

  // Palma abierta + quieta durante ACTIVATION_HOLD_MS alterna Dormido <-> Activo.
  #updateActivation(hands, now, events) {
    const cfg = this.cfg;
    let best = null;
    let toggled = false;

    for (const hand of hands) {
      const f = hand.features;
      let hold = this.holds.get(hand.id);
      if (!hold) {
        hold = { start: null, anchor: f.palm2D, lastOpen: -Infinity, locked: false };
        this.holds.set(hand.id, hold);
      }
      hold.seen = now;
      if (f.pose === 'palma') hold.lastOpen = now;

      const open = now - hold.lastOpen <= cfg.POSE_GRACE_MS;
      if (!open) {
        // Al dejar de mostrar la palma se puede volver a usar el gesto.
        hold.start = null;
        hold.locked = false;
      }
      const drift = dist2(f.palm2D, hold.anchor) / f.size2D;
      if (open && !hold.locked && (hold.start === null || drift > cfg.ACTIVATION_STILL_TOLERANCE)) {
        hold.start = now;
        hold.anchor = f.palm2D;
      }
      const elapsed = hold.start === null || hold.locked ? 0 : now - hold.start;
      hand.activation = { drift: hold.start === null ? 0 : drift, elapsed, locked: hold.locked };

      if (!toggled && elapsed >= cfg.ACTIVATION_HOLD_MS && now - this.lastToggle >= cfg.ACTIVATION_COOLDOWN_MS) {
        toggled = true;
        this.active = !this.active;
        this.lastToggle = now;
        events.push({ type: this.active ? 'activate' : 'deactivate', handId: hand.id, at: f.palmNorm });
        continue;
      }
      if (elapsed >= cfg.ACTIVATION_RING_DELAY_MS && (!best || elapsed > best.elapsed)) {
        best = { handId: hand.id, elapsed, progress: Math.min(elapsed / cfg.ACTIVATION_HOLD_MS, 1), activating: !this.active };
      }
    }

    if (toggled) {
      // Ninguna mano vuelve a cambiar el estado hasta cerrar o bajar la palma.
      for (const hold of this.holds.values()) {
        if (hold.start !== null) {
          hold.locked = true;
          hold.start = null;
        }
      }
      best = null;
    }
    for (const [id, hold] of this.holds) {
      if (now - hold.seen > cfg.POSE_GRACE_MS) this.holds.delete(id);
    }
    return best;
  }

  // La punta del índice de la mano principal mueve el cursor (solo con el sistema activo).
  #updateCursor(hands, now, viewport) {
    const c = this.cursor;
    if (!this.active) {
      c.visible = false;
      c.handId = null;
      return;
    }
    const hand = hands.find((h) => h.id === c.handId) ?? hands[0];
    if (!hand) {
      c.visible = false;
      return;
    }
    if (hand.id !== c.handId) {
      this.cursorFilter.reset();
      c.handId = hand.id;
    }
    const tip = hand.landmarks[LM.INDEX_TIP];
    const { left, right, top, bottom } = this.cfg.CURSOR_BOX;
    const nx = clamp01((tip.x - left) / (right - left));
    const ny = clamp01((tip.y - top) / (bottom - top));
    const [x, y] = this.cursorFilter.filter([nx * viewport.width, ny * viewport.height], now);
    c.x = x;
    c.y = y;
    c.visible = true;
  }
}
