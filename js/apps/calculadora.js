// apps/calculadora.js — Calculadora con botones grandes para pulsar con pellizco.
// La lógica (calcKey, evaluate) es pura, sin DOM, para poder probarla.

const OPS = ['+', '−', '×', '÷'];
const MAX_DIGITS = 12;

export const CALC_INITIAL = { tokens: [], done: false, history: '' };

const isOp = (t) => OPS.includes(t);
const last = (tokens) => tokens.at(-1);

/** Aplica una tecla al estado y devuelve el estado nuevo. */
export function calcKey(state, key) {
  let tokens = [...state.tokens];
  let { done, history } = state;

  if (key === 'C') return { ...CALC_INITIAL };

  if (/^\d$/.test(key) || key === '.') {
    if (done) {
      tokens = [];
      done = false;
    }
    const t = last(tokens);
    if (t === undefined || isOp(t)) {
      tokens.push(key === '.' ? '0.' : key);
    } else if (key === '.') {
      if (!t.includes('.')) tokens[tokens.length - 1] = `${t}.`;
    } else if (t.replace(/[-.]/g, '').length < MAX_DIGITS) {
      tokens[tokens.length - 1] = t === '0' ? key : t === '-0' ? `-${key}` : t + key;
    }
    return { tokens, done, history };
  }

  if (isOp(key)) {
    done = false;
    const t = last(tokens);
    if (t === undefined) tokens.push('0', key);
    else if (isOp(t)) tokens[tokens.length - 1] = key;
    else if (t !== 'Error') tokens.push(key);
    return { tokens, done, history };
  }

  if (key === '=') {
    const expr = trimOp(tokens);
    if (expr.length < 3) return state;
    const value = evaluate(expr);
    return { tokens: [formatNumber(value)], done: true, history: `${expr.join(' ')} =` };
  }

  if (key === 'back') {
    if (done) return { ...CALC_INITIAL };
    const t = last(tokens);
    if (t === undefined) return state;
    const shorter = isOp(t) || t.length === 1 || t === 'Error' || /^-\d$/.test(t) ? '' : t.slice(0, -1);
    if (shorter) tokens[tokens.length - 1] = shorter;
    else tokens.pop();
    return { tokens, done, history };
  }

  // ± y % actúan sobre el último número.
  if (key === 'sign' || key === 'percent') {
    const t = last(tokens);
    if (t === undefined || isOp(t) || t === 'Error') return state;
    tokens[tokens.length - 1] =
      key === 'sign' ? (t.startsWith('-') ? t.slice(1) : `-${t}`) : formatNumber(Number(t) / 100);
    return { tokens, done: false, history };
  }

  return state;
}

/** Resultado provisional mientras se escribe (o '' si aún no hay operación). */
export function calcPreview(state) {
  const expr = trimOp(state.tokens);
  if (state.done || expr.length < 3) return '';
  return formatNumber(evaluate(expr));
}

/** Evalúa [n, op, n, op, n…] respetando que × y ÷ van antes que + y −. */
export function evaluate(tokens) {
  const nums = [Number(tokens[0])];
  const ops = [];
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const n = Number(tokens[i + 1]);
    if (op === '×') nums[nums.length - 1] *= n;
    else if (op === '÷') nums[nums.length - 1] = n === 0 ? NaN : nums[nums.length - 1] / n;
    else {
      ops.push(op);
      nums.push(n);
    }
  }
  return ops.reduce((acc, op, i) => (op === '+' ? acc + nums[i + 1] : acc - nums[i + 1]), nums[0]);
}

export function formatNumber(n) {
  if (!Number.isFinite(n)) return 'Error';
  const rounded = parseFloat(n.toPrecision(12));
  const s = String(rounded);
  return s.replace('.', '').replace('-', '').length > 14 ? rounded.toExponential(6) : s;
}

const trimOp = (tokens) => (isOp(last(tokens)) ? tokens.slice(0, -1) : tokens);

// ── Interfaz ──

const KEYS = [
  ['7', '8', '9', '÷', 'C'],
  ['4', '5', '6', '×', 'back'],
  ['1', '2', '3', '−', 'sign'],
  ['0', '.', 'percent', '+', '='],
];
const LABELS = { back: '⌫', sign: '±', percent: '%' };

export function createCalculadora() {
  const el = document.createElement('div');
  el.className = 'calc';
  el.innerHTML = `
    <div class="calc-display">
      <div class="calc-expr"></div>
      <div class="calc-main"></div>
    </div>
    <div class="calc-keys">
      ${KEYS.flat()
        .map((k) => {
          const kind = isOp(k) ? 'op' : k === '=' ? 'eq' : /^[\d.]$/.test(k) ? 'num' : 'fn';
          return `<button type="button" class="calc-key ${kind}" data-pinch data-key="${k}">${LABELS[k] ?? k}</button>`;
        })
        .join('')}
    </div>`;
  const exprEl = el.querySelector('.calc-expr');
  const mainEl = el.querySelector('.calc-main');
  let state = { ...CALC_INITIAL };

  const render = () => {
    const preview = calcPreview(state);
    exprEl.textContent = state.done ? state.history : preview ? `= ${preview}` : ' ';
    mainEl.textContent = state.tokens.length ? state.tokens.join(' ') : '0';
    mainEl.classList.toggle('long', mainEl.textContent.length > 12);
  };
  el.querySelector('.calc-keys').addEventListener('click', (e) => {
    const key = e.target.closest('[data-key]')?.dataset.key;
    if (!key) return;
    state = calcKey(state, key);
    render();
  });
  render();
  return { el };
}
