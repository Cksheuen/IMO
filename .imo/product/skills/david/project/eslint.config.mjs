import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      // HARD-GATE 25: 页面不得联远端。fetch 的唯一例外是 loopback 评论服务传输层
      // （src/lib/feedbackTransport.ts，见下一个 config block 的定向豁免）；
      // XHR / WebSocket / EventSource / sendBeacon 无例外，全局禁用。
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'david 页面只允许经 src/lib/feedbackTransport.ts 访问 127.0.0.1 评论服务；其余 fetch 一律禁止 (HARD-GATE 25)' },
        { name: 'XMLHttpRequest', message: 'david pages must stay offline; no XHR (HARD-GATE 25)' },
        { name: 'WebSocket', message: 'david pages must stay offline; no WebSocket (HARD-GATE 25)' },
        { name: 'EventSource', message: 'david pages must stay offline; no EventSource (HARD-GATE 25)' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'navigator', property: 'sendBeacon', message: 'david pages must stay offline; no sendBeacon (HARD-GATE 25)' },
      ],
    },
  },
  {
    // HARD-GATE 25 定向豁免：评论服务传输层是页面访问本机 loopback 的唯一出口。
    // 仅放行 fetch，其余网络全局（XHR / WebSocket / EventSource / sendBeacon）
    // 在此处依然被上一个 block 禁用——本 block 只覆盖 no-restricted-globals。
    // 收窄到单文件，保证「页面能否联网」这件事只有一个可审查的入口。
    files: ['src/lib/feedbackTransport.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'XMLHttpRequest', message: 'david pages must stay offline; no XHR (HARD-GATE 25)' },
        { name: 'WebSocket', message: 'david pages must stay offline; no WebSocket (HARD-GATE 25)' },
        { name: 'EventSource', message: 'david pages must stay offline; no EventSource (HARD-GATE 25)' },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'vite.config.ts'],
    languageOptions: {
      globals: {
        console: 'readonly',
        Buffer: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        // Node 内置全局：agent 侧脚本（评论服务 daemon / CLI / 测试）要用。
        // 这些是 scripts 运行时环境，与「页面不联远端」的 HARD-GATE 25 无关——
        // 那条只约束 src/**（页面 bundle）。
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        HTMLElement: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        getComputedStyle: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-unsafe-assignment': 'off', '@typescript-eslint/no-unsafe-call': 'off' },
  },
);
