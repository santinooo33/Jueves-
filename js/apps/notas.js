// apps/notas.js — Notas con teclado en pantalla (se escribe pellizcando las teclas).
// El texto se guarda en este dispositivo (localStorage). La lógica de teclas (typeKey) es pura.

const STORAGE_KEY = 'jueves.notas.v1';
const MAX_LENGTH = 4000;
const ACCENTS = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' };

// shift: 'auto' = mayúscula automática al empezar una frase; 'once' = la próxima letra
// en mayúscula; 'off' = la próxima en minúscula aunque toque mayúscula automática.
export const NOTES_INITIAL = { text: '', shift: 'auto', layer: 'abc', accent: false };

/** ¿La próxima letra va en mayúscula? */
export function isUpper(state) {
  if (state.shift === 'once') return true;
  if (state.shift === 'off') return false;
  return state.text === '' || /([.!?¡¿]\s|\n)$/.test(state.text);
}

/** Aplica una tecla al estado y devuelve el estado nuevo. */
export function typeKey(state, key) {
  const s = { ...state };
  switch (key) {
    case 'shift':
      s.shift = isUpper(state) ? 'off' : 'once';
      return s;
    case 'layer':
      s.layer = state.layer === 'abc' ? '123' : 'abc';
      return s;
    case 'accent':
      s.accent = !state.accent;
      return s;
    case 'back':
      if (state.accent) s.accent = false;
      else s.text = Array.from(state.text).slice(0, -1).join('');
      s.shift = 'auto';
      return s;
    case 'space':
      return append(s, ' ');
    case 'enter':
      return append(s, '\n');
    default: {
      let ch = key;
      if (/\p{L}/u.test(ch)) {
        if (isUpper(state)) ch = ch.toUpperCase();
        if (state.accent) ch = ACCENTS[ch] ?? ch;
      }
      s.accent = false;
      return append(s, ch);
    }
  }
}

function append(s, ch) {
  if (s.text.length >= MAX_LENGTH) return s;
  s.text += ch;
  s.shift = 'auto';
  return s;
}

// ── Interfaz ──

const LAYOUTS = {
  abc: [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'],
    ['shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'back'],
    ['layer', 'accent', ',', 'space', '.', 'enter'],
  ],
  123: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['@', '#', '$', '%', '&', '*', '-', '+', '(', ')'],
    ['¿', '?', '¡', '!', '"', "'", ':', ';', 'back'],
    ['layer', '/', ',', 'space', '.', 'enter'],
  ],
};
const SPECIAL = { shift: '⇧', back: '⌫', space: 'espacio', enter: '⏎', accent: '´' };

function loadText() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveText(text) {
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    // Sin almacenamiento (modo privado): la nota dura mientras la ventana esté abierta.
  }
}

export function createNotas() {
  const el = document.createElement('div');
  el.className = 'notas';
  el.innerHTML = `
    <div class="note-view">
      <div class="note-text"><span class="note-content"></span><span class="caret"></span></div>
      <button type="button" class="note-clear" data-pinch>Borrar</button>
    </div>
    <div class="kbd"></div>`;
  const view = el.querySelector('.note-text');
  const content = el.querySelector('.note-content');
  const kbd = el.querySelector('.kbd');
  const clearBtn = el.querySelector('.note-clear');
  let state = { ...NOTES_INITIAL, text: loadText() };
  let layer = null;
  let confirmTimer = 0;

  const buildKeyboard = () => {
    layer = state.layer;
    kbd.innerHTML = LAYOUTS[layer]
      .map(
        (row) =>
          `<div class="kbd-row">${row
            .map((k) => {
              const label = k === 'layer' ? (layer === 'abc' ? '123' : 'ABC') : SPECIAL[k] ?? k;
              return `<button type="button" class="kbd-key k-${k.length > 1 ? k : 'char'}" data-pinch data-key="${k}">${label}</button>`;
            })
            .join('')}</div>`,
      )
      .join('');
  };

  const render = () => {
    if (layer !== state.layer) buildKeyboard();
    content.textContent = state.text;
    view.scrollTop = view.scrollHeight;
    const upper = isUpper(state);
    kbd.classList.toggle('upper', upper);
    kbd.querySelector('[data-key="shift"]')?.classList.toggle('on', upper);
    kbd.querySelector('[data-key="accent"]')?.classList.toggle('on', state.accent);
  };

  kbd.addEventListener('click', (e) => {
    const key = e.target.closest('[data-key]')?.dataset.key;
    if (!key) return;
    state = typeKey(state, key);
    saveText(state.text);
    render();
  });

  // Borrar pide confirmación: el primer pellizco arma el botón, el segundo borra.
  clearBtn.addEventListener('click', () => {
    if (!clearBtn.classList.contains('confirm')) {
      clearBtn.classList.add('confirm');
      clearBtn.textContent = '¿Borrar todo?';
      confirmTimer = setTimeout(() => {
        clearBtn.classList.remove('confirm');
        clearBtn.textContent = 'Borrar';
      }, 3000);
      return;
    }
    clearTimeout(confirmTimer);
    clearBtn.classList.remove('confirm');
    clearBtn.textContent = 'Borrar';
    state = { ...NOTES_INITIAL };
    saveText('');
    render();
  });

  render();
  return { el, dispose: () => clearTimeout(confirmTimer) };
}
