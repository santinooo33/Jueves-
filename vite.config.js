// Servidor de desarrollo con HTTPS (certificado autofirmado) visible en la red local,
// para poder abrir la app desde el celular: la cámara exige HTTPS.
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: true,
    port: 5173,
    // Permite abrirla a través de un túnel HTTPS (cloudflared / ngrok) si la red local no deja.
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app'],
  },
});
