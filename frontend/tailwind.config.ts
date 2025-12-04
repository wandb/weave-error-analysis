import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // W&B Brand Colors - Primary
        "moon-50": "#FDFDFD",
        "moon-100": "#F5F5F5",
        "moon-200": "#E8E8E8",
        "moon-300": "#D1D1D1",
        "moon-400": "#A8A8A8",
        "moon-450": "#8F949E",
        "moon-500": "#6B6B6B",
        "moon-600": "#4A4A4A",
        "moon-700": "#333333",
        "moon-800": "#252830",
        "moon-900": "#171A1F",
        
        // W&B Primary Accents
        gold: "#FCBC32",
        teal: "#10BFCC",
        
        // Legacy support (mapped to W&B colors)
        sand: {
          50: "#FDFDFD",
          100: "#F5F5F5",
          200: "#E8E8E8",
          300: "#D1D1D1",
          400: "#A8A8A8",
        },
        ink: {
          400: "#8F949E",
          500: "#6B6B6B",
          600: "#4A4A4A",
          700: "#333333",
          800: "#252830",
          900: "#1C1E24",
          950: "#171A1F",
        },
        accent: {
          coral: "#FCBC32",
          teal: "#10BFCC",
          gold: "#FCBC32",
          plum: "#8F949E",
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

