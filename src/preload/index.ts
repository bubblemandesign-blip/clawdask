import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

/**
 * ClawdAsk API exposed to renderer
 * All functions use ipcRenderer.invoke (asynchronous IPC)
 */
const clawdaskAPI = {
  // Onboarding & Identity
  checkClawdAsk: () => ipcRenderer.invoke('check-clawdask'),
  saveConfig: (config: any) => ipcRenderer.invoke('save-config', config),
  startApp: () => ipcRenderer.invoke('start-app'),
  
  // Licensing & Payments
  openWhopCheckout: (url: string) => ipcRenderer.invoke('open-whop-checkout', url),
  checkLicense: () => ipcRenderer.invoke('check-license'),
  validateWhopLicense: (key: string) => ipcRenderer.invoke('validate-whop-license', key),

  // Embedded AI & Model Management
  getLocalAiStatus: (modelId: string) => ipcRenderer.invoke('get-local-ai-status', modelId),
  getLocalAiAllStatus: () => ipcRenderer.invoke('get-all-local-ai-status'),
  checkDiskSpace: (requiredBytes: number) => ipcRenderer.invoke('check-disk-space', requiredBytes),
  downloadLocalEngine: () => ipcRenderer.invoke('download-local-engine'),
  downloadLocalModel: (modelId: string, force = false) => ipcRenderer.invoke('download-local-model', modelId, force),
  detectLocalBackend: () => ipcRenderer.invoke('detect-local-backend'),
  verifyModelIntegrity: (modelId: string) => ipcRenderer.invoke('verify-model-integrity', modelId),

  // System & Diagnostics
  getSpecs: () => ipcRenderer.invoke('get-specs'),
  getLogs: () => ipcRenderer.invoke('get-logs'),
  runDoctor: () => ipcRenderer.invoke('run-doctor'),
  runSecurityAudit: () => ipcRenderer.invoke('run-security-audit'),

  // Channels (WhatsApp, etc.)
  linkWhatsapp: () => ipcRenderer.invoke('link-whatsapp'),
  setupChannel: (channel: string, config: any) => ipcRenderer.invoke('setup-channel', channel, config),
  channelsStatus: () => ipcRenderer.invoke('channels-status'),

  // Gateway Control
  gatewayHealth: () => ipcRenderer.invoke('gateway-health'),
  gatewayStatus: () => ipcRenderer.invoke('gateway-status'),

  // TTS & Multimedia
  setTTS: (config: any) => ipcRenderer.invoke('set-tts', config),

  // Configuration
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveFullConfig: (config: any) => ipcRenderer.invoke('save-full-config', config),

  // Updates
  runUpdate: () => ipcRenderer.invoke('run-update'),

  // Events (Listeners)
  onLogUpdate: (cb: (log: string) => void) => {
    const sub = (_e: any, log: string) => cb(log)
    ipcRenderer.on('log-update', sub)
    return () => ipcRenderer.removeListener('log-update', sub)
  },
  onWhatsAppQR: (cb: (qr: string) => void) => {
    const sub = (_e: any, qr: string) => cb(qr)
    ipcRenderer.on('whatsapp-qr', sub)
    return () => ipcRenderer.removeListener('whatsapp-qr', sub)
  },
  onPullProgress: (callback: (data: any) => void) => {
    ipcRenderer.on('pull-progress', (_e, data) => callback(data))
  },
  onGatewayStatus: (callback: (status: string) => void) => {
    const sub = (_e: any, status: string) => callback(status)
    ipcRenderer.on('gateway-status-update', sub)
    return () => ipcRenderer.removeListener('gateway-status-update', sub)
  },
  onLocalAiDownloadProgress: (callback: (data: {type: string, modelId?: string, percent: number, text: string}) => void) => {
    const sub = (_e: any, data: any) => callback(data)
    ipcRenderer.on('local-ai-download-progress', sub)
    return () => ipcRenderer.removeListener('local-ai-download-progress', sub)
  }
}

// Legacy / Helper API
const setupAPI = {
  saveApiKey: (provider: string, key: string) => ipcRenderer.invoke('save-api-key', provider, key),
  openLink: (url: string) => ipcRenderer.invoke('open-link', url)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', clawdaskAPI)
    contextBridge.exposeInMainWorld('orrery', setupAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = clawdaskAPI
  // @ts-ignore
  window.orrery = setupAPI
}
