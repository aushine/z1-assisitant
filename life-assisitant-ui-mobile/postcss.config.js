/**
 * PostCSS 配置
 * 移动端 vw 适配：设计稿基准 375px，自动将 px 转为 vw
 * 注意：通过 `include` 限定 src 下的样式，避免转换 Vant 内部样式
 */
export default {
  plugins: {
    'postcss-px-to-viewport': {
      unitToConvert: 'px',
      viewportWidth: 375,
      unitPrecision: 5,
      propList: ['*'],
      viewportUnit: 'vw',
      fontViewportUnit: 'vw',
      selectorBlackList: ['.ignore-vw', 'van-'],
      minPixelValue: 1,
      mediaQuery: false,
      replace: true,
      exclude: [/node_modules\/(?!vant)/],
      landscape: false,
    },
  },
}
