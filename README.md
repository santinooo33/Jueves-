# Jueves

Escritorio virtual holográfico que se controla con gestos de las manos usando la cámara
frontal del celular. Corre en el navegador, sin frameworks. Usa
[MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
(21 puntos por mano, hasta 2 manos).

**👉 Pruébalo en el celular: https://santinooo33.github.io/Jueves-/** (en horizontal).

> 🔒 **Privacidad:** el video se procesa solo en el dispositivo. Por red solo se descargan
> la librería de MediaPipe y el modelo (una vez); ningún frame sale del navegador.

## Estado: Fase 3

- **Fase 1:** cámara de fondo en espejo, esqueleto de la mano, cursor suavizado (One Euro)
  pegado a la punta del índice, activar con **palma abierta y quieta 2 s**, dormir con el
  **meñique arriba 1 s**, indicador de estado y modo debug.
- **Fase 2:** un cursor por mano, pellizco con histéresis (clic y agarrar), ventanas que se
  mueven, cambian de tamaño (L quieta o dos manos) y se cierran con el puño, y bordes que se
  iluminan al acercar el dedo.
- **Fase 3:** escritorio con barra de apps (abrir, traer al frente, minimizar y restaurar),
  botón minimizar en cada ventana y las mini-apps **Reloj** (hora y cronómetro), **Notas**
  (teclado en pantalla con ñ y tildes; el texto se guarda en el teléfono), **Calculadora** y
  **Gestos** (ayuda, se abre la primera vez).

## Probarlo

La cámara del navegador exige **HTTPS** (o `localhost`).

### Opción A: desde el computador, en la misma Wi-Fi que el celular

```bash
npm install
npm run dev
```

Vite muestra dos direcciones. En el celular abre la de **Network**, p. ej.
`https://192.168.1.50:5173`. El certificado es autofirmado, así que el navegador avisa:
- **Android / Chrome:** «Configuración avanzada» → «Acceder a 192.168.… (no seguro)».
- **iPhone / Safari:** «Mostrar detalles» → «visitar este sitio web».

Al guardar un archivo, la página se recarga sola en el celular.

### Opción B: sin computador (GitHub Pages)

Ya está publicado en **https://santinooo33.github.io/Jueves-/**. GitHub Pages sirve la rama
`gh-pages` tal cual (no hace falta compilar), así que para actualizar la página:

```bash
git push origin main:gh-pages
```

### Opción C: túnel HTTPS (si la Wi-Fi bloquea conexiones entre dispositivos)

Con `npm run dev` corriendo y [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) instalado:

```bash
cloudflared tunnel --url https://localhost:5173 --no-tls-verify
```

Abre en el celular la URL `https://….trycloudflare.com` que imprime.

## Cómo usarlo

1. Pon el celular **en horizontal**, apoyado, a 40–60 cm, con buena luz.
2. Toca **Iniciar** y acepta el permiso de cámara.
3. Muestra la **palma abierta y quieta**: aparece un anillo que se llena en 2 s → **Activo**.
4. Mueve el **índice**: el cursor está sobre la punta del dedo.
5. Gestos sobre las ventanas:
   - **Pellizco:** junta las puntas del pulgar y el índice (con los otros dedos abiertos o
     doblados, como prefieras). El centro del cursor se va llenando a medida que juntas los
     dedos; lleno = pellizco. Para soltar, abre los dedos o cierra el puño.
   - **Mover:** pellizca la barra de título o el borde y arrastra. El borde se ilumina al
     acercar el dedo y la ventana sigue el punto medio entre pulgar e índice.
   - **Pulsar un botón:** apunta y pellizca; el clic ocurre al cerrar la pinza (soltar o mover
     la mano después ya no lo cancela). El botón se ilumina al acercarte (el cursor se "pega" a
     los botones a menos de 20 px) y al empezar a juntar los dedos queda fijo: se pulsa el que
     estaba iluminado aunque la punta del índice baje al cerrar la pinza.
   - **Cambiar tamaño:** forma una **L** (pulgar e índice abiertos) sobre la ventana y déjala
     quieta ½ s. La ventana brilla en ámbar: abre los dedos para agrandar, júntalos para achicar.
     Sales bajando la mano o cerrando el puño.
   - **Zoom con dos manos:** pellizca la ventana con una mano y luego con la otra; sepáralas
     o júntalas.
   - **Cerrar:** puño sobre la ventana (el borde se pone rojo y se cierra en 0,6 s).
   - **Minimizar:** botón **–** de la barra de título; la ventana se encoge hacia su ícono.
6. **Barra de apps** (abajo): pellizca un ícono para abrir la app. Si ya está abierta y al
   frente, la minimiza; si está minimizada o detrás de otra, la trae al frente. Un punto bajo
   el ícono indica que está abierta.
7. Para dormir: **levanta el meñique** (los demás dedos doblados) y mantenlo quieto **1 s** →
   **Dormido**. Con el sistema activo, la palma abierta ya no lo duerme.

### Modo debug

Botón **DEBUG** (o tecla **D**, o abrir con `?debug` en la URL). Muestra:
- FPS de la cámara, tiempo de inferencia, GPU/CPU y resolución.
- Por mano: flexión de cada dedo en grados (verde = extendido, ámbar = intermedio, rojo =
  doblado), separación del pulgar, pellizco (razón suavizada y cm), alcance del índice (qué tan
  lejos de la palma está su punta), movimiento y tiempo sostenido.
- La pose detectada y qué hace cada cursor (pinza, moviendo, tamaño, zoom…).

Si la GPU da problemas, `?cpu` fuerza el modo CPU.

### Ajustar umbrales

Todos los umbrales están en `CONFIG`, al inicio de [`js/gestures.js`](js/gestures.js). También
se pueden probar en vivo desde la consola del navegador:

```js
jueves.CONFIG.FINGER_EXTENDED_MAX_BEND = 120;
```

## Estructura

```
index.html             página y capas (cámara, HUD, interfaz)
css/jueves.css         estética holográfica
js/main.js             arranque y bucle principal
js/hand-tracking.js    cámara + MediaPipe → landmarks por frame (en espejo, con id estable por mano)
js/gestures.js         umbrales (CONFIG), forma de la mano, activación, cursores y pellizco
js/interaction.js      gestos → acciones: mover, pulsar, modo tamaño, zoom, cerrar
js/desktop.js          ventanas (abrir apps, enfocar, mover, redimensionar, minimizar, cerrar,
                       brillo del borde) y barra de apps
js/apps/index.js       registro de apps: nombre, ícono, tamaño
js/apps/reloj.js       reloj analógico y digital + cronómetro
js/apps/notas.js       notas con teclado en pantalla
js/apps/calculadora.js calculadora (sin eval; × y ÷ antes que + y −)
js/apps/gestos.js      ayuda con los gestos
js/one-euro-filter.js  suavizado del cursor
js/ui-feedback.js      esqueleto, cursores, anillos, guías, efectos, estado y panel debug
tests/                 pruebas con manos sintéticas (npm test)
```

Próximas fases: retroceder, ir al inicio, apps recientes y cambio de app por inclinación;
después pulido visual, sonidos y rendimiento.

## Pruebas

```bash
npm test
```
