import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-hanken)", "Hanken Grotesk", "system-ui", "sans-serif"],
      },
      colors: {
        // Legacy palette – preserved for backward compatibility
        leaf: {
          50: "#f3fbf5",
          100: "#e2f7e9",
          200: "#c0efd1",
          300: "#8ee0b0",
          400: "#56ca85",
          500: "#32b965",
          600: "#239550",
          700: "#1d7641",
          800: "#195f36",
          900: "#154d2e"
        },
        sun: {
          50: "#fffbe6",
          100: "#fff2b8",
          200: "#ffe48a",
          300: "#ffd45c",
          400: "#ffc22e",
          500: "#f2a900",
          600: "#c88500",
          700: "#9f6500",
          800: "#764700",
          900: "#4d2a00"
        },
        // Stitch / Plantasã design system tokens
        primary: {
          DEFAULT: "#002817",
          container: "#123f2a",
          fixed: "#beeecf",
          "fixed-dim": "#a2d1b4",
          on: "#ffffff",
          "on-container": "#7dab8f",
        },
        secondary: {
          DEFAULT: "#4d6700",
          container: "#ccf078",
          fixed: "#ccf078",
          "fixed-dim": "#b0d360",
          on: "#ffffff",
          "on-container": "#526d00",
        },
        tertiary: {
          DEFAULT: "#735c00",
          container: "#cba72f",
          fixed: "#ffe088",
          "fixed-dim": "#e9c349",
          on: "#ffffff",
          "on-container": "#4e3d00",
        },
        surface: {
          DEFAULT: "#fef9f0",
          dim: "#ded9d1",
          bright: "#fef9f0",
          container: "#f2ede4",
          low: "#f8f3ea",
          high: "#ece8df",
          highest: "#e7e2d9",
          variant: "#e7e2d9",
          tint: "#3c674f",
        },
        forest: "#0F2F22",
        earth: "#4B3D33",
        outline: {
          DEFAULT: "#717973",
          variant: "#c1c9c1",
        },
        "on-surface": "#1d1c16",
        "on-surface-variant": "#414943",
      },
      backgroundImage: {
        "hero-gradient": "linear-gradient(135deg, #beeecf 0%, #ffe088 100%)",
        "hero-radial": "radial-gradient(circle at top left, #DCEED3 0%, #fef9f0 44%, #FDFCFB 100%)",
      },
      boxShadow: {
        soft: "0 4px 20px rgba(0, 40, 23, 0.10)",
        card: "0 1px 3px rgba(0, 40, 23, 0.06), 0 4px 16px rgba(0, 40, 23, 0.08)",
        elevated: "0 8px 32px rgba(0, 40, 23, 0.16)",
      },
    }
  },
  plugins: []
};

export default config;
