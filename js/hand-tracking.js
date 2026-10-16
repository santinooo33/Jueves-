// hand-tracking.js — Cámara frontal + MediaPipe Hand Landmarker.
//
// Todo el procesamiento ocurre en este dispositivo: los frames de la cámara se pasan
// al modelo (WebAssembly/WebGL) dentro del navegador y nunca se envían a ningún servidor.
// Por red solo se descargan la librería y el modelo (una vez; luego quedan en caché).
//
// Salida por frame (coordenadas YA en espejo, igual que lo que ve el usuario):
//   { hands: [{ id, handedness, score, landmarks, world }], timestamp, inferenceMs,
//     videoWidth, videoHeight }
//   - landmarks: 21 puntos normalizados 0..1 respecto al video (x en espejo).
//   - world: 21 puntos en metros, centrados en la mano (independientes de la distancia).
//   - id: identificador estable de la mano mientras siga a la vista.

const MP_VERSION = '0.10.35';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// MediaPipe asume que la imagen de entrada ya viene en espejo para decidir si la mano es
// izquierda o derecha. Le pasamos el video sin espejo, así que invertimos la etiqueta.
const SWAP_HANDEDNESS = true;

// Tiempo que se recuerda una mano perdida para reasignarle el mismo id si reaparece cerca.
const TRACK_MEMORY_MS = 300;
// Distancia máxima (fracción del alto del video) para considerar que es la misma mano.
const TRACK_MATCH_DIST = 0.25;

export class HandTracker {
  constructor(video, { numHands = 2, width = 640, height = 480, forceCpu = false } = {}) {
    this.video = video;
    this.forceCpu = forceCpu;
    this.numHands = numHands;
    this.width = width;
    this.height = height;
    this.landmarker = null;
    this.delegate = null;
    this.stream = null;
    this.lastVideoTime = -1;
    this.lastTimestamp = 0;
    this.tracks = [];
    this.nextId = 1;
    this.error = null;
  }

  #create = null;

