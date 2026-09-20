/**
 * ESLint 配置（移动端）
 *
 * 背景（Phase 0.2）：package.json 里一直有 `lint` 脚本
 *   `eslint . --ext .ts,.vue --max-warnings 0`
 * 但工程**既没有 eslint 依赖、也没有任何配置文件**，等于脚本从来没跑通过。
 * 本次补齐依赖（见 package.json devDependencies）与本配置。
 *
 * 几点刻意的取舍：
 *  - 用 `.cjs` 而非 flat config：脚本里的 `--ext` 是 ESLint 8 的写法，
 *    ESLint 9 已移除该参数并只认 flat config，故锁 eslint ^8.57。
 *  - 不 extends `plugin:@typescript-eslint/recommended`：该预设的
 *    legacy（eslintrc）导出在 v8 里已被拆到 flat config 下，跨版本不稳定。
 *    这里只挂 parser + plugin 并显式声明需要的那几条规则，行为可预期。
 *  - `no-console` 关闭：本工程把 `console.error` 当作错误日志在用
 *    （store 的 catch 分支），与业务日志无关。
 *  - `no-empty` 开 `allowEmptyCatch`：大量 `catch { /* 用户取消 *\/ }`
 *    写法，ESLint 认为只含注释的块是空块。
 *  - vue 只上 `vue3-essential`：`vue3-recommended` 多数为格式类 warn，
 *    在 `--max-warnings 0` 下会把整个 lint 变成格式检查，噪音大于价值。
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 'latest',
    sourceType: 'module',
    extraFileExtensions: ['.vue'],
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:vue/vue3-essential'],
  rules: {
    // 覆盖 eslint:recommended 中不认识 TS 语法的两条
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
    ],
    'no-console': 'off',
    // 大量 `catch { /* 用户取消 */ }` 写法；ESLint 认为只含注释的块是空块
    'no-empty': ['error', { allowEmptyCatch: true }],
    '@typescript-eslint/no-explicit-any': 'off',
    'vue/multi-word-component-names': 'off',
    'vue/no-v-html': 'off',
  },
  ignorePatterns: ['dist', 'node_modules', '*.d.ts', 'src/types/components.d.ts'],
}
