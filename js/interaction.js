// interaction.js — Traduce los gestos en acciones sobre el escritorio:
//   · pellizco en la barra o el borde → mover la ventana (sigue el punto medio pulgar-índice)
//   · pellizco en un botón → pulsarlo al momento. Se pulsa el botón iluminado: el cursor se
//     pega a los botones cercanos y, al empezar a juntar los dedos, el botón queda fijo.
//   · "L" quieta sobre una ventana → modo tamaño (abrir/cerrar los dedos la agranda/achica)
//   · pellizco con las dos manos sobre una ventana → zoom
//   · puño sostenido sobre una ventana → cerrarla

import { CONFIG } from './gestures.js';
import { OneEuroFilter } from './one-euro-filter.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// Distancia de un punto a un rectángulo de pantalla (0 si está dentro).
function rectDistance(r, p) {
  const dx = Math.max(r.left - p.x, 0, p.x - r.right);
  const dy = Math.max(r.top - p.y, 0, p.y - r.bottom);
  return Math.hypot(dx, dy);
}

// Pulsa un botón y lo deja "hundido" un instante para que se note el clic.
function press(el) {
  el.classList.add('pressed');
  setTimeout(() => el.classList.remove('pressed'), 180);
  el.click();
}

export class Interaction {
  constructor(desktop, cfg = CONFIG) {
    this.desktop = desktop;
    this.cfg = cfg;
    this.engaged = new Map(); // id de mano -> acción en curso (drag, press, zoom, resize)
    this.locks = new Map(); // id de mano -> poses que hay que soltar antes de volver a usarlas
    this.lastSeen = new Map();
    this.hovered = new Map(); // id de mano -> botón iluminado (el que se pulsará)
    this.magnet = new Map(); // id de mano -> desplazamiento suavizado del cursor hacia su botón
    this.hoverLog = new Map(); // id de mano -> [{t, el}]: qué botón estuvo iluminado y cuándo
    this.armed = new Map(); // ventana -> 'resize-armed' | 'closing-armed' (a punto de pasar)
    this.pinchEndedAt = new Map(); // id de mano -> cuándo soltó su último pellizco
    this.now = 0;
  }

  get mode() {
    for (const e of this.engaged.values()) if (e.type === 'resize') return 'resize';
    return 'active';
  }

  /** Cancela todo (p. ej. al dormir el sistema). */
  reset() {
    for (const eng of new Set(this.engaged.values())) this.#finish(eng);
    this.engaged.clear();
    for (const el of this.hovered.values()) el?.classList.remove('hover');
    this.hovered.clear();
    this.magnet.clear();
    this.hoverLog.clear();
    this.#arm(new Map());
    this.desktop.updateGlow([]);
  }

  /**
   * @param {object} state  salida de GestureEngine.update
   * @returns {{mode: string, indicators: object[], lines: object[]}} qué dibujar en el HUD
   */
  update(state, now) {
    const out = { mode: 'sleep', indicators: [], lines: [] };
    if (!state.active) {
      if (this.engaged.size || this.hovered.size || this.armed.size) this.reset();
      return out;
    }
    this.now = now;
    const pointers = new Map(state.pointers.map((p) => [p.handId, p]));
    for (const p of state.pointers) this.lastSeen.set(p.handId, now);

    for (const e of state.events) {
      if (e.type === 'pinchstart') this.#pinchStart(e, pointers);
      else if (e.type === 'pinchend') this.#pinchEnd(e, pointers);
    }

    for (const [id, eng] of [...this.engaged]) {
      if (this.engaged.get(id) !== eng) continue;
      const p = pointers.get(id);
      if (eng.type === 'drag' && p) eng.win.moveTo(eng.startRect.x + p.x - eng.start.x, eng.startRect.y + p.y - eng.start.y);
      else if (eng.type === 'zoom' && eng.hands[0] === id) this.#zoom(eng, pointers, out);
      else if (eng.type === 'resize') this.#resize(id, eng, p, now, out);
    }

    const armed = new Map();
    for (const p of state.pointers) {
      this.#releaseLocks(p);
      if (!this.engaged.has(p.handId) && !p.pinching) this.#holds(p, out, armed);
    }
    this.#arm(armed);
    this.#hover(state.pointers);

    // Olvida los bloqueos de manos que ya no se ven.
    for (const id of this.locks.keys()) {
      if (!pointers.has(id) && now - (this.lastSeen.get(id) ?? 0) > this.cfg.HAND_LOST_MS) {
        this.locks.delete(id);
        this.lastSeen.delete(id);
        this.pinchEndedAt.delete(id);
      }
    }

    out.mode = this.mode;
    return out;
  }

