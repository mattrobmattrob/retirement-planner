/// <reference types="vitest" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// `base: './'` keeps asset URLs relative so the build can be hosted from any path
// (GitHub Pages project sites, S3 buckets, a subfolder on an existing site, …).
export default defineConfig({
  base: './',
  plugins: [preact()],
  worker: { format: 'es' },
  test: { environment: 'node' },
});
