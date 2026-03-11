import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// ClawDesk API exposed to renderer
const clawdeskAPI = {
  // Onboarding
  checkOpenClaw: () => ipcRenderer.invoke('check-openclaw'),
  saveConfig: (config: any) => ipcRenderer.invoke('save-config', config),
  startApp: () => ipcRenderer.invoke('start-app'),
  checkModel: (name: string) => ipcRenderer.invoke('check-model', name),
  pullModel: (name: string) => ipcRenderer.invoke('pull-model', name),
  listModels: () => ipcRenderer.invoke('list-models'),
  saveApiKey: (provider: string, key: string) => ipcRenderer.invoke('save-api-key', provider, key),

  // Embedded AI
  getLocalAiStatus: (modelId: string) => ipcRenderer.invoke('get-local-ai-status', modelId),
  getLocalAiAllStatus: () => ipcRenderer.invoke('get-all-local-ai-status'),
  downloadLocalEngine: () => ipcRenderer.invoke('download-local-engine'),
  downloadLocalModel: (modelId: string) => ipcRenderer.invoke('download-local-model', modelId),

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
  getSpecs: () => ipcRenderer.invoke('get-specs'),
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
  },
  onPullProgress: (callback: (data: any) => void) => {
    ipcRenderer.on('pull-progress', (_e, data) => callback(data))
  },
  onGatewayStatus: (callback: (status: string) => void) => {
    ipcRenderer.on('gateway-status-update', (_e, status) => callback(status))
  },
  onLocalAiDownloadProgress: (callback: (data: {type: string, modelId?: string, percent: number, text: string}) => void) => {
    const sub = (_e: any, data: any) => callback(data)
    ipcRenderer.on('local-ai-download-progress', sub)
    return () => ipcRenderer.removeListener('local-ai-download-progress', sub)
  }
}

const setupAPI = {
  saveApiKey: (provider: string, key: string) => ipcRenderer.invoke('save-api-key', provider, key),
  openLink: (url: string) => ipcRenderer.invoke('open-link', url)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', clawdeskAPI)
    contextBridge.exposeInMainWorld('clawdesk', setupAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = clawdeskAPI
  // @ts-ignore
  window.clawdesk = setupAPI
}
