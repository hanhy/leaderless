import { defineConfig } from "vite";

const apiPort = Number(process.env.API_PORT ?? 8787);

export default defineConfig({
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true
      }
    }
  }
});
