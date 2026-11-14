import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

// the following postcss plugins enable tailwindcss (refer to `vite.css.postcss`)
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import tailwindcssNesting from 'tailwindcss/nesting'
import cssDiscardComments from 'postcss-discard-comments'
import postCssOklabPolyfill from '@csstools/postcss-oklab-function'

/**
 * Vite config for an SPA.
 * PostCSS along with TailwindCSS is configured below; this eliminates the need for `postcss.config.js`.
 *
 * @see https://vitejs.dev/config/
 * @see https://vitejs.dev/config/shared-options#base (in dev base removes the origin)
 */
export default defineConfig(({ mode }) => {
  // empty string third argument tells vite to load all variables here regardless if VITE_ prefix is present or not
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: '/',

    plugins: [
      tsconfigPaths(),
      react(),
    ],

    // configure tailwindcss in the vite config instead of external postcss.config.js
    css: {
      postcss: {
        plugins: [
          tailwindcssNesting(),
          tailwindcss({ config: new URL('./tailwind.config.ts', import.meta.url).pathname }),
          postCssOklabPolyfill({ preserve: true }),
          autoprefixer(),
          cssDiscardComments({ removeAll: true }),
        ],
      },
    },

    // configure development server
    server: {
      open: false,
      proxy: {
        '/api': {
          target: 'http://localhost:8787',
          changeOrigin: true,
          secure: false,
        },
      },
    },

    define: {
      'process.env.NODE_ENV': JSON.stringify(env.NODE_ENV || 'production'),
    },

    build: {
      rollupOptions: {
        // external dependencies are excluded from bundling and tree shaking in case its overly aggressive
        // issues have been encountered bundling `@radix-ui` packages so they have been externalized to resolve
        external: ['@radix-ui/react-*'],
        output: {
          assetFileNames: 'assets/[name]-[hash][extname]',
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',

          manualChunks(path, _meta) {
            if (path.includes('node_modules/react') || path.includes('node_modules/react-dom')) {
              return 'react'
            }
            if (path.includes('lucide-react')) {
              return 'lucide-react'
            }
          },
        },
      },
    },
  }
})
