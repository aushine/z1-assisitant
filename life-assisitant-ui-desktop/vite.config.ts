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
      // ⚠⚠️ 代理 key 必须收敛到子路径 /z1/api/ 与 /z1/uploads/，绝不能用裸 /z1/：
      // 桌面端 SPA 自身就挂在 /z1/（base:'/z1/'），若把 /z1/ 整体代理到后端，
      // 浏览器开 http://host:5174/z1/ 会被 vite 转发给后端、返回 401 JSON 而非
      // index.html → 整页白屏「打不开」（后端起来后必现，后端挂时反而因代理报错
      // 漏出 index.html，属隐蔽 footgun）。API/上传走子路径，SPA 根与 /z1/assets/*
      // 留给 vite 自己服务。（移动端 SPA 在 /z1-app/，不撞此坑，故移动端可用裸 /z1/）
      // ⚠ key 必须带尾斜杠：vite proxy 是**字符串前缀匹配**，'/z1/api' 不带斜杠会把
      // /z1/apixxx 也吞进去；uploads 同理。
      proxy: {
        '/z1/api/': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:8090',
          changeOrigin: true,
        },
        // 上传静态独立目标（可选覆盖，默认同 API → 本地后端）。
        // dev 看图的主路径是后端 storage.public_url 下发基址、前端拼绝对 URL
        // （见 src/utils/avatar.ts 的 initUploadsBase），不经过这条代理；
        // 这里只是不想动后端配置时的备选通道（如 VITE_UPLOADS_PROXY_TARGET=
        // http://192.168.101.75；⚠ 需 z1.conf server_name 含该 IP，裸 IP Host 才进 z1 块）。
        '/z1/uploads/': {
          target:
            env.VITE_UPLOADS_PROXY_TARGET ||
            env.VITE_API_PROXY_TARGET ||
            'http://localhost:8090',
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
