// Mano sintética para pruebas: genera los 21 landmarks de MediaPipe a partir de una pose.
// Coordenadas de la mano en cm: x lateral (hacia el pulgar), y desde la muñeca hacia los
// dedos, z hacia el frente de la palma (hacia donde se doblan los dedos).

const FINGER_BASES = {
  index: { mcp: [2.5, 8.5], segments: [4, 2.5, 2] },
  middle: { mcp: [0.5, 9], segments: [4.5, 3, 2.2] },
  ring: { mcp: [-1.5, 8.5], segments: [4.2, 2.8, 2] },
  pinky: { mcp: [-3.5, 7.5], segments: [3.2, 2, 1.8] },
};
const FINGER_ORDER = ['index', 'middle', 'ring', 'pinky'];
const JOINT_FLEX = [80, 100, 60]; // grados en MCP, PIP y DIP cuando el dedo está doblado del todo

const THUMBS = {
  // Pulgar recto y separado (palma abierta, forma de L, pulgar arriba)
  open: [[1.8, 1.5, 0], [4.6, 4.3, 0], [6.7, 6.4, 0], [8.5, 8.2, 0]],
  side: [[1.8, 1.5, 0], [5.6, 2.6, 0], [8.5, 3.4, 0], [10.9, 4.1, 0]],
  up: [[1.8, 1.5, 0], [4.6, 4.3, 0.6], [6.7, 6.4, 1], [8.5, 8.2, 1.3]],
  // Pulgar doblado sobre los dedos (puño)
  folded: [[1.8, 1.5, 0], [3.5, 4.5, 1], [2.2, 7, 3], [0.4, 8, 3.6]],
};

function fingerPoints(name, curl) {
  const { mcp, segments } = FINGER_BASES[name];
  const base = [mcp[0], mcp[1], 0];
  const len = Math.hypot(base[0], base[1]);
  const dir0 = [base[0] / len, base[1] / len, 0];
  const pts = [base];
  let theta = 0;
  let p = base;
  segments.forEach((seg, i) => {
    theta += ((JOINT_FLEX[i] * curl) / 180) * Math.PI;
    const d = [dir0[0] * Math.cos(theta), dir0[1] * Math.cos(theta), Math.sin(theta)];
    p = [p[0] + d[0] * seg, p[1] + d[1] * seg, p[2] + d[2] * seg];
    pts.push(p);
  });
  return pts;
}

/**
 * @param {object} pose
 * @param {{index?:number, middle?:number, ring?:number, pinky?:number}} pose.curl 0 = recto, 1 = doblado
 * @param {'open'|'side'|'up'|'folded'} pose.thumb
 * @param {{x:number, y:number}} pose.at  posición de la muñeca en el encuadre (0..1)
 * @param {number} pose.scale  fracción del alto del encuadre que ocupa 1 cm
 */
export function makeHand({ curl = {}, thumb = 'open', at = { x: 0.5, y: 0.75 }, scale = 0.022, id = 1, pinch = false } = {}) {
  const cm = [[0, 0, 0], ...THUMBS[thumb]];
  for (const name of FINGER_ORDER) cm.push(...fingerPoints(name, curl[name] ?? 0));
  if (pinch) {
    const tip = cm[8];
    cm[4] = [tip[0] + 0.6, tip[1], tip[2] + 0.4];
  }
  const aspect = 4 / 3;
  return {
    id,
    handedness: 'Right',
    score: 0.99,
    landmarks: cm.map(([x, y, z]) => ({ x: at.x + (x * scale) / aspect, y: at.y - y * scale, z: -z * scale })),
    world: cm.map(([x, y, z]) => ({ x: x / 100, y: -y / 100, z: -z / 100 })),
  };
}

export const POSES = {
  palm: { curl: {}, thumb: 'open' },
  fist: { curl: { index: 1, middle: 1, ring: 1, pinky: 1 }, thumb: 'folded' },
  thumbsUp: { curl: { index: 1, middle: 1, ring: 1, pinky: 1 }, thumb: 'up' },
  L: { curl: { middle: 1, ring: 1, pinky: 1 }, thumb: 'side' },
  point: { curl: { middle: 1, ring: 1, pinky: 1 }, thumb: 'folded' },
  pinch: { curl: { index: 0.35, middle: 0.2, ring: 0.2, pinky: 0.2 }, thumb: 'open', pinch: true },
};

export function frameOf(hands, timestamp) {
  return { hands, timestamp, videoWidth: 640, videoHeight: 480 };
}
