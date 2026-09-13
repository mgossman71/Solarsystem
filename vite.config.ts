import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    host: true,
    open: true,
  },
  build: {
    target: 'esnext',
    // Split the three.js runtime and its examples (postprocessing/controls)
    // out of the app chunk — they dominate the bundle and are stable across
    // app changes, so browsers can cache them separately.
    rollupOptions: {
      output: {
        manualChunks: (id: string): string | undefined => {
          if (id.includes('node_modules/three/examples/')) return 'three-examples';
          if (id.includes('node_modules/three/')) return 'three';
          return undefined;
        },
      },
    },
  },
});
