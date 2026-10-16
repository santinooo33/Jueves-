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
    states.push(engine.update(frameOf(handFn(t, i), t), VIEW));
  }
  return { states, end: t0 + (n * 1000) / FPS, events: states.flatMap((s) => s.events) };
}

test('clasifica las poses básicas', () => {
  const expected = { palm: 'palma', fist: 'puno', thumbsUp: 'pulgar', L: 'L', point: 'senalar', pinch: 'pellizco' };
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

test('palma quieta 2 s activa, y no vuelve a alternar sin soltarla', () => {
  const engine = new GestureEngine(CONFIG);
  const palm = () => [makeHand(POSES.palm)];

  const early = runFrames(engine, 1.8, palm);
  assert.equal(engine.active, false);
  assert.equal(early.events.length, 0);
  assert.ok(early.states.at(-1).activation.progress > 0.8, 'muestra el progreso');

  const rest = runFrames(engine, 4, palm, early.end);
  assert.deepEqual(rest.events.map((e) => e.type), ['activate']);
  assert.equal(engine.active, true);

  // Cerrar la mano rearma el gesto; otra palma quieta 2 s desactiva.
  const fist = runFrames(engine, 0.5, () => [makeHand(POSES.fist)], rest.end);
  const again = runFrames(engine, 2.3, palm, fist.end);
  assert.deepEqual(again.events.map((e) => e.type), ['deactivate']);
  assert.equal(engine.active, false);
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

test('dormido no hay cursor; activo, el índice lo mueve dentro de la zona configurada', () => {
  const engine = new GestureEngine(CONFIG);
  const sleeping = engine.update(frameOf([makeHand(POSES.point)], 0), VIEW);
  assert.equal(sleeping.cursor.visible, false);

  const act = runFrames(engine, 2.3, () => [makeHand(POSES.palm)]);
  assert.equal(engine.active, true);

  // Coloca la punta del índice en el centro de CURSOR_BOX.
  const { left, right, top, bottom } = CONFIG.CURSOR_BOX;
  const probe = makeHand(POSES.point);
  const tip = probe.landmarks[LM.INDEX_TIP];
  const target = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const shifted = () => {
    const h = makeHand(POSES.point);
    for (const p of h.landmarks) {
      p.x += target.x - tip.x;
      p.y += target.y - tip.y;
    }
    return [h];
  };
  const run = runFrames(engine, 1, shifted, act.end);
  const { cursor } = run.states.at(-1);
  assert.equal(cursor.visible, true);
  assert.ok(Math.abs(cursor.x - VIEW.width / 2) < 3, `x=${cursor.x}`);
  assert.ok(Math.abs(cursor.y - VIEW.height / 2) < 3, `y=${cursor.y}`);
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
