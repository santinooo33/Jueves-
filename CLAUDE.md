# Jueves — instrucciones para Claude

Escritorio virtual holográfico controlado con gestos de las manos (MediaPipe, sin frameworks).
Ver `README.md` para la estructura. Todo en español: interfaz, comentarios y respuestas.

## Cómo prueba el usuario (obligatorio en cada entrega)

El usuario prueba en su celular, sin computador, desde **GitHub Pages**:
**https://santinooo33.github.io/Jueves-/**

Pages publica la rama `gh-pages`. Cada vez que haya algo para probar:

1. `npm test` en verde.
2. Push a `main` y luego copiar `main` a `gh-pages`: `git push origin main:gh-pages`.
3. Confirmar en GitHub Actions que el run "pages build and deployment" de ese commit terminó
   en `success` antes de dar el link.
4. Entregar el link de arriba y una lista corta y numerada de qué probar y qué reportar
   (FPS y GPU/CPU del panel DEBUG, modelo de celular, capturas si algo falla).

No usar artefactos de claude.ai para probar Jueves: no tienen acceso a la cámara.

## Forma de trabajo

Por fases; al final de cada una, parar y esperar las pruebas y el feedback del usuario.

1. ✅ Cámara + detección + esqueleto + cursor suave + activación con palma.
2. ✅ Pellizco, ventana de prueba movible y redimensionable (+ zoom con dos manos y cerrar con puño).
3. Escritorio completo con barra de apps y las 3 mini-apps (reloj, notas, calculadora).
4. Retroceder, inicio, apps recientes y cambio de app por inclinación.
5. Pulido visual, sonidos y rendimiento.

Los umbrales de gestos viven en `CONFIG`, al inicio de `js/gestures.js`.
