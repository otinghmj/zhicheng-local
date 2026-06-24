import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', 'SERVER_');
  const serverPort = env.SERVER_PORT || '3200';
  const target = `http://localhost:${serverPort}`;

  return {
    plugins: [react()],
    publicDir: '../design',
    server: {
      proxy: {
        '/api': { target, changeOrigin: true },
        '/mcp': { target, changeOrigin: true },
      },
    },
  };
});
