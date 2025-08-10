import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages（プロジェクトページ）で配信するためのベースパス
  // 例: https://satoshi5884.github.io/tamayokebattle/
  base: '/tamayokebattle/',
  plugins: [react()],
})