  // ── Pellizco ──

  #pinchStart(e, pointers) {
    const id = e.handId;
    if (this.engaged.has(id)) return;
    // Si había un botón iluminado, ese es el objetivo; si no, lo que haya bajo el punto de agarre.
    const lit = this.hovered.get(id);
    const hit = lit?.isConnected ? { win: this.desktop.windowFor(lit), zone: 'button', target: lit } : this.desktop.hitTest(e.x, e.y);
    if (!hit) return;

    // Si la otra mano ya tiene agarrada esta ventana, empieza el zoom con dos manos.
    if (hit.win) {
      for (const [otherId, other] of this.engaged) {
        if (other.win !== hit.win || (other.type !== 'drag' && other.type !== 'press')) continue;
        const q = pointers.get(otherId);
        if (!q) continue;
        this.#finish(other);
        const a = { x: q.x, y: q.y };
        const b = { x: e.x, y: e.y };
        const zoom = { type: 'zoom', win: hit.win, hands: [otherId, id], startDist: Math.max(dist(a, b), 40), startMid: mid(a, b), startRect: hit.win.rect };
        this.engaged.set(otherId, zoom);
        this.engaged.set(id, zoom);
        hit.win.setState('zooming', true);
        return;
      }
      this.desktop.focus(hit.win);
    }

