// apps/reloj.js — Reloj analógico y digital, más un cronómetro con vueltas.

const pad = (n, len = 2) => String(n).padStart(len, '0');

/** Milisegundos → "mm:ss.cc" (o "h:mm:ss.cc" pasada una hora). */
export function formatStopwatch(ms) {
  const cs = Math.floor(ms / 10) % 100;
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000) % 60;
  const h = Math.floor(ms / 3600000);
  return `${h ? `${h}:` : ''}${pad(m)}:${pad(s)}.${pad(cs)}`;
}

const DATE_FMT = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });

function ticks() {
  let out = '';
  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0;
    out += `<line x1="50" y1="${major ? 7 : 8.5}" x2="50" y2="${major ? 13 : 10.5}" class="${major ? 'major' : ''}" transform="rotate(${i * 6} 50 50)"/>`;
  }
  return out;
}

export function createReloj() {
  const el = document.createElement('div');
  el.className = 'reloj';
  el.innerHTML = `
    <div class="tabs">
      <button type="button" class="tab on" data-pinch data-tab="hora">Hora</button>
      <button type="button" class="tab" data-pinch data-tab="crono">Cronómetro</button>
    </div>
    <section class="pane pane-hora">
      <svg class="analog" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="46" class="face"/>
        <g class="ticks">${ticks()}</g>
        <line x1="50" y1="50" x2="50" y2="27" class="hand h"/>
        <line x1="50" y1="50" x2="50" y2="17" class="hand m"/>
        <line x1="50" y1="56" x2="50" y2="12" class="hand s"/>
        <circle cx="50" cy="50" r="2.4" class="hub"/>
      </svg>
      <div class="digital">
        <div class="time"><span class="hm"></span><small class="sec"></small></div>
        <div class="date"></div>
      </div>
    </section>
    <section class="pane pane-crono" hidden>
      <div class="crono-time">00:00.00</div>
      <div class="crono-btns">
        <button type="button" class="key wide" data-pinch data-act="start">Iniciar</button>
        <button type="button" class="key wide" data-pinch data-act="lap">Vuelta</button>
        <button type="button" class="key wide" data-pinch data-act="reset">Reiniciar</button>
      </div>
      <ol class="laps"></ol>
    </section>`;

  const $ = (sel) => el.querySelector(sel);
  const hands = { h: $('.hand.h'), m: $('.hand.m'), s: $('.hand.s') };
  const hm = $('.hm');
  const sec = $('.sec');
  const date = $('.date');

  const updateClock = () => {
    const now = new Date();
    const s = now.getSeconds();
    const m = now.getMinutes() + s / 60;
    const h = (now.getHours() % 12) + m / 60;
    hands.h.setAttribute('transform', `rotate(${h * 30} 50 50)`);
    hands.m.setAttribute('transform', `rotate(${m * 6} 50 50)`);
    hands.s.setAttribute('transform', `rotate(${s * 6} 50 50)`);
    hm.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    sec.textContent = `:${pad(s)}`;
    date.textContent = DATE_FMT.format(now);
  };
  updateClock();
  const clockTimer = setInterval(updateClock, 500);

  // Cronómetro
  const display = $('.crono-time');
  const startBtn = $('[data-act="start"]');
  const laps = $('.laps');
  let elapsed = 0;
  let startedAt = 0;
  let tick = 0;
  let lapCount = 0;
  const current = () => elapsed + (tick ? performance.now() - startedAt : 0);
  const show = () => {
    display.textContent = formatStopwatch(current());
  };

  el.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]')?.dataset.tab;
    if (tab) {
      for (const t of el.querySelectorAll('.tab')) t.classList.toggle('on', t.dataset.tab === tab);
      $('.pane-hora').hidden = tab !== 'hora';
      $('.pane-crono').hidden = tab !== 'crono';
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'start') {
      if (tick) {
        elapsed = current();
        clearInterval(tick);
        tick = 0;
        startBtn.textContent = 'Seguir';
      } else {
        startedAt = performance.now();
        tick = setInterval(show, 40);
        startBtn.textContent = 'Pausa';
      }
      startBtn.classList.toggle('running', Boolean(tick));
      show();
    } else if (act === 'lap' && current() > 0) {
      const li = document.createElement('li');
      li.textContent = `Vuelta ${++lapCount} · ${formatStopwatch(current())}`;
      laps.prepend(li);
      while (laps.children.length > 3) laps.lastChild.remove();
    } else if (act === 'reset') {
      clearInterval(tick);
      tick = 0;
      elapsed = 0;
      lapCount = 0;
      laps.innerHTML = '';
      startBtn.textContent = 'Iniciar';
      startBtn.classList.remove('running');
      show();
    }
  });

  return {
    el,
    dispose() {
      clearInterval(clockTimer);
      clearInterval(tick);
    },
  };
}
