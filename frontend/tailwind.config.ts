import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: {
          50: "#FDFCFB",
          100: "#FEF9F0",
          200: "#E7E2D9",
          300: "#C1C9C1",
          400: "#A9B2AA",
          500: "#717973",
        },
        moss: {
          50: "#EEF8F1",
          100: "#D9EFE1",
          200: "#BEEECF",
          300: "#A2D1B4",
          400: "#7DAB8F",
          500: "#3C674F",
          600: "#234F39",
          700: "#123F2A",
          800: "#0F2F22",
          900: "#002817",
        },
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
          900: "#154d2e",
        },
        gold: {
          50: "#FFF8DE",
          100: "#FFEFB3",
          200: "#FFE088",
          300: "#E9C349",
          400: "#D4AF37",
          500: "#CBA72F",
          600: "#A88113",
          700: "#735C00",
          800: "#574500",
          900: "#241A00",
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
          900: "#4d2a00",
        },
        earth: {
          50: "#F7F1EC",
          100: "#E9DDD4",
          200: "#D5C3B6",
          300: "#BFA895",
          400: "#957A66",
          500: "#715B4C",
          600: "#4B3D33",
          700: "#352A23",
          800: "#211A16",
          900: "#130F0C",
        },
      },
      fontFamily: {
        sans: ["Hanken Grotesk", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "hero-gradient":
          "linear-gradient(135deg, #FEF9F0 0%, #E2F7E9 46%, #FFF8DE 100%)",
        "field-radial":
          "radial-gradient(circle at top left, rgba(162, 209, 180, 0.28), transparent 32%), radial-gradient(circle at bottom right, rgba(212, 175, 55, 0.18), transparent 26%)",
      },
      boxShadow: {
        soft: "0 18px 45px rgba(18, 63, 42, 0.12)",
        "inner-soft": "inset 0 1px 0 rgba(255,255,255,0.75)",
        tactile: "0 12px 24px rgba(18, 63, 42, 0.16)",
      },
    },
  },
  plugins: [],
};

export default config;
