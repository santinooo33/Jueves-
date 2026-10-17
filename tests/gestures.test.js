import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeHand, GestureEngine, CONFIG, LM } from '../js/gestures.js';
import { OneEuroFilter } from '../js/one-euro-filter.js';
import { makeHand, POSES, frameOf } from './synthetic-hand.js';

const VIEW = { width: 900, height: 400 };
const FPS = 30;

function runFrames(engine, seconds, handFn, t0 = 0) {
  const states = [];
  const n = Math.round(seconds * FPS);
  for (let i = 0; i < n; i++) {
    const t = t0 + (i * 1000) / FPS;
    states.push(engine.update(frameOf(handFn(t, i), t, VIEW), VIEW));
  }
  return { states, end: t0 + (n * 1000) / FPS, events: states.flatMap((s) => s.events) };
}

test('clasifica las poses básicas', () => {
  const expected = {
    palm: 'palma',
    fist: 'puno',
    thumbsUp: 'pulgar',
    L: 'L',
    point: 'senalar',
    pinch: 'pellizco',
    grabPinch: 'pellizco',
    pinky: 'menique',
  };
  for (const [pose, label] of Object.entries(expected)) {
    const f = analyzeHand(makeHand(POSES[pose]), 4 / 3);
    assert.equal(f.pose, label, `${pose}: ${JSON.stringify(f.fingers)}`);
  }
});

test('distingue puño de "4 dedos doblados + pulgar" por el pulgar', () => {
  const fist = analyzeHand(makeHand(POSES.fist), 4 / 3);
  const thumb = analyzeHand(makeHand(POSES.thumbsUp), 4 / 3);
  assert.equal(fist.thumbExtended, false);
  assert.equal(thumb.thumbExtended, true);
  for (const name of ['index', 'middle', 'ring', 'pinky']) {
    assert.equal(fist.fingers[name].state, 'curled');
    assert.equal(thumb.fingers[name].state, 'curled');
  }
});

test('la forma no depende de la distancia a la cámara', () => {
  const near = analyzeHand(makeHand({ ...POSES.palm, scale: 0.04 }), 4 / 3);
  const far = analyzeHand(makeHand({ ...POSES.palm, scale: 0.012 }), 4 / 3);
  assert.equal(near.pose, 'palma');
  assert.equal(far.pose, 'palma');
  assert.ok(Math.abs(near.pinchRatio - far.pinchRatio) < 1e-9);
});

test('palma quieta 2 s activa; seguir con la palma no duerme; meñique arriba 1 s duerme', () => {
  const engine = new GestureEngine(CONFIG);
  const palm = () => [makeHand(POSES.palm)];

  const early = runFrames(engine, 1.8, palm);
  assert.equal(engine.active, false);
  assert.equal(early.events.length, 0);
  assert.ok(early.states.at(-1).activation.progress > 0.8, 'muestra el progreso');

  // Con el sistema activo, la palma (aunque siga quieta) ya no lo duerme.
  const rest = runFrames(engine, 5, palm, early.end);
  assert.deepEqual(rest.events.map((e) => e.type), ['activate']);
  assert.equal(engine.active, true);

  const pinky = runFrames(engine, 0.8, () => [makeHand(POSES.pinky)], rest.end);
  assert.equal(engine.active, true, 'aún no pasa 1 s');
  assert.equal(pinky.states.at(-1).activation.activating, false, 'el anillo es de dormir');
  const more = runFrames(engine, 0.4, () => [makeHand(POSES.pinky)], pinky.end);
  assert.deepEqual(more.events.map((e) => e.type), ['deactivate']);
  assert.equal(engine.active, false);

  // Dormido, el meñique no hace nada; para activar de nuevo hace falta la palma.
  const again = runFrames(engine, 2, () => [makeHand(POSES.pinky)], more.end);
  assert.deepEqual(again.events, []);
  const wake = runFrames(engine, 2.3, palm, again.end);
  assert.deepEqual(wake.events.map((e) => e.type), ['activate']);
});

test('mover la palma reinicia la cuenta', () => {
  const engine = new GestureEngine(CONFIG);
  // Se desplaza ~1 palma por segundo: nunca queda quieta.
  const moving = (t) => [makeHand({ ...POSES.palm, at: { x: 0.3 + ((t / 1000) % 2) * 0.12, y: 0.75 } })];
  const run = runFrames(engine, 4, moving);
  assert.equal(run.events.length, 0);
  assert.equal(engine.active, false);
});