  /** Descarga MediaPipe y el modelo. onStatus(texto) informa el progreso. */
  async init(onStatus = () => {}) {
    if (this.landmarker) return;
    this.error = null;
    onStatus('Cargando MediaPipe…');
    const vision = await import(/* @vite-ignore */ `${MP_BASE}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const model = await fetchWithProgress(MODEL_URL, (p) =>
      onStatus(`Descargando modelo de manos… ${Math.round(p * 100)}%`),
    );

    const create = (delegate) =>
      vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: model, delegate },
        runningMode: 'VIDEO',
        numHands: this.numHands,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    this.#create = create;

    onStatus('Preparando detector…');
    if (!this.forceCpu) {
      try {
        this.landmarker = await create('GPU');
        this.delegate = 'GPU';
        return;
      } catch (err) {
        console.warn('[Jueves] GPU no disponible, usando CPU:', err);
      }
    }
    this.landmarker = await create('CPU');
    this.delegate = 'CPU';
  }

  /** Abre la cámara frontal a baja resolución (suficiente para el modelo y más rápido). */
  async startCamera() {
    if (!window.isSecureContext) {
      throw Object.assign(new Error('insecure'), { name: 'InsecureContextError' });
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
    }
    if (this.stream?.active) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: this.width },
        height: { ideal: this.height },
        frameRate: { ideal: 30, max: 60 },
      },
    });
    const v = this.video;
    v.srcObject = this.stream;
    v.muted = true;
    v.playsInline = true;
    await v.play();
    if (!v.videoWidth) {
      await new Promise((resolve) => v.addEventListener('loadeddata', resolve, { once: true }));
    }
  }

  get resolution() {
    return `${this.video.videoWidth}×${this.video.videoHeight}`;
  }

  /**
   * Procesa el frame actual del video si es nuevo. Devuelve null si no hay frame nuevo
   * (así el bucle puede correr a la tasa de la pantalla sin repetir inferencias).
   */
  detect(now) {
    const v = this.video;
    if (!this.landmarker || v.readyState < 2 || v.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = v.currentTime;

    // MediaPipe exige marcas de tiempo estrictamente crecientes.
    const timestamp = Math.max(now, this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;

    const t0 = performance.now();
    let result;
    try {
      result = this.landmarker.detectForVideo(v, timestamp);
    } catch (err) {
      if (this.delegate !== 'GPU') throw err;
      this.#fallbackToCpu(err);
      return null;
    }
    const inferenceMs = performance.now() - t0;

    return {
      hands: this.#assignIds(this.#readHands(result), timestamp, v.videoWidth / v.videoHeight),
      timestamp,
      inferenceMs,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
    };
  }

  // Algunos móviles crean el detector en GPU pero fallan al ejecutarlo: se reintenta en CPU.
  async #fallbackToCpu(err) {
    console.warn('[Jueves] Falló la inferencia en GPU, cambiando a CPU:', err);
    const old = this.landmarker;
    this.landmarker = null; // detect() devuelve null mientras tanto
    this.delegate = 'CPU';
    old?.close();
    try {
      this.landmarker = await this.#create('CPU');
    } catch (e) {
      this.error = e;
    }
  }

  #readHands(result) {
    const hands = [];
    const labels = result.handedness ?? result.handednesses ?? [];
    for (let i = 0; i < result.landmarks.length; i++) {
      const cat = labels[i]?.[0];
      let handedness = cat?.categoryName ?? '?';
      if (SWAP_HANDEDNESS) handedness = handedness === 'Left' ? 'Right' : handedness === 'Right' ? 'Left' : handedness;
      hands.push({
        handedness,
        score: cat?.score ?? 0,
        landmarks: result.landmarks[i].map((p) => ({ x: 1 - p.x, y: p.y, z: p.z })),
        world: (result.worldLandmarks?.[i] ?? []).map((p) => ({ x: -p.x, y: p.y, z: p.z })),
      });
    }
    return hands;
  }

  // MediaPipe no garantiza el orden de las manos entre frames. Se asocian por cercanía
  // a las del frame anterior para que cada mano conserve su id (y su suavizado).
  #assignIds(hands, now, aspect) {
    this.tracks = this.tracks.filter((t) => now - t.seen <= TRACK_MEMORY_MS);
    const centers = hands.map((h) => palmAnchor(h.landmarks, aspect));
    const pairs = [];
    centers.forEach((c, hi) =>
      this.tracks.forEach((t, ti) => pairs.push({ hi, ti, d: Math.hypot(c.x - t.x, c.y - t.y) })),
    );
    pairs.sort((a, b) => a.d - b.d);

    const usedHands = new Set();
    const usedTracks = new Set();
    for (const { hi, ti, d } of pairs) {
      if (d > TRACK_MATCH_DIST || usedHands.has(hi) || usedTracks.has(ti)) continue;
      usedHands.add(hi);
      usedTracks.add(ti);
      hands[hi].id = this.tracks[ti].id;
    }
    hands.forEach((h, hi) => {
      if (!usedHands.has(hi)) {
        h.id = this.nextId++;
        this.tracks.push({ id: h.id, x: 0, y: 0, seen: now });
      }
      const t = this.tracks.find((tr) => tr.id === h.id);
      Object.assign(t, centers[hi], { seen: now });
    });
    return hands.sort((a, b) => a.id - b.id);
  }
}

// Punto de referencia de la mano (muñeca + nudillo del medio), con x corregida por aspecto.
function palmAnchor(lm, aspect) {
  return { x: ((lm[0].x + lm[9].x) / 2) * aspect, y: (lm[0].y + lm[9].y) / 2 };
}

/**
 * Convierte coordenadas normalizadas del video (ya en espejo) a píxeles CSS de la
 * pantalla, teniendo en cuenta que el video se muestra con object-fit: cover.
 */
export function createProjector(videoW, videoH, viewW, viewH) {
  const scale = Math.max(viewW / videoW, viewH / videoH);
  const w = videoW * scale;
  const h = videoH * scale;
  const ox = (viewW - w) / 2;
  const oy = (viewH - h) / 2;
  const project = (x, y) => ({ x: ox + x * w, y: oy + y * h });
  project.scale = scale;
  return project;
}

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar el modelo`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(received / total, 1));
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
