import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react()],
    server: env.VITE_SUPABASE_URL ? { proxy: {
      '/api/supabase': { target: env.VITE_SUPABASE_URL, changeOrigin: true, rewrite: path => path.replace(/^\/api\/supabase/, '') },
    } } : undefined,
    build: { rollupOptions: { output: { manualChunks: { supabase: ['@supabase/supabase-js'] } } } },
  }
})
