// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from "@tailwindcss/vite";
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  nitro: {
    preset: "cloudflare-pages",
  },
  css: ["./app/assets/css/main.css"],
  vite: {
    plugins: [tailwindcss()],
  },
  runtimeConfig: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,       // server-only
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY, // server-only (service_role key สำหรับ admin API)
    public: {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_KEY: process.env.SUPABASE_KEY,
    },
  },
});
