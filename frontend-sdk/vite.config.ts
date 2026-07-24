import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { imageGenerationPlugin } from './demo/image-api-server';

const assetFileNames = (asset: { name?: string }) =>
  asset.name?.endsWith('.css') ? 'styles.css' : 'assets/[name][extname]';

const libraryExternal = [
  /^react(?:\/.*)?$/,
  /^react-dom(?:\/.*)?$/,
  /^@xyflow\/react(?:\/.*)?$/,
  /^lucide-react(?:\/.*)?$/,
];

export default defineConfig(({ mode }) => {
  const libraryBuild = mode === 'library';
  const browserBuild = mode === 'browser';

  return {
    plugins: [react(), ...(!libraryBuild && !browserBuild ? [imageGenerationPlugin(process.cwd())] : [])],
    define: browserBuild ? { 'process.env.NODE_ENV': JSON.stringify('production') } : undefined,
    // Keep this package hermetic; a parent-drive PostCSS config must not leak
    // into SDK or Electron consumer builds.
    css: { postcss: { plugins: [] } },
    build: libraryBuild
      ? {
          emptyOutDir: true,
          lib: {
            entry: 'src/index.ts',
            name: 'FlowCanvas',
            formats: ['es', 'cjs'],
            fileName: format => format === 'es' ? 'index.js' : 'index.cjs',
          },
          rollupOptions: {
            external: libraryExternal,
            output: { assetFileNames },
          },
        }
      : browserBuild
        ? {
            emptyOutDir: false,
            cssCodeSplit: false,
            lib: {
              entry: 'src/browser.ts',
              name: 'FlowCanvas',
              formats: ['iife'],
              fileName: () => 'flowcanvas.iife.js',
            },
            rollupOptions: {
              output: {
                assetFileNames,
                inlineDynamicImports: true,
              },
            },
          }
        : undefined,
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'jsdom',
      setupFiles: ['tests/setup.ts'],
      coverage: { reporter: ['text', 'html'] },
    },
  };
});
