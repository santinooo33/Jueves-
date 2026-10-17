// apps/gestos.js — Ayuda: recordatorio de los gestos de Jueves.

const GESTURES = [
  ['✋', 'Palma quieta 2 s', 'activar'],
  ['🤙', 'Meñique arriba 1 s', 'dormir'],
  ['🤏', 'Pellizco en un ícono', 'abrir o minimizar la app'],
  ['🤏', 'Pellizco en un botón', 'pulsarlo (al soltar)'],
  ['🤏', 'Pellizco en la barra', 'arrastra para mover'],
  ['L', 'L quieta ½ s', 'tamaño: abre o junta los dedos'],
  ['🙌', 'Pellizco con dos manos', 'zoom: sepáralas o júntalas'],
  ['✊', 'Puño sobre la ventana', 'cerrarla'],
  ['–', 'Botón – del título', 'minimizar'],
];

export function createGestos() {
  const el = document.createElement('div');
  el.className = 'gestos';
  el.innerHTML = `<ul>${GESTURES.map(
    ([icon, what, does]) => `<li><span class="g-icon">${icon}</span><span class="g-what">${what}</span><span class="g-does">${does}</span></li>`,
  ).join('')}</ul>`;
  return { el };
}
