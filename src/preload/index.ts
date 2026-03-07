import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// ClawDesk API exposed to renderer
const clawdeskAPI = {
  // Onboarding
  checkOpenClaw: () => ipcRenderer.invoke('check-openclaw'),
  saveConfig: (config: any) => ipcRenderer.invoke('save-config', config),
  startApp: () => ipcRenderer.invoke('start-app'),

  // Enterprise Logs & Diagnostics
  getLogs: () => ipcRenderer.invoke('get-logs'),
  runDoctor: () => ipcRenderer.invoke('run-doctor'),
  runSecurityAudit: () => ipcRenderer.invoke('run-security-audit'),

  // Channels
  linkWhatsapp: () => ipcRenderer.invoke('link-whatsapp'),
  setupChannel: (channel: string, config: any) => ipcRenderer.invoke('setup-channel', channel, config),
  channelsStatus: () => ipcRenderer.invoke('channels-status'),

  // Gateway
  gatewayHealth: () => ipcRenderer.invoke('gateway-health'),
  gatewayStatus: () => ipcRenderer.invoke('gateway-status'),

  // TTS
  setTTS: (config: any) => ipcRenderer.invoke('set-tts', config),

  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveFullConfig: (config: any) => ipcRenderer.invoke('save-full-config', config),

  // Update
  runUpdate: () => ipcRenderer.invoke('run-update'),

  // Events
  onLogUpdate: (cb: (log: string) => void) => {
    const sub = (_e: any, log: string) => cb(log)
    ipcRenderer.on('log-update', sub)
    return () => ipcRenderer.removeListener('log-update', sub)
  },
  onWhatsAppQR: (cb: (qr: string) => void) => {
    const sub = (_e: any, qr: string) => cb(qr)
    ipcRenderer.on('whatsapp-qr', sub)
    return () => ipcRenderer.removeListener('whatsapp-qr', sub)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', clawdeskAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = clawdeskAPI
}
