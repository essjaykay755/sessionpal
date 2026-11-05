import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        raised: "rgb(var(--raised) / <alpha-value>)",
        sunken: "rgb(var(--sunken) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        faint: "rgb(var(--faint) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        ink: {
          950: "#161411",
          900: "#1c1916",
          850: "#221e1a",
          800: "#29241f",
          700: "#3a332b",
          600: "#54493e",
          500: "#73665a",
          400: "#948678",
          300: "#b6aa9c",
          200: "#d6cdc0",
          100: "#ebe4d9",
        },
        paper: {
          50: "#fdfbf7",
          100: "#f9f6f0",
          200: "#f3eee5",
          300: "#ece5d9",
          400: "#e1d8c8",
        },
        copper: {
          50: "#fbf1ea",
          100: "#f5dfd0",
          200: "#ebc0a6",
          300: "#de9c78",
          400: "#cd7f54",
          500: "#b86a42",
          600: "#9d5635",
          700: "#7d442c",
          800: "#5e3525",
        },
        moss: "#7c8a5a",
        clay: "#b76443",
        sand: "#d9c6a5",
      },
      // The type scale. Use these instead of arbitrary pixel sizes; 11px is the
      // floor for any text, 12px for anything people need to read.
      fontSize: {
        "11": "11px",
        "12": "12px",
        "13": "13px",
        "14": "14px",
        "16": "16px",
        "18": "18px",
        "24": "24px",
        "28": "28px",
        "32": "32px",
        "40": "40px",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        "4xl": "2rem",
        "5xl": "2.5rem",
      },
      boxShadow: {
        soft: "0 1px 0 rgba(35, 28, 20, 0.03), 0 10px 30px -18px rgba(44, 35, 25, 0.22)",
        float: "0 24px 80px -30px rgba(32, 24, 17, 0.38), 0 4px 18px -8px rgba(32, 24, 17, 0.12)",
        window: "0 50px 120px -40px rgba(35, 27, 18, 0.55), 0 20px 60px -30px rgba(35, 27, 18, 0.35)",
        inner: "inset 0 1px 0 rgba(255, 255, 255, 0.6)",
      },
      transitionTimingFunction: {
        silk: "cubic-bezier(0.22, 1, 0.36, 1)",
        snap: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      keyframes: {
        breathe: {
          "0%, 100%": { opacity: "0.5", transform: "scale(1)" },
          "50%": { opacity: "0.9", transform: "scale(1.04)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        breathe: "breathe 7s ease-in-out infinite",
        shimmer: "shimmer 2s linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
