# Jueves

Escritorio virtual holográfico que se controla con gestos de las manos usando la cámara
frontal del celular. Corre en el navegador, sin frameworks. Usa
[MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
(21 puntos por mano, hasta 2 manos).

**👉 Pruébalo en el celular: https://santinooo33.github.io/Jueves-/** (en horizontal).

> 🔒 **Privacidad:** el video se procesa solo en el dispositivo. Por red solo se descargan
> la librería de MediaPipe y el modelo (una vez); ningún frame sale del navegador.

## Estado: Fase 1

- Cámara frontal de fondo, en espejo, con tinte holográfico.
- Detección de manos y esqueleto (puntos y líneas).
- Cursor con la punta del índice, suavizado con filtro One Euro.
- Activar/desactivar: **palma abierta y quieta 2 s** (anillo de progreso alrededor de la palma).
- Indicador de estado (Dormido / Activo) y modo debug.

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

## Cómo usar la Fase 1

1. Pon el celular **en horizontal**, apoyado, a 40–60 cm, con buena luz.
2. Toca **Iniciar** y acepta el permiso de cámara.
3. Muestra la **palma abierta y quieta**: aparece un anillo que se llena en 2 s → **Activo**.
4. Mueve el **índice**: el cursor lo sigue. No hace falta mover todo el brazo, porque una zona
   central de la cámara se estira a toda la pantalla.
5. Otra vez **palma quieta 2 s** → **Dormido**. Para repetir el gesto hay que cerrar o bajar
   la mano antes.

### Modo debug

Botón **DEBUG** (o tecla **D**, o abrir con `?debug` en la URL). Muestra:
- FPS de la cámara, tiempo de inferencia, GPU/CPU y resolución.
- Por mano: flexión de cada dedo en grados (verde = extendido, ámbar = intermedio, rojo =
  doblado), separación del pulgar, pellizco (razón y cm), movimiento y tiempo sostenido.
- La pose detectada y la **zona del cursor** (rectángulo punteado).

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
js/gestures.js         umbrales (CONFIG), forma de la mano, activación y cursor
js/one-euro-filter.js  suavizado del cursor
js/ui-feedback.js      esqueleto, cursor, anillo, efectos, estado y panel debug
tests/                 pruebas con manos sintéticas (npm test)
```

Próximas fases: `desktop.js` (ventanas, barra de apps, recientes) y `apps/` (reloj, notas,
calculadora).

## Pruebas

```bash
npm test
```
