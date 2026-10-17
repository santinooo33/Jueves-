// apps/index.js — Registro de mini-apps: nombre, ícono, tamaño y cómo se crean.
// Cada `create()` devuelve { el, dispose? }: el elemento que va dentro de la ventana y,
// si hace falta, una función que libera temporizadores al cerrarla.

import { createReloj } from './reloj.js';
import { createNotas } from './notas.js';
import { createCalculadora } from './calculadora.js';
import { createGestos } from './gestos.js';

const icon = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const APPS = [
  {
    id: 'reloj',
    name: 'Reloj',
    icon: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
    size: { w: 380, h: 250 },
    min: { w: 280, h: 200 },
    place: 'left',
    create: createReloj,
  },
  {
    id: 'notas',
    name: 'Notas',
    icon: icon('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>'),
    size: { w: 540, h: 290 },
    min: { w: 400, h: 250 },
    place: 'center',
    create: createNotas,
  },
  {
    id: 'calculadora',
    name: 'Calculadora',
    icon: icon(
      '<rect x="5" y="3" width="14" height="18" rx="2"/><rect x="8" y="6" width="8" height="3.5" rx=".6"/>' +
        '<path d="M8.6 13h.01M12 13h.01M15.4 13h.01M8.6 16.6h.01M12 16.6h.01M15.4 16.6h.01" stroke-width="2.4"/>',
    ),
    size: { w: 360, h: 290 },
    min: { w: 270, h: 240 },
    place: 'right',
    create: createCalculadora,
  },
  {
    id: 'gestos',
    name: 'Gestos',
    icon: icon('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.4"/><path d="M12 17h.01" stroke-width="2.4"/>'),
    size: { w: 470, h: 290 },
    min: { w: 340, h: 220 },
    place: 'center',
    create: createGestos,
  },
];
