import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    // 部署到子路径 /z1/ ：base 固化进配置，避免「忘记 --base 导致白屏 404」复发。
    // 需部署到根路径时用 VITE_BASE=/ npm run build 覆盖。
    base: process.env.VITE_BASE || '/z1/',
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
        },
      },
    },
    server: {
      port: 5174,
      host: '0.0.0.0',
      open: false,
      // /z1 服务前缀（D-03 第十三轮）：API 与上传静态统一一个代理入口
      // （后端路由 /z1/api/v1/*，静态映射 /z1/uploads/*，见 internal/consts/routes.go）
      // ⚠ key 必须带尾斜杠 '/z1/'：vite proxy 是**字符串前缀匹配**而非路径段
      // 匹配，'/z1' 会把 public/ 下的同级资源 /z1-logo.png 也吞掉代理到
      // 后端（404 → 左上角 logo 图裂）。nginx 的 location /z1/ 天然带尾
      // 斜杠无此问题，仅 dev 模式受影响。
      proxy: {
        '/z1/': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:8090',
          changeOrigin: true,
        },
      },
    },
    build: {
      // D-03 第十一轮：三端产物汇总到仓库根 dist/ —— 桌面端 z1/
      // （outDir 在项目根之外，vite 默认不清空且会警告，显式 emptyOutDir）
      outDir: '../dist/z1',
      emptyOutDir: true,
      target: 'es2015',
      cssCodeSplit: true,
      sourcemap: false,
      chunkSizeWarningLimit: 1500,
    },
  }
})
