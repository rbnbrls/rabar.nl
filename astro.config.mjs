import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://rabar.nl',
  integrations: [tailwind()],
  output: 'static',
});
