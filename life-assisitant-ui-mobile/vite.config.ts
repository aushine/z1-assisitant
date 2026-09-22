import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { VantResolver } from '@vant/auto-import-resolver'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8090'
  // 上传静态独立目标（可选覆盖，默认同 API → 本地后端）。
  // dev 看图的主路径是后端 storage.public_url 下发基址、前端拼绝对 URL
  // （见 src/utils/avatar.ts 的 initUploadsBase），不经过这条代理；
  // 这里只是不想动后端配置时的备选通道（⚠ 需 z1.conf server_name 含该 IP）。
  const uploadsTarget = env.VITE_UPLOADS_PROXY_TARGET || apiTarget

  return {
  // 部署到子路径 /z1-app/ ：base 固化进配置，避免「忘记 --base 导致白屏 404」复发。
  // 需部署到根路径时用 VITE_BASE=/ npm run build 覆盖。
  base: process.env.VITE_BASE || '/z1-app/',
  plugins: [
    vue(),
    // Vant 4 按需引入（样式 + 组件 + directives）
    Components({
      resolvers: [VantResolver()],
      dts: 'src/types/components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    open: false,
    // 第十三轮：/z1 服务前缀统一代理入口（API /z1/api/v1/* + 静态 /z1/uploads/*）
    // ⚠ key 必须带尾斜杠：vite proxy 是字符串前缀匹配，'/z1' 会把
    // public/ 下的 /z1-logo.png 也吞掉代理到后端（404）。与桌面端同修。
    // （/z1-logo.png 不以 '/z1/api/' 或 '/z1/uploads/' 开头，仍由 vite 本地服务）
    proxy: {
      '/z1/api/': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/z1/uploads/': {
        target: uploadsTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    // D-03 第11轮：三端产物汇总到仓库根 dist/ —— 移动端 z1-app/
    // （outDir 在项目根之外，vite 默认不清空且会警告，显式 emptyOutDir）
    outDir: '../dist/z1-app',
    emptyOutDir: true,
    target: 'es2015',
    cssCodeSplit: true,
    sourcemap: false,
    // echarts 单 chunk 约 525KB（gzip 178KB），只被统计页动态引用、不进首屏。
    // 默认 500KB 阈值会对它持续报警，这里上调到 700KB 让警告恢复信噪比。
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          vue: ['vue', 'vue-router', 'pinia'],
          vant: ['vant'],
          // 图表库单独成 chunk：只有统计页 import，首屏不该带上它
          echarts: ['echarts', 'vue-echarts'],
          // 农历/节假日数据（HabitHeatmap 用），静态数据体积不小，同样延后加载
          'chinese-days': ['chinese-days'],
        },
      },
    },
  },
  }
})
