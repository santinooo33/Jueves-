// main.js — Arranque de Jueves: une cámara, gestos y retroalimentación visual.

import { HandTracker, createProjector } from './hand-tracking.js';
import { GestureEngine, CONFIG } from './gestures.js';
import { UIFeedback } from './ui-feedback.js';

const $ = (id) => document.getElementById(id);

const video = $('camera');
const startScreen = $('start');
const startBtn = $('start-btn');
const startMsg = $('start-msg');

const params = new URLSearchParams(location.search);
const ui = new UIFeedback();
// ?cpu fuerza el modo CPU por si la GPU del teléfono da problemas.
const tracker = new HandTracker(video, { forceCpu: params.has('cpu') });
const engine = new GestureEngine(CONFIG);

let running = false;
let wakeLock = null;

// Acceso desde la consola para ajustar umbrales en vivo, p. ej. jueves.CONFIG.PINCH_GRAB_RATIO = 0.25
window.jueves = { CONFIG, engine, tracker, ui };

ui.setDebug(params.has('debug'));
// iPhone no tiene API de pantalla completa: ahí se usa "Agregar a inicio".
$('fullscreen-btn').hidden = !document.documentElement.requestFullscreen;

startBtn.addEventListener('click', start);
$('debug-btn').addEventListener('click', () => ui.toggleDebug());
$('fullscreen-btn').addEventListener('click', toggleFullscreen);
window.addEventListener('keydown', (e) => {
  if (e.key === 'd' || e.key === 'D') ui.toggleDebug();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && running) requestWakeLock();
});

async function start() {
  startBtn.disabled = true;
  // Pantalla completa y bloqueo horizontal deben pedirse dentro del toque del usuario.
  enterFullscreen();
  setStartMessage('Abriendo cámara…');
  try {
    await Promise.all([tracker.startCamera(), tracker.init(setStartMessage)]);
  } catch (err) {
    console.error(err);
    setStartMessage(describeError(err), true);
    startBtn.disabled = false;
    return;
  }
  requestWakeLock();
  startScreen.classList.add('hidden');
  document.body.classList.add('is-running');
  startBtn.disabled = false;
  if (!running) requestAnimationFrame(loop);
  running = true;
}

function loop(now) {
  let frame;
  try {
    if (tracker.error) throw tracker.error;
    frame = tracker.detect(now);
  } catch (err) {
    console.error(err);
    running = false;
    showFatal(describeError(err));
    return;
  }
  requestAnimationFrame(loop);
  ui.countRenderFrame(now);
  if (!frame) return;
  ui.countCameraFrame(frame.inferenceMs);

  const view = ui.viewport;
  const project = createProjector(frame.videoWidth, frame.videoHeight, view.width, view.height);
  for (const hand of frame.hands) hand.screen = hand.landmarks.map((p) => project(p.x, p.y));

  const state = engine.update(frame, view);
  ui.render(frame, state, project, tracker);
}

function setStartMessage(text, isError = false) {
  startMsg.textContent = text;
  startMsg.classList.toggle('error', isError);
}

function showFatal(text) {
  startScreen.classList.remove('hidden');
  setStartMessage(text, true);
}

function describeError(err) {
  switch (err?.name) {
    case 'InsecureContextError':
      return 'La cámara solo funciona con HTTPS (o en localhost). Abre la página con https://';
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Permiso de cámara denegado. Actívalo en los ajustes del navegador y vuelve a intentar.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No se encontró una cámara frontal.';
    case 'NotReadableError':
      return 'La cámara está ocupada por otra app. Ciérrala y vuelve a intentar.';
    case 'NotSupportedError':
      return 'Este navegador no permite usar la cámara. Prueba con Chrome o Safari actualizados.';
    default:
      return `No se pudo iniciar: ${err?.message ?? err}. ¿Hay conexión para descargar el modelo?`;
  }
}

function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch(() => {});
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else enterFullscreen();
}

// Evita que la pantalla se apague: con gestos no se toca el teléfono.
async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    wakeLock = null;
  }
}
