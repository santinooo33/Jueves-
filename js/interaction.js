// interaction.js — Traduce los gestos en acciones sobre el escritorio:
//   · pellizco en la barra o el borde → mover la ventana (sigue el punto medio pulgar-índice)
//   · pellizco en un botón → pulsarlo (el clic se dispara al soltar, como con un mouse)
//   · "L" quieta sobre una ventana → modo tamaño (abrir/cerrar los dedos la agranda/achica)
//   · pellizco con las dos manos sobre una ventana → zoom
//   · puño sostenido sobre una ventana → cerrarla

import { CONFIG } from './gestures.js';
import { OneEuroFilter } from './one-euro-filter.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export class Interaction {
  constructor(desktop, cfg = CONFIG) {
    this.desktop = desktop;
    this.cfg = cfg;
    this.engaged = new Map(); // id de mano -> acción en curso (drag, press, zoom, resize)
    this.locks = new Map(); // id de mano -> poses que hay que soltar antes de volver a usarlas
    this.lastSeen = new Map();
    this.hovered = new Map(); // id de mano -> botón iluminado
    this.armed = new Map(); // ventana -> 'resize-armed' | 'closing-armed' (a punto de pasar)
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
      else if (eng.type === 'press' && p) this.#press(eng, p);
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

    out.mode = this.mode;
    return out;
  }

  // ── Pellizco ──

  #pinchStart(e, pointers) {
    const id = e.handId;
    if (this.engaged.has(id)) return;
    const hit = this.desktop.hitTest(e.x, e.y);
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
      hit.target?.classList.add('pressed');
      this.engaged.set(id, { type: 'press', win: hit.win, target: hit.target, start: { x: e.x, y: e.y } });
    }
  }

  #pinchEnd(e, pointers) {
    const eng = this.engaged.get(e.handId);
    if (!eng || eng.type === 'resize') return;
    this.engaged.delete(e.handId);

    if (eng.type === 'press') {
      eng.target?.classList.remove('pressed');
      const moved = dist({ x: e.x, y: e.y }, eng.start);
      if (eng.target && !e.lost && !eng.cancelled && moved <= this.cfg.CLICK_MAX_MOVE_PX) eng.target.click();
    } else if (eng.type === 'drag') {
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

  #press(eng, p) {
    if (eng.cancelled || dist(p, eng.start) <= this.cfg.CLICK_MAX_MOVE_PX) return;
    // Se movió demasiado: ya no es un clic.
    eng.cancelled = true;
    eng.target?.classList.remove('pressed');
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

  // ── Resaltado: bordes que brillan y botones bajo el cursor ──

  #hover(pointers) {
    const free = pointers.filter((p) => !this.engaged.has(p.handId));
    this.desktop.updateGlow(free);
    const seen = new Set();
    for (const p of pointers) {
      seen.add(p.handId);
      const eng = this.engaged.get(p.handId);
      const hit = eng ? null : this.desktop.hitTest(p.x, p.y);
      p.hover = eng ? eng.type : hit?.zone === 'border' || hit?.zone === 'title' ? 'grab' : hit?.zone ?? null;
      const target = hit?.zone === 'button' ? hit.target : null;
      const prev = this.hovered.get(p.handId);
      if (prev !== target) {
        prev?.classList.remove('hover');
        target?.classList.add('hover');
        this.hovered.set(p.handId, target);
      }
    }
    for (const [id, el] of this.hovered) {
      if (seen.has(id)) continue;
      el?.classList.remove('hover');
      this.hovered.delete(id);
    }
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