    if (hit.zone === 'border' || hit.zone === 'title') {
      this.engaged.set(id, { type: 'drag', win: hit.win, startRect: hit.win.rect, start: { x: e.x, y: e.y } });
      hit.win.setState('dragging', true);
    } else {
      // Clic al pellizcar: soltar o mover la mano después ya no lo cancela.
      if (hit.target) press(hit.target);
      this.engaged.set(id, { type: 'press', win: hit.win, target: hit.target, start: { x: e.x, y: e.y } });
    }
  }

  #pinchEnd(e, pointers) {
    // Al soltar, la mano suele quedar en puño o en L: esas poses no deben cerrar ni redimensionar
    // (solo cuentan las que se formen después de soltar).
    this.pinchEndedAt.set(e.handId, this.now);
    const eng = this.engaged.get(e.handId);
    if (!eng || eng.type === 'resize') return;
    this.engaged.delete(e.handId);

    if (eng.type === 'drag') {
      // Al abrir los dedos el punto medio se corre: la ventana queda donde estaba justo antes.
      eng.win.moveTo(eng.startRect.x + e.x - eng.start.x, eng.startRect.y + e.y - eng.start.y);
      eng.win.setState('dragging', false);
    } else if (eng.type === 'zoom') {
      eng.win.setState('zooming', false);
      // La mano que sigue pellizcando pasa a mover la ventana desde donde está.
      const otherId = eng.hands.find((h) => h !== e.handId);
      const q = pointers.get(otherId);
      this.engaged.delete(otherId);
      if (q?.pinching) {
        this.engaged.set(otherId, { type: 'drag', win: eng.win, startRect: eng.win.rect, start: { x: q.x, y: q.y } });
        eng.win.setState('dragging', true);
      }
    }
  }

  #zoom(eng, pointers, out) {
    const a = pointers.get(eng.hands[0]);
    const b = pointers.get(eng.hands[1]);
    if (!a || !b) return;
    const s = dist(a, b) / eng.startDist;
    const m = mid(a, b);
    const r = eng.startRect;
    eng.win.setCenterSize(r.x + r.w / 2 + m.x - eng.startMid.x, r.y + r.h / 2 + m.y - eng.startMid.y, r.w * s, r.h * s);
    out.lines.push({ a, b, rgb: 'cyan' });
  }

  // ── Modo tamaño ("L" quieta) ──

  #startResize(p, win) {
    this.engaged.set(p.handId, {
      type: 'resize',
      win,
      startRect: win.rect,
      startRatio: Math.max(p.pinchRatio, 0.15),
      entryPalmY: p.palm2D.y,
      size2D: p.size2D,
      filter: new OneEuroFilter({ minCutoff: 1.5, beta: 0.5 }),
    });
    this.#lock(p.handId, 'L');
    win.setState('resizing', true);
    this.desktop.focus(win);
  }

  #resize(id, eng, p, now, out) {
    const cfg = this.cfg;
    if (!p) {
      if (now - (this.lastSeen.get(id) ?? now) > cfg.HAND_LOST_MS) this.#end(id, eng);
      return;
    }
    // Salir: cerrar el puño o bajar la mano.
    if (p.pose === 'puno') {
      this.#lock(id, 'puno'); // ese puño no debe cerrar la ventana
      this.#end(id, eng);
      return;
    }
    if (p.palm2D.y - eng.entryPalmY > cfg.RESIZE_EXIT_DROP * eng.size2D) {
      this.#end(id, eng);
      return;
    }
    const [ratio] = eng.filter.filter([p.pinchRatio], now);
    const s = Math.pow(Math.max(ratio, 0.02) / eng.startRatio, cfg.RESIZE_SENSITIVITY);
    const r = eng.startRect;
    eng.win.setCenterSize(r.x + r.w / 2, r.y + r.h / 2, r.w * s, r.h * s);
    out.lines.push({ a: p.thumbTip, b: p.indexTip, rgb: 'amber' });
  }

  // ── Poses sostenidas sobre una ventana ──

  #holds(p, out, armed) {
    const cfg = this.cfg;
    const locks = this.locks.get(p.handId);
    // Una pose que empezó antes de soltar el último pellizco no cuenta.
    if (this.now - p.poseMs <= (this.pinchEndedAt.get(p.handId) ?? -Infinity)) return;
    const over = () => this.desktop.windowAt(p.x, p.y) ?? this.desktop.windowAt(p.palm.x, p.palm.y);

    if (p.pose === 'L' && !locks?.has('L')) {
      const win = over();
      if (!win) return;
      if (p.holdMs >= cfg.RESIZE_HOLD_MS) {
        this.#startResize(p, win);
      } else if (p.holdMs > 100) {
        armed.set(win, 'resize-armed');
        out.indicators.push({ x: p.x, y: p.y, progress: p.holdMs / cfg.RESIZE_HOLD_MS, rgb: 'amber', label: 'TAMAÑO' });
      }
      return;
    }
    if (p.pose === 'puno' && !locks?.has('puno')) {
      const win = this.desktop.windowAt(p.palm.x, p.palm.y) ?? this.desktop.windowAt(p.x, p.y);
      if (!win) return;
      if (p.poseMs >= cfg.FIST_CLOSE_HOLD_MS) {
        this.#lock(p.handId, 'puno');
        this.desktop.closeWindow(win);
        return;
      }
      armed.set(win, 'closing-armed');
      out.indicators.push({ ...p.palm, progress: p.poseMs / cfg.FIST_CLOSE_HOLD_MS, rgb: 'red', label: 'CERRAR' });
    }
  }

  #lock(id, pose) {
    if (!this.locks.has(id)) this.locks.set(id, new Set());
    this.locks.get(id).add(pose);
  }

  #releaseLocks(p) {
    const locks = this.locks.get(p.handId);
    if (!locks) return;
    for (const pose of locks) if (p.pose !== pose) locks.delete(pose);
  }

  #arm(armed) {
    for (const [w, cls] of this.armed) if (armed.get(w) !== cls) w.setState(cls, false);
    for (const [w, cls] of armed) w.setState(cls, true);
    this.armed = armed;
  }

  // ── Resaltado: bordes que brillan y el botón que se pulsará ──

  #hover(pointers) {
    const cfg = this.cfg;
    const free = pointers.filter((p) => !this.engaged.has(p.handId));
    this.desktop.updateGlow(free);
    const seen = new Set();
    for (const p of pointers) {
      seen.add(p.handId);
      const eng = this.engaged.get(p.handId);
      const prev = this.hovered.get(p.handId) ?? null;
      let target = null;
      p.hoverLocked = false;
      if (!eng && !p.pinching) {
        // Mientras se juntan los dedos la punta del índice baja hacia el pulgar: se mantiene el
        // botón que estaba iluminado cuando empezaron a cerrarse.
        const locked = p.closingSince != null ? this.#litAt(p.handId, p.closingSince) : null;
        if (locked?.isConnected && rectDistance(locked.getBoundingClientRect(), p) <= cfg.HOVER_LOCK_RELEASE_PX) {
          target = locked;
          p.hoverLocked = true;
        } else {
          target = this.#nearestButton(p);
        }
      }
      this.#logHover(p.handId, target);
      const hit = eng || target ? null : this.desktop.hitTest(p.x, p.y);
      p.hover = eng ? eng.type : target ? 'button' : hit?.zone === 'border' || hit?.zone === 'title' ? 'grab' : hit?.zone ?? null;
      if (prev !== target) {
        prev?.classList.remove('hover');
        target?.classList.add('hover');
        this.hovered.set(p.handId, target);
      }
      this.#pull(p, target);
    }
    for (const [id, el] of this.hovered) {
      if (seen.has(id)) continue;
      el?.classList.remove('hover');
      this.hovered.delete(id);
      this.magnet.delete(id);
      this.hoverLog.delete(id);
    }
  }

  // Guarda qué botón iluminaba el cursor libre en cada frame (para fijarlo al pellizcar).
  #logHover(id, el) {
    if (!this.hoverLog.has(id)) this.hoverLog.set(id, []);
    const log = this.hoverLog.get(id);
    log.push({ t: this.now, el });
    while (log.length > 2 && this.now - log[0].t > this.cfg.PINCH_CLOSING_WINDOW_MS) log.shift();
  }

  // Botón iluminado en el instante t (el último registrado hasta ese momento).
  #litAt(id, t) {
    let el = null;
    for (const e of this.hoverLog.get(id) ?? []) {
      if (e.t > t) break;
      el = e.el;
    }
    return el;
  }

  // Botón pulsable más cercano al cursor (dentro de MAGNET_PX) que no esté tapado.
  #nearestButton(p) {
    let best = null;
    for (const el of document.querySelectorAll('[data-pinch]')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const radius = el.dataset.magnet === 'off' ? 0 : this.cfg.MAGNET_PX;
      const d = rectDistance(r, p);
      if (d > radius || (best && d >= best.d)) continue;
      // El punto del botón más cercano al cursor tiene que ser del botón (no de otra ventana encima).
      const x = Math.min(Math.max(p.x, r.left + 1), r.right - 1);
      const y = Math.min(Math.max(p.y, r.top + 1), r.bottom - 1);
      if (document.elementFromPoint(x, y)?.closest('[data-pinch]') !== el) continue;
      best = { el, d };
    }
    return best?.el ?? null;
  }

  // Imán: acerca el cursor al centro de su botón (suavizado para que no salte entre teclas).
  #pull(p, target) {
    const cfg = this.cfg;
    let tx = 0;
    let ty = 0;
    if (target) {
      const r = target.getBoundingClientRect();
      tx = (r.left + r.width / 2 - p.x) * cfg.MAGNET_PULL;
      ty = (r.top + r.height / 2 - p.y) * cfg.MAGNET_PULL;
      const len = Math.hypot(tx, ty);
      if (len > cfg.MAGNET_MAX_SHIFT) {
        tx *= cfg.MAGNET_MAX_SHIFT / len;
        ty *= cfg.MAGNET_MAX_SHIFT / len;
      }
    }
    const m = this.magnet.get(p.handId) ?? { x: 0, y: 0 };
    m.x += (tx - m.x) * 0.5;
    m.y += (ty - m.y) * 0.5;
    this.magnet.set(p.handId, m);
    p.x += m.x;
    p.y += m.y;
  }

  #end(id, eng) {
    this.#finish(eng);
    this.engaged.delete(id);
  }

  // Quita los estados visuales de una acción.
  #finish(eng) {
    eng.target?.classList.remove('pressed');
    eng.win?.setState('dragging', false);
    eng.win?.setState('zooming', false);
    eng.win?.setState('resizing', false);
  }
}
