// apps/prueba.js — Ventana de prueba de la fase 2: un contador para practicar el pellizco
// sobre botones y un recordatorio de los gestos.

export function createTestApp() {
  const el = document.createElement('div');
  el.className = 'app-prueba';
  el.innerHTML = `
    <div class="counter">
      <button type="button" class="key" data-pinch data-step="-1" aria-label="Restar">−</button>
      <output>0</output>
      <button type="button" class="key" data-pinch data-step="1" aria-label="Sumar">+</button>
      <button type="button" class="key small" data-pinch data-step="0">Reiniciar</button>
    </div>
    <ul class="tips">
      <li><b>Pellizca</b> la barra o el borde y arrastra para mover</li>
      <li><b>Pellizca</b> un botón para pulsarlo</li>
      <li><b>L quieta ½ s</b>: modo tamaño (abre o junta los dedos)</li>
      <li><b>Dos manos</b> pellizcando: separa para hacer zoom</li>
      <li><b>Puño</b> sobre la ventana: cerrar</li>
      <li><b>Meñique arriba 1 s</b>: dormir</li>
    </ul>`;
  const out = el.querySelector('output');
  let count = 0;
  for (const btn of el.querySelectorAll('[data-step]')) {
    btn.addEventListener('click', () => {
      const step = Number(btn.dataset.step);
      count = step === 0 ? 0 : count + step;
      out.textContent = String(count);
    });
  }
  return el;
}
