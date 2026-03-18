import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "#0a0a0f",
          secondary: "#111118",
          card: "#18181f",
          "card-hover": "#1f1f28",
        },
        border: "#2a2a35",
        text: {
          primary: "#f0f0f5",
          secondary: "#a0a0b0",
          muted: "#606070",
        },
        accent: {
          DEFAULT: "#6366f1",
          hover: "#818cf8",
        },
        category: {
          hvac: "#f59e0b",
          plumbing: "#3b82f6",
          exterior: "#22c55e",
          appliance: "#a855f7",
          landscaping: "#14b8a6",
        },
        priority: {
          low: "#606070",
          medium: "#f59e0b",
          high: "#f97316",
          urgent: "#ef4444",
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
