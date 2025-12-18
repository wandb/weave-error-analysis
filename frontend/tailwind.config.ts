import type { Config } from "tailwindcss";

/**
 * Tailwind CSS Configuration
 * 
 * Color values reference CSS variables defined in globals.css for single source of truth.
 * The CSS variables are the canonical definitions, Tailwind extends them for utility usage.
 * 
 * Primary colors use the `moon-*` scale (W&B brand).
 * Legacy `sand-*` and `ink-*` aliases are mapped for backwards compatibility.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // W&B Brand Colors - Primary (reference CSS variables)
        "moon-50": "var(--color-moon-50, #FDFDFD)",
        "moon-100": "#F5F5F5",
        "moon-200": "#E8E8E8",
        "moon-300": "#D1D1D1",
        "moon-400": "#A8A8A8",
        "moon-450": "var(--color-moon-450, #8F949E)",
        "moon-500": "#6B6B6B",
        "moon-600": "#4A4A4A",
        "moon-700": "var(--color-moon-700, #333333)",
        "moon-800": "var(--color-moon-800, #252830)",
        "moon-900": "var(--color-moon-900, #171A1F)",
        
        // W&B Primary Accents (reference CSS variables)
        gold: "var(--color-gold, #FCBC32)",
        teal: "var(--color-teal, #10BFCC)",
        
        // Legacy support - mapped to moon-* scale for backwards compatibility
        // These can be removed once all code migrates to moon-* classes
        sand: {
          50: "var(--color-moon-50, #FDFDFD)",
          100: "#F5F5F5",
          200: "#E8E8E8",
          300: "#D1D1D1",
          400: "#A8A8A8",
        },
        ink: {
          400: "var(--color-moon-450, #8F949E)",
          500: "#6B6B6B",
          600: "#4A4A4A",
          700: "var(--color-moon-700, #333333)",
          800: "var(--color-moon-800, #252830)",
          900: "#1C1E24",
          950: "var(--color-moon-900, #171A1F)",
        },
        accent: {
          coral: "var(--color-gold, #FCBC32)",
          teal: "var(--color-teal, #10BFCC)",
          gold: "var(--color-gold, #FCBC32)",
          plum: "var(--color-moon-450, #8F949E)",
        },
      },
      fontFamily: {
        // W&B Brand Typography
        display: ["Source Serif 4", "Source Serif Pro", "Times New Roman", "serif"],
        body: ["Source Sans 3", "Source Sans Pro", "Calibri", "sans-serif"],
        mono: ["JetBrains Mono", "Menlo", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
        "pulse-subtle": "pulseSubtle 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSubtle: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
      },
    },
  },
  plugins: [],
};
export default config;

