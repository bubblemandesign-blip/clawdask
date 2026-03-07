import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: [
          'electron',
          'openclaw',
          'koffi',
          'sqlite-vec-windows-x64',
          '@mariozechner/pi-agent-core',
          '@img/sharp-libvips-win32-x64'
        ]
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vue()]
  }
})