test('tolera que el detector pierda la mano un instante', () => {
  const engine = new GestureEngine(CONFIG);
  // Pierde la mano 3 frames (100 ms) a mitad del gesto.
  const run = runFrames(engine, 2.3, (t, i) => (i >= 30 && i < 33 ? [] : [makeHand(POSES.palm)]));
  assert.deepEqual(run.events.map((e) => e.type), ['activate']);
});

function activeEngine() {
  const engine = new GestureEngine(CONFIG);
  const run = runFrames(engine, 2.3, () => [makeHand(POSES.palm)]);
  assert.equal(engine.active, true);
  return { engine, t: run.end + 1000 }; // pausa para que la palma "suelte"
}

const pinchesOf = (run) => run.events.filter((e) => e.type.startsWith('pinch')).map((e) => e.type);

test('dormido no hay cursor; activo, el cursor queda sobre la punta del índice', () => {
  const engine = new GestureEngine(CONFIG);
  const sleeping = engine.update(frameOf([makeHand(POSES.point)], 0, VIEW), VIEW);
  assert.equal(sleeping.pointers.length, 0);

  const { engine: e2, t } = activeEngine();
  const run = runFrames(e2, 1, () => [makeHand({ ...POSES.point, at: { x: 0.4, y: 0.8 } })], t);
  const last = run.states.at(-1);
  const tip = last.hands[0].screen[LM.INDEX_TIP];
  assert.equal(last.pointers.length, 1);
  assert.ok(Math.hypot(last.pointers[0].x - tip.x, last.pointers[0].y - tip.y) < 1, 'cursor sobre la punta');
});

test('un cursor por mano', () => {
  const { engine, t } = activeEngine();
  const two = () => [makeHand({ ...POSES.point, id: 1, at: { x: 0.3, y: 0.8 } }), makeHand({ ...POSES.point, id: 2, at: { x: 0.7, y: 0.8 } })];
  const run = runFrames(engine, 0.5, two, t);
  assert.equal(run.states.at(-1).pointers.length, 2);
});

test('pellizco con histéresis: agarra cerrado, sigue agarrado a medio abrir, suelta abierto', () => {
  const { engine, t } = activeEngine();
  const ratio = (k) => analyzeHand(makeHand({ ...POSES.point, pinch: k }), 4 / 3).pinchRatio;
  // Una apertura intermedia: entre el umbral de agarrar y el de soltar.
  let mid = 0;
  for (let k = 1; k >= 0; k -= 0.01) {
    const r = ratio(k);
    if (r > CONFIG.PINCH_GRAB_RATIO + 0.03 && r < CONFIG.PINCH_RELEASE_RATIO - 0.03) {
      mid = k;
      break;
    }
  }
  assert.ok(mid > 0, 'hay una apertura intermedia');

  const closed = runFrames(engine, 0.3, () => [makeHand({ ...POSES.point, pinch: 1 })], t);
  assert.deepEqual(pinchesOf(closed), ['pinchstart']);
  const half = runFrames(engine, 0.5, () => [makeHand({ ...POSES.point, pinch: mid })], closed.end);
  assert.deepEqual(pinchesOf(half), [], 'a medio abrir sigue agarrado');
  assert.equal(half.states.at(-1).pointers[0].pinching, true);
  const open = runFrames(engine, 0.3, () => [makeHand({ ...POSES.point, pinch: 0 })], half.end);
  assert.deepEqual(pinchesOf(open), ['pinchend']);
});

test('un solo frame con los dedos juntos no es un pellizco', () => {
  const { engine, t } = activeEngine();
  const run = runFrames(engine, 1, (time, i) => [makeHand({ ...POSES.point, pinch: i === 10 ? 1 : 0 })], t);
  assert.deepEqual(pinchesOf(run), []);
});

test('pellizco con los demás dedos doblados (para agarrar) sí cuenta', () => {
  const { engine, t } = activeEngine();
  const run = runFrames(engine, 0.4, () => [makeHand(POSES.grabPinch)], t);
  assert.deepEqual(pinchesOf(run), ['pinchstart']);
});

test('un frame ruidoso con los dedos abiertos no suelta el pellizco', () => {
  const { engine, t } = activeEngine();
  const run = runFrames(engine, 1.2, (time, i) => [makeHand({ ...POSES.pinch, pinch: i === 15 ? 0 : 1 })], t);
  assert.deepEqual(pinchesOf(run), ['pinchstart']);
});

