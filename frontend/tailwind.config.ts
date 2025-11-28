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
        // Warm, distinctive palette inspired by "amber analysis"
        sand: {
          50: "#fdfcfb",
          100: "#f9f6f2",
          200: "#f3ede4",
          300: "#e9dfd0",
          400: "#d9c9ae",
          500: "#c4ad88",
          600: "#a8906a",
          700: "#8a7455",
          800: "#6d5a43",
          900: "#544435",
        },
        ink: {
          50: "#f6f7f9",
          100: "#eceef2",
          200: "#d5dae2",
          300: "#b0b9c8",
          400: "#8593a9",
          500: "#66768f",
          600: "#515e76",
          700: "#434d60",
          800: "#3a4251",
          900: "#1e2229",
          950: "#14171c",
        },
        accent: {
          coral: "#e07356",
          teal: "#4a9c94",
          gold: "#d4a84b",
          plum: "#8b5a8b",
        },
      },
      fontFamily: {
        display: ["Playfair Display", "Georgia", "serif"],
        body: ["Source Sans 3", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Menlo", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 0.5s ease-out",
        "slide-up": "slideUp 0.4s ease-out",
        "pulse-subtle": "pulseSubtle 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
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

