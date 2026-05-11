import { ElectronAPI } from '@electron-toolkit/preload'

interface ORRERYAPI {
  saveConfig: (config: { provider: string; apiKey: string }) => Promise<{ success: boolean; error?: string }>
  startApp: () => Promise<{ success: boolean; error?: string }>
  checkOpenClaw: () => Promise<{ installed: boolean; path: string | null }>
  installOpenClaw: () => Promise<{ success: boolean; error?: string }>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ORRERYAPI
  }
}