test('si el detector pierde la mano 250 ms mientras arrastra, no suelta', () => {
  const { engine, t } = activeEngine();
  const run = runFrames(engine, 1.2, (time, i) => (i >= 12 && i < 19 ? [] : [makeHand(POSES.pinch)]), t);
  assert.deepEqual(pinchesOf(run), ['pinchstart']);
  const lost = runFrames(engine, 0.6, () => [], run.end);
  assert.deepEqual(lost.events.map((e) => [e.type, e.lost]), [['pinchend', true]], 'perderla del todo sí suelta');
});

test('cerrar el puño suelta el pellizco', () => {
  const { engine, t } = activeEngine();
  const grab = runFrames(engine, 0.4, () => [makeHand(POSES.grabPinch)], t);
  const fist = runFrames(engine, 0.4, () => [makeHand(POSES.fist)], grab.end);
  assert.deepEqual([...pinchesOf(grab), ...pinchesOf(fist)], ['pinchstart', 'pinchend']);
});

test('el cursor se va llenando al juntar los dedos', () => {
  const { engine, t } = activeEngine();
  const open = runFrames(engine, 0.3, () => [makeHand({ ...POSES.point, pinch: 0 })], t).states.at(-1).pointers[0];
  const near = runFrames(engine, 0.3, () => [makeHand({ ...POSES.point, pinch: 0.75 })], t + 300).states.at(-1).pointers[0];
  assert.equal(open.pinchLevel, 0);
  assert.ok(near.pinchLevel > 0 && near.pinchLevel < 1, `nivel ${near.pinchLevel}`);
});

test('el puño no cuenta como pellizco', () => {
  const { engine, t } = activeEngine();
  const run = runFrames(engine, 1, () => [makeHand({ ...POSES.fist, pinch: 1 })], t);
  assert.deepEqual(pinchesOf(run), []);
});

test('el punto de agarre es donde apuntaba el índice antes de juntar los dedos', () => {
  const { engine, t } = activeEngine();
  const aim = runFrames(engine, 0.6, () => [makeHand(POSES.point)], t);
  const before = aim.states.at(-1).pointers[0];
  // Al pellizcar, la punta del índice se desplaza hacia el pulgar.
  const pinch = runFrames(engine, 0.3, () => [makeHand({ ...POSES.pinch })], aim.end);
  const start = pinch.events.find((e) => e.type === 'pinchstart');
  const tipNow = pinch.states.at(-1).hands[0].screen[LM.INDEX_TIP];
  assert.ok(Math.hypot(start.x - before.x, start.y - before.y) < 6, 'agarra donde apuntaba');
  assert.ok(Math.hypot(tipNow.x - before.x, tipNow.y - before.y) > 15, 'la punta sí se movió al pellizcar');
});

test('arrastrar: mientras pellizca, el cursor sigue a la mano', () => {
  const { engine, t } = activeEngine();
  const grab = runFrames(engine, 0.3, () => [makeHand({ ...POSES.pinch })], t);
  const p0 = grab.states.at(-1).pointers[0];
  const move = runFrames(engine, 1, () => [makeHand({ ...POSES.pinch, at: { x: 0.6, y: 0.75 } })], grab.end);
  const p1 = move.states.at(-1).pointers[0];
  assert.equal(p1.pinching, true);
  assert.ok(p1.x - p0.x > 60, `se movió ${p1.x - p0.x}px`);
});

test('pose estable y tiempo quieto: la L cuenta tiempo y un parpadeo no la cambia', () => {
  const { engine, t } = activeEngine();
  const run = runFrames(engine, 0.8, (time, i) => [makeHand(i === 12 ? POSES.palm : POSES.L)], t);
  const p = run.states.at(-1).pointers[0];
  assert.equal(p.pose, 'L');
  assert.ok(p.holdMs > 600, `holdMs=${p.holdMs}`);
});

test('el filtro One Euro reduce el temblor', () => {
  const filter = new OneEuroFilter({ minCutoff: CONFIG.CURSOR_MIN_CUTOFF, beta: CONFIG.CURSOR_BETA });
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 12; // ±6 px
  let rawVar = 0;
  let outVar = 0;
  for (let i = 0; i < 300; i++) {
    const n = noise();
    const [x] = filter.filter([400 + n], (i * 1000) / FPS);
    if (i > 30) {
      rawVar += n * n;
      outVar += (x - 400) ** 2;
    }
  }
  assert.ok(outVar < rawVar * 0.25, `varianza filtrada ${outVar.toFixed(0)} vs ${rawVar.toFixed(0)}`);
});
