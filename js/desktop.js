// desktop.js — Escritorio: ventanas (abrir apps, enfocar, mover, redimensionar, minimizar,
// cerrar), zonas para agarrarlas, brillo del borde cuando un dedo se acerca y barra de apps.

import { CONFIG } from './gestures.js';

// Límites de tamaño y posición de las ventanas (px CSS).
export const WINDOW_LIMITS = {
  minW: 240,
  minH: 160,
  margin: 8, // margen con el borde de la pantalla para el tamaño máximo
  keepVisible: 90, // px de ventana que siempre quedan dentro de la pantalla al moverla
};
const TITLE_H = 40; // alto de la barra de título (debe coincidir con el CSS)
const TOP_BAR_H = 52; // las ventanas nuevas se abren por debajo de la barra superior…
const EDGE_GAP = 14; // …y separadas de los lados

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Desktop {
  constructor(root) {
    this.root = root;
    this.windows = []; // de atrás hacia delante (incluye las minimizadas)
    this.z = 1;
    this.nextId = 1;
    this.bottomReserve = 0; // alto que ocupa la barra de apps
    this.dockTarget = null; // (appId) => {x, y}: a dónde va una ventana al minimizarse
    this.listeners = new Set();
  }

  get bounds() {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  get visibleWindows() {
    return this.windows.filter((w) => !w.minimized);
  }

  /** La ventana visible que está al frente. */
  get topWindow() {
    return this.visibleWindows.at(-1) ?? null;
  }

  /** Ventana visible que contiene un elemento (null si está fuera de las ventanas). */
  windowFor(el) {
    return this.visibleWindows.find((w) => w.el.contains(el)) ?? null;
  }

  windowOf(appId) {
    return this.windows.find((w) => w.appId === appId) ?? null;
  }

  /** Avisa cuando cambian las ventanas (para la barra de apps). */
  onChange(fn) {
    this.listeners.add(fn);
  }

  #emit() {
    for (const fn of this.listeners) fn();
  }

  /**
   * Ícono de la barra pellizcado: abre la app; si está minimizada la restaura; si ya está al
   * frente la minimiza; si está detrás de otra, la trae al frente.
   */
  launch(app) {
    const win = this.windowOf(app.id);
    if (!win) return this.openApp(app);
    if (win.minimized) this.restore(win);
    else if (win === this.topWindow) this.minimize(win);
    else this.focus(win);
    return win;
  }

  openApp(app) {
    const instance = app.create();
    return this.createWindow({
      appId: app.id,
      title: app.name,
      icon: app.icon,
      content: instance.el,
      width: app.size.w,
      height: app.size.h,
      minW: app.min?.w,
      minH: app.min?.h,
      place: app.place,
      onClose: instance.dispose,
    });
  }

  /** Crea una ventana. `content` es el elemento que va dentro; `icon`, SVG o texto. */
  createWindow({ appId = null, title, icon = '◈', content, width = 420, height = 260, minW, minH, place = 'center', onClose, x, y }) {
    const win = new DesktopWindow(this, { id: this.nextId++, appId, title, icon, content, minW, minH, onClose });
    const b = this.bounds;
    const areaTop = TOP_BAR_H;
    const areaH = Math.max(WINDOW_LIMITS.minH, b.height - areaTop - this.bottomReserve);
    const h = Math.min(height, areaH);
    const w = Math.min(width, b.width - 2 * EDGE_GAP);
    const left = place === 'left' ? EDGE_GAP : place === 'right' ? b.width - w - EDGE_GAP : (b.width - w) / 2;
    // Si ya hay ventanas, la nueva aparece un poco desplazada para no taparlas del todo.
    const shift = place === 'center' ? ((this.windows.length % 4) - 1.5) * 24 : 0;
    win.setRect(x ?? left + shift, y ?? areaTop + Math.max(0, (areaH - h) / 2), w, h);
    win.aimAt(this.#dockPoint(appId)); // se abre creciendo desde su ícono
    this.root.appendChild(win.el);
    this.windows.push(win);
    this.focus(win);
    requestAnimationFrame(() => requestAnimationFrame(() => win.el.classList.remove('opening')));
    this.#emit();
    return win;
  }

  closeWindow(win) {
    const i = this.windows.indexOf(win);
    if (i < 0) return;
    this.windows.splice(i, 1);
    win.el.classList.add('closing');
    setTimeout(() => win.el.remove(), 300);
    win.onClose?.();
    const top = this.topWindow;
    if (top) this.focus(top);
    this.#emit();
  }

  minimize(win) {
    if (win.minimized) return;
    win.minimized = true;
    win.aimAt(this.#dockPoint(win.appId));
    win.el.classList.add('minimized');
    win.el.classList.remove('focused');
    const top = this.topWindow;
    if (top) this.focus(top);
    this.#emit();
  }

  restore(win) {
    if (!win.minimized) return;
    win.minimized = false;
    win.el.classList.remove('minimized');
    this.focus(win);
    this.#emit();
  }

  focus(win) {
    const i = this.windows.indexOf(win);
    if (i < 0 || win.minimized) return;
    this.windows.splice(i, 1);
    this.windows.push(win);
    win.el.style.zIndex = String(++this.z);
    for (const w of this.windows) w.el.classList.toggle('focused', w === win);
    this.#emit();
  }

  #dockPoint(appId) {
    const b = this.bounds;
    return (appId && this.dockTarget?.(appId)) ?? { x: b.width / 2, y: b.height - 30 };
  }

  /** La ventana más al frente que contiene el punto (ampliada `pad` px por fuera). */
  windowAt(x, y, pad = 0) {
    const wins = this.visibleWindows;
    for (let i = wins.length - 1; i >= 0; i--) {
      const r = wins[i].rect;
      if (x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) return wins[i];
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
    for (const win of this.visibleWindows) {
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
  constructor(desktop, { id, appId, title, icon, content, minW, minH, onClose }) {
    this.desktop = desktop;
    this.id = id;
    this.appId = appId;
    this.minW = minW ?? WINDOW_LIMITS.minW;
    this.minH = minH ?? WINDOW_LIMITS.minH;
    this.onClose = onClose;
    this.minimized = false;
    this.x = 0;
    this.y = 0;
    this.w = 0;
    this.h = 0;
    this.glow = -1;

    const el = document.createElement('section');
    el.className = 'window opening';
    if (appId) el.dataset.app = appId;
    el.innerHTML = `
      <div class="win-glow" aria-hidden="true"></div>
      <header class="win-title">
        <span class="win-icon" aria-hidden="true"></span>
        <span class="win-name"></span>
        <span class="win-size"></span>
        <button class="win-btn min" type="button" data-pinch data-magnet="off" aria-label="Minimizar">–</button>
        <button class="win-btn close" type="button" data-pinch data-magnet="off" aria-label="Cerrar">✕</button>
      </header>
      <div class="win-body"></div>`;
    // El ícono viene del registro de apps (SVG propio); el título es texto.
    el.querySelector('.win-icon').innerHTML = icon;
    el.querySelector('.win-name').textContent = title;
    el.querySelector('.win-body').append(content);
    el.querySelector('.win-btn.min').addEventListener('click', () => desktop.minimize(this));
    el.querySelector('.win-btn.close').addEventListener('click', () => desktop.closeWindow(this));
    this.el = el;
    this.sizeEl = el.querySelector('.win-size');
  }

  /** Punto (su ícono en la barra) hacia el que se encoge al minimizarse o desde el que crece. */
  aimAt({ x, y }) {
    this.el.style.setProperty('--dock-x', `${Math.round(x)}px`);
    this.el.style.setProperty('--dock-y', `${Math.round(y)}px`);
  }

  get rect() {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  /** Cambia posición y tamaño respetando los límites. */
  setRect(x, y, w, h) {
    const b = this.desktop.bounds;
    const L = WINDOW_LIMITS;
    this.w = Math.round(clamp(w, this.minW, Math.max(this.minW, b.width - 2 * L.margin)));
    this.h = Math.round(clamp(h, this.minH, Math.max(this.minH, b.height - 2 * L.margin)));
    this.x = Math.round(clamp(x, L.keepVisible - this.w, b.width - L.keepVisible));
    this.y = Math.round(clamp(y, 0, b.height - TITLE_H));
    const s = this.el.style;
    s.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
    s.width = `${this.w}px`;
    s.height = `${this.h}px`;
    // Para las animaciones de abrir, cerrar y minimizar (ver CSS).
    s.setProperty('--x', `${this.x}px`);
    s.setProperty('--y', `${this.y}px`);
    s.setProperty('--w', `${this.w}px`);
    s.setProperty('--h', `${this.h}px`);
    this.sizeEl.textContent = `${this.w} × ${this.h}`;
  }

  moveTo(x, y) {
    this.setRect(x, y, this.w, this.h);
  }

  /** Redimensiona alrededor de un centro (cx, cy). */
  setCenterSize(cx, cy, w, h) {
    const b = this.desktop.bounds;
    const L = WINDOW_LIMITS;
    const cw = clamp(w, this.minW, Math.max(this.minW, b.width - 2 * L.margin));
    const ch = clamp(h, this.minH, Math.max(this.minH, b.height - 2 * L.margin));
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

/**
 * Barra de apps: un ícono por app. Pellizcarlo abre, trae al frente o minimiza la app
 * (ver Desktop.launch). Un punto debajo indica que está abierta.
 */
export class Dock {
  constructor(el, desktop, apps) {
    this.el = el;
    this.desktop = desktop;
    this.buttons = new Map();
    for (const app of apps) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dock-app';
      btn.dataset.pinch = '';
      btn.dataset.app = app.id;
      btn.setAttribute('aria-label', app.name);
      btn.innerHTML = `<span class="dock-icon">${app.icon}</span><span class="dock-label"></span><i class="dock-dot"></i>`;
      btn.querySelector('.dock-label').textContent = app.name;
      btn.addEventListener('click', () => desktop.launch(app));
      el.appendChild(btn);
      this.buttons.set(app.id, btn);
    }
    desktop.dockTarget = (appId) => {
      const r = this.buttons.get(appId)?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    };
    desktop.onChange(() => this.update());
    const reserve = () => {
      desktop.bottomReserve = el.offsetHeight ? window.innerHeight - el.getBoundingClientRect().top + 6 : 0;
    };
    reserve();
    window.addEventListener('resize', reserve);
    this.reserve = reserve;
  }

  update() {
    const top = this.desktop.topWindow;
    for (const [appId, btn] of this.buttons) {
      const win = this.desktop.windowOf(appId);
      btn.classList.toggle('running', Boolean(win));
      btn.classList.toggle('minimized', Boolean(win?.minimized));
      btn.classList.toggle('active', Boolean(win) && win === top);
    }
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
