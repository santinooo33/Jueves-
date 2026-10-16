// desktop.js — Escritorio: ventanas (crear, enfocar, mover, redimensionar, cerrar), zonas
// para agarrarlas y brillo del borde cuando un dedo se acerca.

import { CONFIG } from './gestures.js';

// Límites de tamaño y posición de las ventanas (px CSS).
export const WINDOW_LIMITS = {
  minW: 240,
  minH: 160,
  margin: 8, // margen con el borde de la pantalla para el tamaño máximo
  keepVisible: 90, // px de ventana que siempre quedan dentro de la pantalla al moverla
};
const TITLE_H = 40; // alto de la barra de título (debe coincidir con el CSS)
const TOP_BAR_H = 56; // las ventanas nuevas se centran por debajo de la barra superior

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Desktop {
  constructor(root) {
    this.root = root;
    this.windows = []; // de atrás hacia delante
    this.z = 1;
    this.nextId = 1;
  }

  get bounds() {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  /** Crea una ventana. `content` es el elemento que va dentro. */
  createWindow({ title, icon = '◈', content, width = 420, height = 260, x, y }) {
    const win = new DesktopWindow(this, { id: this.nextId++, title, icon, content });
    const b = this.bounds;
    // Cada ventana nueva aparece un poco desplazada para no tapar del todo a la anterior.
    const shift = ((this.windows.length % 5) - 2) * 28;
    const top = TOP_BAR_H + Math.max(0, (b.height - TOP_BAR_H - height) / 2);
    win.setRect(x ?? (b.width - width) / 2 + shift, y ?? top + shift / 2, width, height);
    this.root.appendChild(win.el);
    this.windows.push(win);
    this.focus(win);
    requestAnimationFrame(() => requestAnimationFrame(() => win.el.classList.remove('opening')));
    return win;
  }

  closeWindow(win) {
    const i = this.windows.indexOf(win);
    if (i < 0) return;
    this.windows.splice(i, 1);
    win.el.classList.add('closing');
    setTimeout(() => win.el.remove(), 280);
    const top = this.windows.at(-1);
    if (top) this.focus(top);
  }

  focus(win) {
    const i = this.windows.indexOf(win);
    if (i < 0) return;
    this.windows.splice(i, 1);
    this.windows.push(win);
    win.el.style.zIndex = String(++this.z);
    for (const w of this.windows) w.el.classList.toggle('focused', w === win);
  }

  /** La ventana más al frente que contiene el punto (ampliada `pad` px por fuera). */
  windowAt(x, y, pad = 0) {
    for (let i = this.windows.length - 1; i >= 0; i--) {
      const r = this.windows[i].rect;
      if (x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) return this.windows[i];
    }
    return null;
  }

  /**
   * Qué hay bajo un punto: { win, zone, target }.
   * zone: 'button' (algo que se pulsa con pellizco), 'border' o 'title' (para mover),
   * 'content' (resto de la ventana). null si no hay nada.
   */
  hitTest(x, y) {
    const win = this.windowAt(x, y, CONFIG.EDGE_GRAB_OUTSIDE_PX);
    if (win) {
      const target = pinchableAt(x, y);
      if (target && win.el.contains(target)) return { win, zone: 'button', target };
      const r = win.rect;
      const m = CONFIG.EDGE_GRAB_INSIDE_PX;
      const inner = x > r.x + m && x < r.x + r.w - m && y > r.y + m && y < r.y + r.h - m;
      if (!inner) return { win, zone: 'border', target: null };
      if (y - r.y < TITLE_H) return { win, zone: 'title', target: null };
      return { win, zone: 'content', target: null };
    }
    const target = pinchableAt(x, y);
    return target ? { win: null, zone: 'button', target } : null;
  }

  /** Ilumina el borde de cada ventana según lo cerca que estén los cursores libres. */
  updateGlow(points) {
    for (const win of this.windows) {
      let best = null;
      for (const p of points) {
        const e = nearestEdge(win.rect, p);
        if (!best || e.d < best.d) best = e;
      }
      const glow = best ? clamp(1 - best.d / CONFIG.EDGE_GLOW_PX, 0, 1) : 0;
      win.setGlow(glow, best?.lx ?? 0, best?.ly ?? 0);
    }
  }
}

class DesktopWindow {
  constructor(desktop, { id, title, icon, content }) {
    this.desktop = desktop;
    this.id = id;
    this.x = 0;
    this.y = 0;
    this.w = 0;
    this.h = 0;
    this.glow = -1;

    const el = document.createElement('section');
    el.className = 'window opening';
    el.innerHTML = `
      <div class="win-glow" aria-hidden="true"></div>
      <header class="win-title">
        <span class="win-icon" aria-hidden="true"></span>
        <span class="win-name"></span>
        <span class="win-size"></span>
        <button class="win-btn" type="button" data-pinch aria-label="Cerrar">✕</button>
      </header>
      <div class="win-body"></div>`;
    el.querySelector('.win-icon').textContent = icon;
    el.querySelector('.win-name').textContent = title;
    el.querySelector('.win-body').append(content);
    el.querySelector('.win-btn').addEventListener('click', () => desktop.closeWindow(this));
    this.el = el;
    this.sizeEl = el.querySelector('.win-size');
  }

  get rect() {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  /** Cambia posición y tamaño respetando los límites. */
  setRect(x, y, w, h) {
    const b = this.desktop.bounds;
    const L = WINDOW_LIMITS;
    this.w = Math.round(clamp(w, L.minW, Math.max(L.minW, b.width - 2 * L.margin)));
    this.h = Math.round(clamp(h, L.minH, Math.max(L.minH, b.height - 2 * L.margin)));
    this.x = Math.round(clamp(x, L.keepVisible - this.w, b.width - L.keepVisible));
    this.y = Math.round(clamp(y, 0, b.height - TITLE_H));
    const s = this.el.style;
    s.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
    s.width = `${this.w}px`;
    s.height = `${this.h}px`;
    this.sizeEl.textContent = `${this.w} × ${this.h}`;
  }

  moveTo(x, y) {
    this.setRect(x, y, this.w, this.h);
  }

  /** Redimensiona alrededor de un centro (cx, cy). */
  setCenterSize(cx, cy, w, h) {
    const b = this.desktop.bounds;
    const L = WINDOW_LIMITS;
    const cw = clamp(w, L.minW, Math.max(L.minW, b.width - 2 * L.margin));
    const ch = clamp(h, L.minH, Math.max(L.minH, b.height - 2 * L.margin));
    this.setRect(cx - cw / 2, cy - ch / 2, cw, ch);
  }

  setState(name, on) {
    this.el.classList.toggle(name, on);
  }

  setGlow(value, lx, ly) {
    const v = Math.round(value * 20) / 20;
    if (v === this.glow && v === 0) return;
    this.glow = v;
    const s = this.el.style;
    s.setProperty('--glow', String(v));
    s.setProperty('--gx', `${Math.round(lx)}px`);
    s.setProperty('--gy', `${Math.round(ly)}px`);
  }
}

// Elemento pulsable con pellizco bajo un punto (marcado con data-pinch).
function pinchableAt(x, y) {
  return document.elementFromPoint(x, y)?.closest('[data-pinch]') ?? null;
}

// Punto del contorno del rectángulo más cercano a p (en coordenadas locales) y su distancia.
function nearestEdge(r, p) {
  const cx = clamp(p.x, r.x, r.x + r.w);
  const cy = clamp(p.y, r.y, r.y + r.h);
  if (cx !== p.x || cy !== p.y) return { d: Math.hypot(p.x - cx, p.y - cy), lx: cx - r.x, ly: cy - r.y };
  const left = p.x - r.x;
  const right = r.x + r.w - p.x;
  const top = p.y - r.y;
  const bottom = r.y + r.h - p.y;
  const d = Math.min(left, right, top, bottom);
  if (d === left) return { d, lx: 0, ly: top };
  if (d === right) return { d, lx: r.w, ly: top };
  if (d === top) return { d, lx: left, ly: 0 };
  return { d, lx: left, ly: r.h };
}
