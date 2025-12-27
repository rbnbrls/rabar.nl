/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Rabar brand colors extracted from logo
        'rabar-navy': '#1B2B4B',      // Dark navy blue (primary text/accents)
        'rabar-blue': '#00A3E0',       // Bright blue (accent/WiFi symbol)
        'rabar-light': '#F8FAFC',      // Light background
        'rabar-dark': '#0F172A',       // Very dark for contrast
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
