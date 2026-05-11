try {
  // Aggressive scrubbing of conflicting Electron env vars
  delete process.env['ELECTRON_RUN_AS_NODE']
  delete process.env['ELECTRON_NO_ASAR']
} catch { }

// Disable hardware acceleration to prevent common "Black Screen" issues on diverse Windows GPUs
const electron = require('electron')
if (electron && electron.app) {
  electron.app.disableHardwareAcceleration()
}

// Force Ollama Authentication for local bypass (ClawdAsk local engine requirement)
process.env['OLLAMA_API_KEY'] = 'ollama-local'

// Core imports
import { app, BrowserWindow, globalShortcut, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join, dirname } from 'path'
import { ChildProcess, spawn, execSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'fs'
import { homedir } from 'os'
import http from 'http'
import https from 'https'

const CLAWDASK_DIR = join(homedir(), '.clawdask')

const LOGS_DIR = join(CLAWDASK_DIR, 'logs')
const CRASH_LOG = join(LOGS_DIR, 'app_crash.log')

// ??? Data Directory Migration Shim ??????????????????????????????????????
// Silently migrates existing .openclaw data to .clawdask for existing users
function migrateDataDirIfNeeded(): void {
  try {
    const { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } = require('fs')
    const { join } = require('path')
    const { homedir } = require('os')
    const legacyDir = join(homedir(), '.openclaw')
    const newDir = join(homedir(), '.clawdask')
    
    if (existsSync(legacyDir) && !existsSync(newDir)) {
      addTrace('[migration] Migrating .openclaw ? .clawdask')
      const migrate = (src: string, dest: string) => {
        if (!existsSync(dest)) mkdirSync(dest, { recursive: true })
        for (const item of readdirSync(src)) {
          const s = join(src, item), d = join(dest, item)
          try {
            if (statSync(s).isDirectory()) migrate(s, d)
            else copyFileSync(s, d)
          } catch { /* skip locked files */ }
        }
      }
      migrate(legacyDir, newDir)
      addTrace('[migration] Data migration complete')
    }
  } catch (e) { addTrace(`[migration] Non-fatal error: ${e}`) }
}
const TRACE_LOG = join(LOGS_DIR, 'app_trace.log')

// Global Logs/Crash Sentinel
if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true })

function addTrace(msg: string) {
  const line = `[${new Date().toISOString()}] [TRACE] ${msg}\n`
  try { appendFileSync(TRACE_LOG, line) } catch {}
}

function logCrash(err: any) {
  const msg = `\n[${new Date().toISOString()}] CRITICAL CRASH: ${err?.stack || err}\n`
  addTrace(`CRASH DETECTED: ${err?.message || err}`)
  try { appendFileSync(CRASH_LOG, msg) } catch {}
}
process.on('uncaughtException', logCrash)
process.on('unhandledRejection', logCrash)

addTrace('--- APP START (BOOTSTRAP) ---')

import { bootstrapSkills } from './skills-bootstrapper'
import { localAIManager, AVAILABLE_MODELS } from './local-ai-manager'
// ─── Cloud Path Sentinel ──────────────────────────────────────────────
function checkCloudPath(): boolean {
  const appPath = app.getAppPath().toLowerCase()
  const dangerousPaths = ['onedrive', 'dropbox', 'google drive', 'desktop', 'سطح المكتب']
  
  if (dangerousPaths.some(p => appPath.includes(p))) {
    addTrace(`CLOUD PATH DETECTED: ${appPath}`)
    return true
  }
  return false
}

function showCloudWarning(): void {
  dialog.showMessageBoxSync({
    type: 'warning',
    title: '⚠️ Cloud Path Detected',
    message: 'ClawdAsk is running from a synced folder (OneDrive/Desktop).',
    detail: 'This WILL corrupt your AI models and crash the engine.\n\nPlease move the application folder to C:\\ClawdAsk before continuing.',
    buttons: ['I will move it now', 'Ignore (Risky)']
  })
}

// Dev-mode userData path fix (deferred until app is definitively available)
function setupDevPath() {
  try {
    if (process.env.NODE_ENV === 'development') {
      const devDataPath = join(homedir(), '.clawdask', 'dev-data')
      if (!existsSync(devDataPath)) mkdirSync(devDataPath, { recursive: true })
      if (app) app.setPath('userData', devDataPath)
    }
  } catch (e) {
    console.warn('[boot] Early userData set failed:', e)
  }
}

const APP_ID = 'com.clawdask.app'
let GATEWAY_PORT = 18789
let GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`
const CONFIG_PATH = join(CLAWDASK_DIR, 'clawdask.json')
import crypto from 'crypto'

// ─── Self-Healing: Auto-repair missing OpenClaw build output ─────────
function repairGatewayDist(): void {
  try {
    // Search in multiple possible locations
    const candidates = [
      join(app.getAppPath(), '..', 'app.asar.unpacked', 'node_modules', 'openclaw'),
      join(dirname(app.getPath('exe')), 'resources', 'app.asar.unpacked', 'node_modules', 'openclaw'),
      'C:\\\\ClawdAsk\\\\resources\\\\app.asar.unpacked\\\\node_modules\\\\openclaw'
    ]
    
    for (const gatewayDir of candidates) {
      const distDir = join(gatewayDir, 'dist')
      const entryMjs = join(distDir, 'entry.mjs')
      const indexJs = join(distDir, 'index.js')
      
      if (existsSync(distDir) && existsSync(indexJs) && !existsSync(entryMjs)) {
        addTrace(`[self-heal] Repairing missing entry.mjs in ${distDir}`)
        writeFileSync(entryMjs, 'import "./index.js";\n')
        addTrace('[self-heal] entry.mjs restored successfully')
      }
    }
  } catch (e) {
    addTrace(`[self-heal] Repair attempt failed (non-fatal): ${e}`)
  }
}

// ─── Self-Healing: Ensure gateway token exists in config ─────────────
function ensureGatewayToken(): string {
  try {
    if (!existsSync(CONFIG_PATH)) return ''
    const raw = readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, '')
    const config = JSON.parse(raw)
    
    let token = config?.gateway?.auth?.token
    if (!token) {
      // Auto-generate a secure token
      token = crypto.randomBytes(24).toString('base64url')
      if (!config.gateway) config.gateway = {}
      if (!config.gateway.auth) config.gateway.auth = {}
      config.gateway.auth.mode = 'token'
      config.gateway.auth.token = token
      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
      addTrace(`[self-heal] Auto-generated gateway token: ${token.substring(0, 8)}...`)
    }
    return token
  } catch (e) {
    addTrace(`[self-heal] Token ensure failed: ${e}`)
    return ''
  }
}

// ─── Enterprise Logs ─────────────────────────────────────────────────────
const MAX_LOGS = 1000
let LOG_BUFFER: string[] = []

function addLog(line: string) {
  const formatted = `[${new Date().toLocaleTimeString()}] ${line.trim()}`
  console.log(`[main] ${formatted}`) // Ensure visibility in terminal
  LOG_BUFFER.push(formatted)
  if (LOG_BUFFER.length > MAX_LOGS) LOG_BUFFER.shift()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-update', LOG_BUFFER[LOG_BUFFER.length - 1])
  }
}

// ─── State ───────────────────────────────────────────────────────────────
let mainWindow: any = null
let onboardingWindow: any = null
let splashWindow: any = null
let tray: any = null
let isQuitting = false
const isMinimized = process.argv.includes('--minimized')

function sendGatewayStatus(msg: string) {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.webContents.send('gateway-status-update', msg)
  }
}

// ─── Tunnel & Cloudflared Logic ────────────────────────────────────────
class RuntimeManager {
  private binDir = join(CLAWDASK_DIR, 'bin')
  private nodePath = join(this.binDir, 'node.exe')

  async ensureRuntime(): Promise<string> {
    // 1. Check if system Node is already compatible (v22+)
    try {
      const sysVersion = execSync('node -v', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
      if (sysVersion.includes('v22') || sysVersion.includes('v23') || sysVersion.includes('v24')) {
        addLog(`[runtime] System Node.js (${sysVersion.trim()}) is compatible.`)
        return 'node'
      }
    } catch {}

    // 2. Check if portable Node is valid
    if (this.isRuntimeValid()) {
      addLog('[runtime] Local Node.js runtime verified')
      return this.nodePath
    }

    addLog('[runtime] Local runtime missing or incompatible. Initiating secure download (v22.14.0)...')
    try {
      if (!existsSync(this.binDir)) mkdirSync(this.binDir, { recursive: true })
      await this.downloadNode()
      addLog('[runtime] Local Node.js v22.14.0 installed successfully')
      return this.nodePath
    } catch (e) {
      addLog(`[runtime:err] Failed to setup portable runtime: ${e}. Falling back to system Node.`)
      return 'node'
    }
  }

  async getNodePath(): Promise<string> {
    if (existsSync(this.nodePath)) return this.nodePath
    
    // Check if system node is compatible
    try {
      const { execSync } = require('child_process')
      const sysVersion = execSync('node -v', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
      if (sysVersion.includes('v22') || sysVersion.includes('v23') || sysVersion.includes('v24')) {
        return 'node'
      }
    } catch {}

    return process.execPath
  }

  private isRuntimeValid(): boolean {
    if (!existsSync(this.nodePath)) return false
    try {
      const version = execSync(`"${this.nodePath}" -v`, { encoding: 'utf-8' })
      return version.includes('v22') || version.includes('v24')
    } catch { return false }
  }

  private downloadNode(): Promise<void> {
    const url = 'https://nodejs.org/dist/v22.14.0/win-x64/node.exe'
    return new Promise((resolve, reject) => {
      const file = require('fs').createWriteStream(this.nodePath)
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Node.js download failed: ${response.statusCode}`))
          return
        }
        response.pipe(file)
        file.on('finish', () => {
          file.close()
          resolve()
        })
      }).on('error', (err) => {
        require('fs').unlinkSync(this.nodePath)
        reject(err)
      })
    })
  }
}

// ─── Gateway Manager ─────────────────────────────────────────────────────
type GatewayState = 'stopped' | 'starting' | 'running' | 'crashed' | 'restarting'

class GatewayManager {
  private process: ChildProcess | null = null
  private state: GatewayState = 'stopped'
  private restartCount = 0
  private lastRestartAttempt = 0
  private currentPort = GATEWAY_PORT
  private watchdogInterval: NodeJS.Timeout | null = null
  public runtime: RuntimeManager

  constructor() {
    this.runtime = new RuntimeManager()
  }

  get isRunning(): boolean { return this.state === 'running' }
  get currentState(): GatewayState { return this.state }
  get pid(): number | undefined { return this.process?.pid }

  private startTunnelSync(): void {
    const cf = this.findCloudflared()
    if (!cf) return

    addLog(`[tunnel] Starting synchronized tunnel for port ${GATEWAY_PORT}...`)
    try {
      const tunnelProc = spawn(cf, ['tunnel', '--url', `http://127.0.0.1:${GATEWAY_PORT}`, '--no-autoupdate'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      tunnelProc.unref()
      addLog('[tunnel] Cloudflare tunnel orchestration active')
    } catch (e) {
      addLog(`[tunnel:err] Failed to start tunnel: ${e}`)
    }
  }

  private ensureEnvironment(): void {
    const subdirs = [
      'agents/main/sessions',
      'credentials',
      'canvas',
      'logs',
      'skills',
      'tmp',
      'cache',
      'profiles'
    ]
    if (!existsSync(CLAWDASK_DIR)) {
      try { mkdirSync(CLAWDASK_DIR, { recursive: true }) } catch (e) { console.error('[env] Failed to create CLAWDASK_DIR:', e) }
    }
    subdirs.forEach(d => {
      const p = join(CLAWDASK_DIR, d)
      try {
        if (!existsSync(p)) mkdirSync(p, { recursive: true })
      } catch (e) { console.error(`[env] Failed to create subdir ${d}:`, e) }
    })
    addLog('[env] Enterprise environment verification complete')
  }

  private findCloudflared(): string | null {
    const { app } = require('electron')
    const possiblePaths = [
      join(app.getAppPath(), 'cloudflared.exe').replace('app.asar', 'app.asar.unpacked'),
      join(process.resourcesPath, 'app.asar.unpacked', 'cloudflared.exe'),
      join(process.resourcesPath, 'cloudflared.exe'),
      join(process.cwd(), 'cloudflared.exe'),
      'cloudflared.exe'
    ]
    for (const p of possiblePaths) {
      if (existsSync(p)) {
        addTrace(`Cloudflared found at: ${p}`)
        return p
      }
    }
    addTrace('WARNING: cloudflared.exe not found in standard locations.')
    return null
  }

  private preStartConfigCleanup(): void {
    if (!existsSync(CONFIG_PATH)) return
    try {
      let rawConfig = readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, '')
      let config = JSON.parse(rawConfig)
      let changed = false

      // 1. Ensure Top-Level and Defaults Structure
      if (!config.auth) { config.auth = {}; changed = true; }
      if (!config.skills) { config.skills = { entries: {} }; changed = true; }
      if (!config.agents) { config.agents = {}; changed = true; }
      if (!config.agents.defaults) { config.agents.defaults = {}; changed = true; }
      
      if (!config.agents.defaults.sandbox) {
        config.agents.defaults.sandbox = { mode: 'off' }
        changed = true
      }

      // 2. Docker Probe for Sandbox Safety
      let hasDocker = false
      try {
        execSync('docker --version', { stdio: 'ignore' })
        hasDocker = true
      } catch { hasDocker = false }

      if (!hasDocker && config.agents?.defaults?.sandbox?.mode === 'all') {
        config.agents.defaults.sandbox.mode = 'off'
        changed = true
        addLog('[sentinel] Docker missing: Forcing sandbox mode to OFF')
      }

      // 3. Embedded AI Provider Registration
      const primaryModel = config?.agents?.defaults?.model?.primary || config?.model || ''
      if (primaryModel.startsWith('local/')) {
        if (!config.models) config.models = {}
        if (!config.models.providers) config.models.providers = {}
        // Use 'local' provider for embedded models (matches the 'local/' prefix)
        if (!config.models.providers.local || !config.models.providers.local.apiKey) {
          config.models.providers.local = {
            ...(config.models.providers.local || {}),
            apiKey: 'local-embedded',
            api: 'openai-completions',
            baseUrl: 'http://127.0.0.1:11434/v1',
            models: AVAILABLE_MODELS.map(m => ({ id: m.id, name: m.name }))
          }
          changed = true
          addLog('[sentinel] Injected Local provider registration')
        }
        
        // Cleanup: remove timeoutSeconds as it violates gateway schema
        if (config.models.providers.local?.timeoutSeconds !== undefined) {
          delete config.models.providers.local.timeoutSeconds
          changed = true
          addLog('[sentinel] Removed invalid timeoutSeconds from config')
        }

        // Cleanup: remove obsolete names if they were used for local engine
        if (config.models.providers.openai && config.models.providers.openai.apiKey === 'local-embedded') {
          delete config.models.providers.openai
          changed = true
        }
        if (config.models.providers.custom && config.models.providers.custom.apiKey === 'local-embedded') {
          delete config.models.providers.custom
          changed = true
        }
        // Ensure auth profile exists but is CLEAN
        if (!config.auth) config.auth = {}
        if (!config.auth.profiles) config.auth.profiles = {}
        if (!config.auth.profiles['local:default']) {
          config.auth.profiles['local:default'] = { mode: 'api_key', provider: 'local' }
          changed = true
        }
      }

      // 4. Fix DM Policy allowFrom array
      if (config.channels?.whatsapp?.dmPolicy === 'open') {
        if (!config.channels.whatsapp.allowFrom || !config.channels.whatsapp.allowFrom.includes('*')) {
          config.channels.whatsapp.allowFrom = ['*']
          changed = true
          addLog('[sentinel] Repaired whatsapp dmPolicy allowFrom requirements')
        }
      }
      if (config.channels?.telegram?.dmPolicy === 'open') {
        if (!config.channels.telegram.allowFrom || !config.channels.telegram.allowFrom.includes('*')) {
          config.channels.telegram.allowFrom = ['*']
          changed = true
          addLog('[sentinel] Repaired telegram dmPolicy allowFrom requirements')
        }
      }

      // 5. Bulletproof Provider Sanitization (Self-Healing)
      const nativeProviders: Record<string, string> = {
        'google': 'https://generativelanguage.googleapis.com/v1beta',
        'anthropic': 'https://api.anthropic.com',
        'openai': 'https://api.openai.com/v1'
      }
      
      Object.entries(nativeProviders).forEach(([prov, defaultUrl]) => {
        if (config.models?.providers?.[prov]) {
          // If baseUrl is missing or looks suspicious (e.g. contains /v1/openai/ which causes 404s in some versions)
          const current = config.models.providers[prov].baseUrl
          if (!current || current.includes('/openai/') || current.includes('localhost')) {
            config.models.providers[prov].baseUrl = defaultUrl
            changed = true
            addLog(`[sentinel] Restored default baseUrl for ${prov}`)
          }
          
          if (config.models.providers[prov].api) {
            delete config.models.providers[prov].api
            changed = true
          }
        }
      })
      
      // Cleanup legacy auth injections (identity)
      if (config.auth?.profiles) {
        Object.keys(config.auth.profiles).forEach(key => {
          if (config.auth.profiles[key].identity) {
            delete config.auth.profiles[key].identity
            changed = true
            addLog(`[sentinel] Scrubbed legacy identity key from profile ${key}`)
          }
        })
      }

      // 6. Model ID Sanitization (Fix legacy 404s)
      if (config.agents?.defaults?.model?.primary === 'google/gemini-2.5-flash') {
        config.agents.defaults.model.primary = 'google/gemini-2.0-flash'
        changed = true
        addLog('[sentinel] Upgraded gemini-2.5-flash to 2.0-flash in default model')
      }
      if (config.agents?.defaults?.model?.primary === 'google/gemini-2.5-pro') {
        config.agents.defaults.model.primary = 'google/gemini-1.5-pro'
        changed = true
      }

      if (changed) writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    } catch (e) { console.error('[config:sentinel] Error:', e) }
  }

  async ensureLocalEngineRunning(): Promise<void> {
    try {
      if (!existsSync(CONFIG_PATH)) return
      const rawConfig = readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, '')
      const config = JSON.parse(rawConfig)
      
      const primaryModel = config?.agents?.defaults?.model?.primary || config?.model || ''
      const targetModelId = config.models?.primaryModel || primaryModel || 'local/llama3.2-3b'
      const engineModelId = targetModelId.replace('local/', '').replace('ollama/', '')
      addLog(`[gateway] Local AI check for model: ${targetModelId}`)
      
      // ─── INTELLIGENT PORT SENSING ───
      // Probe currently configured port first to avoid unnecessary restarts/hangs
      const currentLocal = config.models?.providers?.local
      if (currentLocal?.baseUrl) {
        try {
          const url = new URL(currentLocal.baseUrl)
          const port = parseInt(url.port)
          if (port) {
            addTrace(`[local-ai] Probing current port ${port}...`)
            const isAlive = await localAIManager.waitForServerReady(port, 2000)
            if (isAlive) {
              addLog(`[gateway] Local AI already active on port ${port}. Skipping re-boot.`)
              return
            }
          }
        } catch { /* ignore invalid URL */ }
      }

      // ─── OLLAMA NATIVE SUPPORT ───
      if (primaryModel.startsWith('ollama/')) {
        addLog('[gateway] Detected Ollama model. Ensuring service is active...')
        sendGatewayStatus('Verifying Ollama service...')
        const ollamaOk = await localAIManager.ensureOllamaRunning()
        if (ollamaOk) {
          addLog('[gateway] Ollama service is active and responsive.')
        } else {
          addLog('[gateway:err] Ollama service could not be started automatically.')
        }
        return
      }

      // ─── UNIFIED LOCAL ENGINE SUPPORT ───
      if (!primaryModel.startsWith('local/')) {
        addTrace(`[local-ai] Model ${primaryModel} does not use a local provider. Skipping initialization.`)
        return
      }
      
      // 1. Verify model integrity if already downloaded
      if (localAIManager.isModelInstalled(engineModelId)) {
        const integrity = localAIManager.verifyModelIntegrity(engineModelId)
        if (!integrity.ok) {
          addLog(`[gateway:warn] Model integrity check failed: ${integrity.message}. Re-downloading...`)
          sendGatewayStatus(`Re-downloading corrupted AI Model (${engineModelId})...`)
          const modelDownloaded = await localAIManager.downloadModel(engineModelId, undefined, true)
          if (!modelDownloaded.success) {
            addLog(`[gateway:err] Failed to re-download model: ${modelDownloaded.error}`)
            return
          }
        }
      }
      
      // 2. Check for missing model
      if (!localAIManager.isModelInstalled(engineModelId)) {
        addLog(`[gateway:err] Model ${engineModelId} is missing. Attempting proactive download...`)
        sendGatewayStatus(`Downloading AI Model (${engineModelId})...`)
        const modelDownloaded = await localAIManager.downloadModel(engineModelId)
        if (!modelDownloaded.success) {
          addLog(`[gateway:err] Failed to proactively download model: ${modelDownloaded.error}`)
          return
        }
      }

      // 3. Start the engine (Ollama-first, embedded fallback)
      sendGatewayStatus('Warming up local AI engine...')
      const pollTimer = setInterval(() => {
        if ((localAIManager as any).currentStatusText) {
          sendGatewayStatus((localAIManager as any).currentStatusText)
        }
      }, 500)
      
      let result = await localAIManager.startEngine(targetModelId)
      clearInterval(pollTimer)
      
      // ── AUTO-REPAIR: If engine is missing, download it ──
      if (!result.success && result.errorCode === 'ENGINE_MISSING') {
        addLog(`[gateway:warn] Local engine binary missing. Initiating automatic download...`)
        sendGatewayStatus('Engine missing. Downloading Core AI...')
        const download = await localAIManager.downloadEngine()
        if (download.success) {
           addLog('[gateway] Core AI downloaded. Retrying engine start...')
           result = await localAIManager.startEngine(engineModelId)
        }
      }

      // ── CRITICAL SYNC ──
      // Update config even if merely INITIALIZING (pulling) to ensure port consistency
      if (result.success || result.errorCode === 'INITIALIZING') {
        const activePort = result.port || (result.backend === 'ollama' ? 11434 : 8847)
        addLog(`[gateway] Local AI (${result.backend}) ${result.success ? 'active' : 'booting'} on port ${activePort}`)
        
        try {
          const raw = readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, '')
          const cfg = JSON.parse(raw)
          if (!cfg.models) cfg.models = {}
          if (!cfg.models.providers) cfg.models.providers = {}
          
          if (cfg.models.providers.local) {
            cfg.models.providers.local.baseUrl = `http://127.0.0.1:${activePort}/v1`
            cfg.models.providers.local.models = AVAILABLE_MODELS.map(m => ({ id: m.id, name: m.name }))
            
            writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
            addLog(`[gateway] Sync Complete: Port ${activePort}, Backend: ${result.backend}`)
          }
        } catch (e) {
          addLog(`[gateway:err] Failed to write updated config: ${e}`)
        }
      }
      
      if (!result.success && result.errorCode !== 'INITIALIZING') {
        addLog('[gateway:err] Local AI engine failed to start: ' + localAIManager.getLastError())
      }
      
    } catch (e) {
      addLog('[gateway:err] Failed to verify/start local AI: ' + e)
    }
  }

  private startWatchdog(): void {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval)
    this.watchdogInterval = setInterval(async () => {
      if (this.state === 'running') {
        const alive = await this.verifyGateway()
        if (!alive) {
          addLog('[watchdog] Gateway probe failed — initiating recovery')
          this.restart()
        } else {
          // Cross-check: Is the AI engine still alive on its port?
          try {
            const rawConfig = readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, '')
            const config = JSON.parse(rawConfig)
            const primaryModel = config?.agents?.defaults?.model?.primary || ''
            if (primaryModel.startsWith('local/')) {
              const url = new URL(config.models?.providers?.local?.baseUrl || 'http://127.0.0.1:11434')
              const port = parseInt(url.port)
              if (port) {
                const aiAlive = await localAIManager.waitForServerReady(port, 1000)
                if (!aiAlive) {
                  addLog(`[watchdog] AI Engine (${port}) silent — attempting silent background restart`)
                  this.ensureLocalEngineRunning().catch(() => {})
                }
              }
            }
          } catch { }
        }
      } else if (this.state === 'crashed' || this.state === 'stopped') {
        // Aggressive Auto-Revive: If it's been more than 5 minutes since last restart attempt, try again
        if (Date.now() - this.lastRestartAttempt > 300000 && !isQuitting) {
          addLog('[watchdog] Gateway has been dead too long — forcing auto-revive')
          this.start()
        }
      }
    }, 30000) // Pulse check every 30s
  }

  private _bootInProgress = false

  async start(): Promise<boolean> {
    if (this.state === 'running' || this.state === 'starting') return true
    if (this._bootInProgress) return false
    this._bootInProgress = true

    addTrace('gateway.start() - fast cleanup...')
    sendGatewayStatus('Starting ClawdAsk...')
    await this.cleanupZombies()

    addTrace('gateway.start() - ensuring runtime...')
    const nodeExec = await this.runtime.ensureRuntime()
    addTrace(`Runtime: ${nodeExec}`)
    const bin = this.findBin()
    if (!bin) {
      console.error('[gateway] Binary not found')
      this._bootInProgress = false
      return false
    }

    sendGatewayStatus('Checking for existing gateway...')
    if (await this.verifyGateway()) {
      console.log('[gateway] Existing gateway detected — reusing')
      this.state = 'running'
      this._bootInProgress = false
      // Start engine in background after reuse
      this.ensureLocalEngineRunning().catch(() => {})
      return true
    }

    this.state = 'starting'
    this.ensureEnvironment()
    this.preStartConfigCleanup()
    
    // LOCAL ENGINE STARTS AFTER GATEWAY (non-blocking)
    // The gateway doesn't need the engine to boot — it just needs correct config
    addLog('[gateway] Engine will start after gateway is online.')

    // ── SELF-HEAL: Repair missing build output before spawning ──
    repairGatewayDist()
    
    console.log(`[gateway] Starting: ${bin}`)
    sendGatewayStatus('Booting ClawdAsk Engine...')

    const logPath = join(CLAWDASK_DIR, 'logs', 'gateway_error.log')
    const errorLog = require('fs').createWriteStream(logPath, { flags: 'a' })
    errorLog.write(`\n--- [${new Date().toISOString()}] Starting Gateway ---\n`)

    // ── SELF-HEAL: Port Conflict Resolver ──
    try {
      const isPortTaken = await this.isPortAvailable(this.currentPort)
      if (!isPortTaken) {
        addLog(`[self-heal] Port ${this.currentPort} in use. Finding alternative...`)
        for (let p = 18789; p < 18800; p++) {
          if (await this.isPortAvailable(p)) {
            this.currentPort = p
            addLog(`[self-heal] Migration successful: Using port ${p}`)
            break
          }
        }
      }
    } catch { }

    this.process = spawn(nodeExec, [bin, 'gateway'], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ELECTRON_RUN_AS_NODE: '1',
        PORT: this.currentPort.toString()
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    // ─── Performance: Set Gateway Priority ───
    if (this.process.pid) {
      try {
        const os = require('os')
        const { constants } = os
        os.setPriority(this.process.pid, constants.priority.PRIORITY_ABOVE_NORMAL)
        addLog(`[perf] Gateway priority boosted to Above Normal (PID: ${this.process.pid})`)
      } catch (e) { console.error('[perf] Failed to set gateway priority:', e) }
    }

    this.process.stdout?.on('data', (d: Buffer) => {
      const s = d.toString()
      console.log(`[gateway] ${s.trim()}`)
      if (s.toLowerCase().includes('started') || s.toLowerCase().includes('listening')) {
        sendGatewayStatus('ClawdAsk Engine initialized...')
      }
    })
    this.process.stderr?.on('data', (d: Buffer) => {
      const s = d.toString()
      console.error(`[gateway:err] ${s.trim()}`)
      addLog(`ERROR: ${s}`)
      errorLog.write(s)
    })

    this.process.on('exit', (code) => {
      console.log(`[gateway] Exited (code ${code})`)
      this.process = null
      if (this.state !== 'stopped' && !isQuitting) {
        this.state = 'crashed'
        this.handleCrash()
      }
    })

    this.process.on('error', (err) => {
      console.error('[gateway] Spawn error:', err)
      this.process = null
      this.state = 'crashed'
    })

    sendGatewayStatus('Waiting for secure port allocation...')
    
    // ── RESILIENT PORT ALLOCATION ──
    let readyPort: number | null = null
    let attempts = 0
    // Increased patience for the first boot, especially if AI is downloading
    // 1500 attempts * 1s = 25 minutes. If it takes longer, the user can just wait.
    const maxAttempts = 1500 
    
    while (attempts < maxAttempts) {
      readyPort = await waitForPortRange(GATEWAY_PORT, GATEWAY_PORT + 10, 1000)
      if (readyPort) break
      
      attempts++
      const onboarding = localAIManager.getOnboardingState()
      
      // ── CRITICAL: Check if the process crashed while we were waiting ──
      if ((this.state as string) === 'crashed') {
        const msg = '[gateway:err] Gateway process failed to stay alive during boot.'
        addLog(msg)
        addLog('[gateway:warn] TIP: If the app is in OneDrive/Desktop, it may be corrupting files. Move it to C:\\ClawdAsk.')
        sendGatewayStatus('FATAL_ERROR: The ClawdAsk engine crashed immediately during boot. Please run Diagnostics or check Error Logs.')
        return false
      }

      // If AI is actually doing something (downloading/starting), be verbose
      if (onboarding.progress < 100) {
        const progressText = onboarding.progress > 0 ? ` (${Math.round(onboarding.progress)}%)` : ''
        sendGatewayStatus(`${onboarding.status}${progressText}`)
      } else {
        const bootSeconds = Math.max(1, 10 - attempts)
        sendGatewayStatus(`Digital brain is active! ✨ Launching Dashboard... (~${bootSeconds}s)`)
      }
      
      // Wait before next check
      await new Promise(r => setTimeout(r, 1000))
    }

    if (readyPort) {
      GATEWAY_PORT = readyPort
      GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`
      this.state = 'running'
      this.restartCount = 0
      this._bootInProgress = false
      
      addLog(`[gateway] Port ${GATEWAY_PORT} detected. Gateway is online.`)
      
      // DEFERRED ENGINE START: Now that the dashboard is visible, warm up the AI in background
      this.ensureLocalEngineRunning().catch(e => {
        addLog(`[gateway:err] Background AI initialization problem: ${e}`)
      })
      
      this.startWatchdog()
      this.startTunnelSync()
      this.updateTray()
      sendGatewayStatus('Connected! Handing over to Dashboard...')
      
      // ── CRITICAL: Trigger main window creation immediately ──
      const electron = require('electron')
      if (electron && electron.app) {
        // We emit a custom event or just call the create function if accessible
        // In this architecture, we rely on the renderer detecting the port,
        // but we can force it here if we had a direct reference.
        // For now, setting state to 'running' is the key signal.
      }

      return true
    }
    this._bootInProgress = false
    this.state = 'crashed'
    return false
  }

  stop(): void {
    this.state = 'stopped'
    this.restartCount = 0
    if (this.process) {
      console.log('[gateway] Stopping…')
      if (process.platform === 'win32') {
        try { execSync(`taskkill /pid ${this.process.pid} /f /t`, { stdio: 'ignore', windowsHide: true }) }
        catch { this.process.kill('SIGTERM') }
      } else {
        this.process.kill('SIGTERM')
      }
      this.process = null
    }
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval)
      this.watchdogInterval = null
    }
    this.updateTray()
  }

  private async cleanupZombies(): Promise<void> {
    if (process.platform !== 'win32') return
    // FAST CLEANUP: Only kill the specific process holding our port.
    // Do NOT run slow `taskkill /IM` commands that hang for 20+ seconds.
    try {
      const myPid = process.pid
      addTrace('[proc] Fast port cleanup...')
      
      // Only reclaim the gateway port if something else is holding it
      try {
        const portInfo = execSync(
          `netstat -ano | findstr :${this.currentPort} | findstr LISTENING`,
          { encoding: 'utf-8', windowsHide: true, timeout: 2000 }
        )
        if (portInfo.trim()) {
          const lines = portInfo.trim().split('\n')
          for (const line of lines) {
            const parts = line.trim().split(/\s+/)
            const pid = parseInt(parts[parts.length - 1])
            if (pid && pid !== myPid && pid !== 0) {
              addLog(`[proc] Reclaiming port ${this.currentPort} from PID ${pid}`)
              try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', windowsHide: true, timeout: 2000 }) } catch { }
            }
          }
        }
      } catch { /* port is free, nothing to do */ }
      addTrace('[proc] Port cleanup complete')
    } catch (e) {
      addLog(`[proc] Cleanup warning: ${e}`)
    }
  }

  async restart(): Promise<boolean> {
    this.stop()
    await new Promise(r => setTimeout(r, 1000))
    return this.start()
  }

  private async handleCrash(): Promise<void> {
    const now = Date.now()
    this.lastRestartAttempt = now

    this.state = 'restarting'
    this.restartCount++
    
    // Exponential Backoff: 2s, 4s, 8s, 16s, 32s, maxing out at 60s
    const delay = Math.min(Math.pow(2, this.restartCount) * 1000, 60000)
    
    addLog(`[gateway] Crash detected. Restarting in ${delay/1000}s (Attempt #${this.restartCount})`)
    this.updateTray()
    
    if (this.restartCount > 5) {
      if (tray) {
        tray.displayBalloon({
          title: 'ClawdAsk Resilience',
          content: 'The ClawdAsk engine is struggling to stay alive. We are retrying in the background.'
        })
      }
      sendGatewayStatus('FATAL_ERROR: The engine crashed multiple times. Please run Diagnostics or check Error Logs.')
    }

    await new Promise(r => setTimeout(r, delay))
    if (this.state === 'restarting') await this.start()
  }

  private updateTray(): void { if (tray) createTrayMenu() }

  private verifyGateway(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${this.currentPort}`, (res) => {
        resolve(res.statusCode !== undefined && res.statusCode < 500)
        res.resume()
      })
      req.on('error', () => resolve(false))
      req.setTimeout(5000, () => { req.destroy(); resolve(false) })
    })
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = require('net').createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => { server.close(); resolve(true) })
      server.listen(port, '127.0.0.1')
    })
  }

  findBin(): string | null {
    const { app } = require('electron')
    const possiblePaths = [
      // Standard unpacked locations
      join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'openclaw', 'openclaw.mjs'),
      join(dirname(process.execPath), 'resources', 'app.asar.unpacked', 'node_modules', 'openclaw', 'openclaw.mjs'),
      // Fallbacks
      join(app.getAppPath(), 'node_modules', 'openclaw', 'openclaw.mjs').replace('app.asar', 'app.asar.unpacked'),
      join(homedir(), '.openclaw', 'bin', 'openclaw.mjs')
    ]
    for (const p of possiblePaths) {
      try { 
        if (existsSync(p)) {
          addTrace(`Gateway binary found at: ${p}`)
          return p 
        }
      } catch { }
    }
    addTrace('FATAL: Gateway binary (openclaw.mjs) not found in any standard location.')
    return null
  }
}

const gateway = new GatewayManager()

// ─── Utilities ───────────────────────────────────────────────────────────
function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => { req.destroy(); resolve(false) })
  })
}

async function waitForPortRange(startPort: number, endPort: number, timeoutMs = 30000): Promise<number | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    for (let p = startPort; p <= endPort; p++) {
      if (await checkPort(p)) return p
    }
    await new Promise(r => setTimeout(r, 500))
  }
  return null
}

function isLicenseActive(): boolean {
  const licensePath = join(CLAWDASK_DIR, 'license.json')
  if (!existsSync(licensePath)) return false
  try {
    const license = JSON.parse(readFileSync(licensePath, 'utf-8'))
    // Basic verification for now: check if status is active
    return license.status === 'active' || license.activated === true
  } catch {
    return false
  }
}

function hasValidConfig(): boolean {
  if (!existsSync(CONFIG_PATH)) return false
  try {
    const rawConfig = readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, '')
    const config = JSON.parse(rawConfig)
    const hasProfiles = config?.auth?.profiles && Object.keys(config.auth.profiles).length > 0
    const hasModels = config?.models?.providers && Object.keys(config.models.providers).length > 0
    const hasLegacy = config?.openai || config?.anthropic
    const hasDirect = config?.provider === 'ollama' || config?.provider === 'embedded' || config?.model?.startsWith('ollama/') || config?.model?.startsWith('local/')
    
    return !!(hasProfiles || hasModels || hasLegacy || hasDirect)
  } catch {
    return false
  }
}

const getIsDev = (): boolean => {
  const { app } = require('electron')
  return !app.isPackaged
}

function cleanConfig(config: any): any {
  if (!config) return {}
  delete config.providers
  if (config.auth) {
    const allowed = [
      'profiles', 'openai', 'anthropic', 'google', 'groq', 'mistral',
      'together', 'openrouter', 'deepseek', 'xai', 'edge'
    ]
    Object.keys(config.auth).forEach(key => {
      if (!allowed.includes(key) && !key.startsWith('lmstudio')) {
        delete config.auth[key]
      }
    })
  }
  return config
}

function getAutoStartEnabled(): boolean {
  if (process.platform !== 'win32') return false
  try {
    const result = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v ClawdAsk', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    return result.includes('ClawdAsk')
  } catch { return false }
}

function setAutoStart(enabled: boolean): void {
  if (process.platform !== 'win32') return
  const { app } = require('electron')
  if (!app) return
  try {
    if (enabled) {
      const exePath = app.getPath('exe')
      execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v ClawdAsk /t REG_SZ /d "\\"${exePath}\\" --minimized" /f`, { stdio: 'ignore' })
    } else {
      execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v ClawdAsk /f', { stdio: 'ignore' })
    }
  } catch { /* ignore */ }
}

// ─── Splash Screen (Deprecated, using Onboarding UI) ──────

// ─── Onboarding ─────────────────────────────────────────────────────────
function createOnboardingWindow(): void {
  try {
    addTrace('createOnboardingWindow() entry')
    const electron = require('electron')
    if (!electron) { addTrace('createOnboardingWindow: electron module is missing'); return }
    const { BrowserWindow } = electron
    
    addTrace('Initializing BrowserWindow for onboarding...')
    onboardingWindow = new BrowserWindow({
      width: 520, height: 620, frame: false, resizable: false, transparent: true,
      icon: join(__dirname, '../../resources/icon.png'),
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
    })
    addTrace('BrowserWindow created.')

    if (getIsDev() && process.env['ELECTRON_RENDERER_URL']) {
      addTrace(`Loading URL: ${process.env['ELECTRON_RENDERER_URL']}`)
      onboardingWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      const url = join(__dirname, '../renderer/index.html')
      addTrace(`Loading File: ${url}`)
      onboardingWindow.loadFile(url)
    }
  } catch (e) {
    addTrace(`FATAL in createOnboardingWindow: ${e}`)
    logCrash(e)
  }

  // ─── PREMIUM ONBOARDING INJECTION ───
  onboardingWindow.webContents.on('did-finish-load', () => {
    const tips = localAIManager.getOnboardingState().tips
    const injection = `
      (function() {
        const TIPS = ${JSON.stringify(tips)};
        let tipIdx = 0;
        
        // Find elements (based on screenshot architecture)
        const statusEl = document.querySelector('.status-text') || document.querySelector('p');
        const quoteEl = document.querySelector('.quote') || document.querySelector('i') || document.querySelector('.footer-text');
        
        function rotateTip() {
          if (!quoteEl) return;
          quoteEl.style.opacity = '0';
          setTimeout(() => {
            quoteEl.textContent = '"' + TIPS[tipIdx] + '"';
            quoteEl.style.opacity = '1';
            tipIdx = (tipIdx + 1) % TIPS.length;
          }, 500);
        }
        
        if (quoteEl) {
           quoteEl.style.transition = 'opacity 0.5s ease';
           rotateTip();
           setInterval(rotateTip, 8000);
        }

        // Bridge status updates to the UI more prominently
        window.addEventListener('message', (event) => {
          if (event.data?.type === 'gateway-status-update') {
            const msg = event.data.msg;
            if (statusEl) statusEl.textContent = msg;
          }
        });
      })();
    `
    onboardingWindow.webContents.executeJavaScript(injection)
  })

  onboardingWindow.on('closed', () => { onboardingWindow = null })
}

// ─── Quick Setup Window (Removed - Handled by App.vue) ────
// ─── Main Window ────────────────────────────────────────────────────────
function createMainWindow(): void {
  const electron = require('electron')
  if (!electron) return
  const { BrowserWindow } = electron
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      webSecurity: false // Systemic: Required for cross-origin local AI dashboard calls
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
    if (onboardingWindow && !onboardingWindow.isDestroyed()) onboardingWindow.close()
  })

  // ─── STALL PREVENTION: Force show if ready-to-show takes > 5s ───
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
      if (onboardingWindow && !onboardingWindow.isDestroyed()) onboardingWindow.close()
    }
  }, 5000)

  mainWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow?.hide() }
  })

  mainWindow.on('closed', () => { mainWindow = null })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const electron = require('electron')
    if (electron) electron.shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // ── SELF-HEALING TOKEN: Ensure the dashboard always loads authenticated ──
  const gatewayToken = ensureGatewayToken()
  let initialUrl = GATEWAY_URL
  if (gatewayToken) {
    initialUrl += `?token=${gatewayToken}`
  }
  addTrace(`[main-window] Loading: ${GATEWAY_URL} (token: ${gatewayToken ? 'present' : 'MISSING'})`)

  mainWindow.loadURL(initialUrl)

  const injectBranding = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const brandingCSS = `
      /* ── Hide OpenClaw onboarding wizard (we have our own) ── */
      div[class*="SetupWizard"], div[class*="Onboarding"] { display: none !important; }

      /* Override gateway logo CSS selectors */
      [alt="ClawdAsk Logo"], .openclaw-logo, img[src*="logo"], svg:has(path[d*="M12 2A10 10 1"]), 
      svg[viewBox="0 0 24 24"]:has(path[d^="M12 2L4.5 20.29L5.21 21L12 18L18.79 21L19.5 20.29L12 2Z"]) {
        display: none !important;
      }

      /* ── Premium deep black & orange theme override ── */
      :root {
        --bg-primary: #000000 !important;
        --bg-secondary: #050505 !important;
        --bg-tertiary: #0a0a0a !important;
        --bg-quaternary: #111111 !important;
        --text-primary: #ffffff !important;
        --text-secondary: #a0a0a0 !important;
        --text-tertiary: #666666 !important;
        --accent-primary: #f97316 !important; /* Orange */
        --accent-secondary: #fb923c !important; /* Lighter Orange */
        --border-color: rgba(255,255,255,0.08) !important;
        --border-color-hover: rgba(249, 115, 22, 0.2) !important;
        
        /* ── Specific OpenClaw Overrides ── */
        --color-background: var(--bg-primary) !important;
        --color-surface: var(--bg-secondary) !important;
        --color-surface-hover: var(--bg-tertiary) !important;
        --color-primary: var(--accent-primary) !important;
        --color-text: var(--text-primary) !important;
        --color-text-muted: var(--text-secondary) !important;
        --color-border: var(--border-color) !important;
        --sidebar-bg: var(--bg-primary) !important;

        /* ClawdAsk Theme Variables */
        --accent: #f97316 !important;
        --primary: #f97316 !important;
        --ring: #f97316 !important;
        --accent-glow: transparent !important; /* NO NEON */
        
        /* Radix / UI Lib specific overrides */
        --orange-9: #f97316 !important;
        --orange-10: #fb923c !important;
        --blue-9: #f97316 !important; /* Override all blues to orange */
        --blue-10: #fb923c !important;
        --red-9: #f97316 !important;
        --red-10: #fb923c !important;
      }

      /* ── Hardcode background elements ── */
      body, html, #root, #app, main, .app-container {
        background-color: var(--bg-primary) !important;
        color: var(--text-primary) !important;
        font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif !important;
      }
      
      nav, aside {
        background-color: var(--bg-secondary) !important;
        border-right: 1px solid var(--border-color) !important;
      }
      
      header {
        background-color: var(--bg-secondary) !important;
        border-bottom: 1px solid var(--border-color) !important;
      }

      /* ── Aggressive Color Overrides ── */
      .text-orange-500, .text-orange-600, .bg-orange-500, .bg-orange-600, 
      .text-red-500, .text-red-600, .bg-red-500, .bg-red-600,
      .text-blue-500, .text-blue-600, .bg-blue-500, .bg-blue-600 {
        color: #f97316 !important;
        background-color: #f97316 !important;
      }
      
      [class*="accent"], [class*="primary"], [class*="active"], [class*="Button"][class*="primary"] {
        color: #ffffff !important;
        background-color: #f97316 !important;
        border-color: #f9731666 !important;
        --accent: #f97316 !important;
        --ring: #f97316 !important;
        --primary: #f97316 !important;
        --accent-hover: #fb923c !important;
        --accent-glow: transparent !important; /* NO NEON */
      }

      /* ── Button aesthetics ── */
      button {
        border-radius: 8px !important;
      }
      button.primary, button[type="submit"], .chat-send-btn, .btn.primary {
        background-color: #f97316 !important;
        color: #ffffff !important;
        font-weight: 600 !important;
        transition: all 0.2s ease !important;
      }
      
      /* ── Dynamic "Thinking" Animation (Flat, No Neon) ── */
      @keyframes sky-pulse-flat {
        0% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.05); opacity: 0.8; }
        100% { transform: scale(1); opacity: 1; }
      }
      
      .chat-send-btn.is-thinking {
        animation: sky-pulse-flat 1.5s infinite ease-in-out !important;
        background-color: #f43f5e !important; /* Flat Rose for Stop */
      }

      /* ── Card & Input aesthetics ── */
      .card, div[class*="Card"], div[class*="Container"], input, textarea, select {
        background-color: var(--bg-tertiary) !important;
        border: 1px solid var(--border-color) !important;
        color: var(--text-primary) !important;
        border-radius: 12px !important;
      }
      input:focus, textarea:focus {
        border-color: #f97316 !important;
        outline: none !important;
        box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.1) !important;
      }
      
      /* ── Scrollbars ── */
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(249, 115, 22, 0.1); border-radius: 4px; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(249, 115, 22, 0.2); }
    `
    if (!mainWindow.isDestroyed()) mainWindow.webContents.insertCSS(brandingCSS)

    const brandingScript = `
      (function() {
        const REPLACEMENT_MAP = [
          { regex: /OpenClaw/g, replacement: 'ClawdAsk' },
          { regex: /OPENCLAW/g, replacement: 'CLAWDASK' },
          { regex: /OpenClaw/g, replacement: 'ClawdAsk' },
          { regex: /Assistant/g, replacement: 'ClawdAsk' },
          { regex: /Message OpenClaw/g, replacement: 'Message ClawdAsk' },
          { regex: /Send a message to OpenClaw/g, replacement: 'Send a message to ClawdAsk' },
          { regex: /OpenClaw is an open source/g, replacement: 'ClawdAsk is a premium' },
          { regex: /About OpenClaw/g, replacement: 'About ClawdAsk' },
          { regex: /Connect to OpenClaw/g, replacement: 'Connect to ClawdAsk' }
        ];

        function applyReplacements(text) {
          if (!text) return text;
          let newText = text;
          for (const [regex, replacement] of REPLACEMENT_MAP) {
            newText = newText.replace(regex, replacement);
          }
          return newText;
        }

        function rebrand(root = document.body) {
          if (document.title.includes('ClawdAsk')) {
            document.title = applyReplacements(document.title);
          }

          const targetSelectors = 'h1, h2, h3, h4, [class*="brand"], [class*="logo"], [class*="title"], [class*="header"], span, a, p, button, label, li, strong, b, div';
          root.querySelectorAll(targetSelectors).forEach(el => {
            if (el.childNodes.length > 0) {
              el.childNodes.forEach(child => {
                if (child.nodeType === Node.TEXT_NODE && child.textContent.trim() !== '') {
                  const oldText = child.textContent;
                  const newText = applyReplacements(oldText);
                  if (oldText !== newText) child.textContent = newText;
                }
              });
            }
          });

          root.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
            const oldText = el.placeholder;
            const newText = applyReplacements(oldText);
            if (oldText !== newText) el.placeholder = newText;
          });

          root.querySelectorAll('img[src*="logo"], img[alt*="OpenClaw"], img[alt*="openclaw"], svg[class*="logo"]').forEach(img => {
            if (img.parentElement && !img.dataset.branded) {
              img.dataset.branded = 'true';
              img.style.display = 'none';
              const brandContainer = document.createElement('div');
              brandContainer.style.cssText = 'display:flex;align-items:center;gap:8px;';
              const brandIcon = document.createElement('div');
              brandIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="24" height="24"><rect x="10" y="10" width="12" height="12" rx="2" fill="#7c2d12"/><rect x="10" y="22" width="12" height="12" rx="2" fill="#c2410c"/><rect x="22" y="22" width="12" height="12" rx="2" fill="#f97316"/><rect x="10" y="34" width="12" height="12" rx="2" fill="#c2410c"/><rect x="22" y="34" width="12" height="12" rx="2" fill="#f97316"/><rect x="34" y="34" width="12" height="12" rx="2" fill="#fb923c"/><rect x="10" y="46" width="12" height="12" rx="2" fill="#7c2d12"/><rect x="22" y="46" width="12" height="12" rx="2" fill="#c2410c"/><rect x="34" y="46" width="12" height="12" rx="2" fill="#f97316"/><rect x="106" y="10" width="12" height="12" rx="2" fill="#7c2d12"/><rect x="106" y="22" width="12" height="12" rx="2" fill="#c2410c"/><rect x="94" y="22" width="12" height="12" rx="2" fill="#f97316"/><rect x="106" y="34" width="12" height="12" rx="2" fill="#c2410c"/><rect x="94" y="34" width="12" height="12" rx="2" fill="#f97316"/><rect x="82" y="34" width="12" height="12" rx="2" fill="#fb923c"/><rect x="106" y="46" width="12" height="12" rx="2" fill="#7c2d12"/><rect x="94" y="46" width="12" height="12" rx="2" fill="#c2410c"/><rect x="82" y="46" width="12" height="12" rx="2" fill="#f97316"/><rect x="34" y="58" width="12" height="12" rx="2" fill="#c2410c"/><rect x="46" y="58" width="12" height="12" rx="2" fill="#f97316"/><rect x="82" y="58" width="12" height="12" rx="2" fill="#c2410c"/><rect x="70" y="58" width="12" height="12" rx="2" fill="#f97316"/><rect x="34" y="70" width="60" height="16" rx="3" fill="#f97316"/><rect x="38" y="72" width="52" height="4" rx="2" fill="#fb923c" opacity="0.6"/><rect x="40" y="86" width="48" height="14" rx="3" fill="#c2410c"/><rect x="48" y="100" width="32" height="12" rx="3" fill="#7c2d12"/><rect x="56" y="112" width="16" height="8" rx="3" fill="#431407"/><rect x="12" y="12" width="4" height="4" rx="1" fill="#fb923c" opacity="0.5"/><rect x="108" y="12" width="4" height="4" rx="1" fill="#fb923c" opacity="0.5"/></svg>';
              const brandText = document.createElement('span');
              brandText.textContent = 'ClawdAsk';
              brandText.style.cssText = 'font-weight:700;font-size:18px;letter-spacing:-0.5px;color:#fff;font-family:\"Inter\",sans-serif;margin-left:4px;';
              brandContainer.appendChild(brandIcon);
              brandContainer.appendChild(brandText);
              img.parentElement.insertBefore(brandContainer, img);
            }
          });

          // Simplify the UI by hiding only purely diagnostic/unnecessary settings
          const complexLabels = ['Last start', 'Last probe', 'Probe ok', 'Ack Reaction', 'Auth age'];
          root.querySelectorAll('span, label, p, div').forEach(el => {
            if (el.childNodes.length === 1 && el.childNodes[0].nodeType === Node.TEXT_NODE) {
              const text = el.textContent.trim();
              if (complexLabels.includes(text)) {
                // Find parent row container and hide it
                const row = el.closest('.flex.items-center.justify-between, [class*="row"], .mb-4');
                if (row && row.style.display !== 'none') {
                  row.style.display = 'none';
                } else if (!row && el.parentElement && el.parentElement.style.display !== 'none') {
                  el.parentElement.style.display = 'none';
                }
              }
            }
          });
        }

        rebrand();
        setInterval(rebrand, 2000); 

        const observer = new MutationObserver(() => rebrand());
        observer.observe(document.body, { childList: true, subtree: true });
      })();
    `
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(brandingScript).catch(() => {});
    }
  };

  mainWindow.webContents.on('did-finish-load', injectBranding);
  mainWindow.webContents.on('did-navigate', injectBranding);
  mainWindow.webContents.on('did-frame-finish-load', injectBranding);
  
  // Initial injection attempt
  injectBranding();

  // ─── Gateway Token Injection ───
  // Automatically authorize the dashboard using the token from clawdask.json
  try {
    if (existsSync(CONFIG_PATH)) {
      const rawConfig = readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, '')
      const config = JSON.parse(rawConfig);
      const token = config.gateway?.auth?.token;
      if (token) {
        const tokenScript = `
            (function() {
              const TOKEN = "${token}";
              
              // 1. Force into Storage
              const keys = ["openclaw-token", "gateway-token", "token"];
              keys.forEach(k => {
                localStorage.setItem(k, TOKEN);
                sessionStorage.setItem(k, TOKEN);
              });

              // 2. Auto-Fill and Click (if UI is visible and shows "Unauthorized" or "Token Required")
              function attemptAutoConnect() {
                // Check for token input fields and fill them
                const tokenInputs = document.querySelectorAll('input[type="password"], input[type="text"][placeholder*="token"], input[type="text"][placeholder*="key"]');
                tokenInputs.forEach(input => {
                  if (!input.value || input.value.length < 5) { // Only fill if empty or very short
                    input.value = TOKEN;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                });

                // Find the Connect/Authorize button
                const buttons = document.querySelectorAll('button');
                buttons.forEach(btn => {
                  const text = (btn.textContent || "").toLowerCase();
                  if (text.includes("connect") || text.includes("login") || text.includes("authorize") || text.includes("save")) {
                    btn.click();
                  }
                });
              }

              // Run immediately and then poll a few times as the app mounts
              setTimeout(attemptAutoConnect, 1000);
              setTimeout(attemptAutoConnect, 3000);
              setTimeout(attemptAutoConnect, 5000);
            })();
          `;
          addTrace(`[auth] Injecting automation script (token: ${token.substring(0, 5)}...)`)
          mainWindow?.webContents.executeJavaScript(tokenScript);
        }
      }
    } catch (e) {
      addLog(`[auth:err] Failed to inject gateway token: ${e}`);
    }
  // This was the misplaced `})`
  mainWindow.webContents.on('did-fail-load', (_event, _errorCode, _errorDescription) => {
    addLog('[ui:err] Failed to load gateway URL. Retrying in 3 seconds...')
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        let retryUrl = GATEWAY_URL
        try {
          if (existsSync(CONFIG_PATH)) {
            const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
            const token = config.gateway?.auth?.token
            if (token) retryUrl += `?token=${token}`
          }
        } catch {}
        mainWindow.loadURL(retryUrl)
      }
    }, 3000)
  })
}

// ─── System Tray ────────────────────────────────────────────────────────
function createTray(): void {
  const electron = require('electron')
  if (!electron) return
  const { nativeImage, Tray } = electron
  const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARklEQVQ4y2NgGAUowMjIyMDAwMBwHpcCFgYGBgVcGpiwKWBiYGBQwKeBBZsCJnwaWHBpYMKlATkQ8WlgwaeBBZ8GFnwOAQBYjAf3C2TzlgAAAABJRU5ErkJggg==')
  tray = new Tray(icon)
  tray.setToolTip('ClawdAsk')
  createTrayMenu()
  tray.on('double-click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show(); mainWindow.focus()
    } else if (onboardingWindow && !onboardingWindow.isDestroyed()) {
      onboardingWindow.show(); onboardingWindow.focus()
    } else {
      if (hasValidConfig()) createMainWindow()
      else createOnboardingWindow()
    }
  })
}

function createTrayMenu(): void {
  if (!tray) return
  const electron = require('electron')
  if (!electron) return
  const { Menu, shell, dialog, app } = electron
  const labels: any = { 
    stopped: '⚫ Stopped (Manual)', 
    starting: '🟡 Starting Engine...', 
    running: '⚪ Online & Ready', 
    crashed: '🔴 Recovering...', 
    restarting: '🟡 Reconnecting...' 
  }
  
  const menu = Menu.buildFromTemplate([
    { 
      label: 'Open ClawdAsk', 
      click: () => { 
        if (mainWindow && !mainWindow.isDestroyed()) { 
          mainWindow.show(); mainWindow.focus() 
        } else if (onboardingWindow && !onboardingWindow.isDestroyed()) {
          onboardingWindow.show(); onboardingWindow.focus()
        } else { 
          if (hasValidConfig()) createMainWindow()
          else createOnboardingWindow()
        } 
      } 
    },
    { type: 'separator' },
    { label: `Status: ${labels[gateway.currentState]}`, enabled: false },
    { label: 'Restart Gateway', click: async () => { await gateway.restart() } },
    { type: 'separator' },
    { label: 'Open Error Logs', click: () => { shell.openPath(join(CLAWDASK_DIR, 'logs', 'gateway_error.log')) } },
    { label: 'Help: Cloud Path Issue?', click: () => { shell.openExternal('https://github.com/clawdask/clawdask/wiki/Troubleshooting#cloud-paths') } },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: getAutoStartEnabled(), click: (i: any) => setAutoStart(i.checked) },
    { type: 'separator' },
    { label: 'About ClawdAsk', click: () => { dialog.showMessageBox({ type: 'info', title: 'About ClawdAsk', message: 'ClawdAsk', detail: 'Your Private AI Desktop.\n\nhttps://clawdask.app', buttons: ['OK'] }) } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; gateway.stop(); app.quit() } }
  ])
  tray.setContextMenu(menu)
}

// ─── IPC ────────────────────────────────────────────────────────────────
function setupIPC(): void {
  const electron = require('electron')
  if (!electron) return
  const { ipcMain } = electron
  // Resilience: Guard against double-handler assignment
  const safeHandle = (channel: string, listener: any) => {
    try { ipcMain.removeHandler(channel) } catch { }
    ipcMain.handle(channel, listener)
  }

  safeHandle('check-clawdask', async () => ({ 
    installed: !!gateway.findBin(), 
    path: gateway.findBin(), 
    isGatewayStarting: gateway.currentState === 'starting' || gateway.currentState === 'running',
    hasValidConfig: hasValidConfig(),
    isLicenseActive: isLicenseActive()
  }))
  safeHandle('get-onboarding-state', async () => localAIManager.getOnboardingState())
  safeHandle('retry-engine-setup', async () => {
    gateway.ensureLocalEngineRunning().catch(e => addLog(`[gateway:err] Manual AI retry failed: ${e}`))
    return true
  })
  safeHandle('save-config', async (_e, c: any) => {
    try {
      if (!existsSync(CLAWDASK_DIR)) mkdirSync(CLAWDASK_DIR, { recursive: true })
      let ex: any = {}; try { ex = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) } catch { }

      const providerKey = (c.provider === 'embedded' || c.provider === 'local') ? 'local' : (c.provider === 'custom' ? 'openai' : c.provider)
      const profileId = `${providerKey}:default`
      
      // Official Schema: Profile only has mode and provider
      const authProfile: any = { mode: 'api_key', provider: providerKey }
      if (c.agentName && c.agentName.trim().length > 0) {
        addLog(`[config] Note: Agent name '${c.agentName.trim()}' is handled by SOUL.md`)
      }
      
      // Determine the correct API protocol per provider
      // Only OpenAI and Anthropic support the Responses API; everything else uses Completions
      const RESPONSES_API_PROVIDERS = ['openai', 'anthropic', 'google', 'bedrock']
      const apiProtocol = RESPONSES_API_PROVIDERS.includes(providerKey) ? 'openai-responses' : 'openai-completions'

      // Per-provider base URLs (must match gateway native defaults)
      const PROVIDER_BASE_URLS: Record<string, string> = {
        openai:    'https://api.openai.com/v1',
        anthropic: 'https://api.anthropic.com/v1',
        google:    'https://generativelanguage.googleapis.com/v1beta',
        moonshot:  'https://api.moonshot.ai/v1',
        deepseek:  'https://api.deepseek.com/v1',
        groq:      'https://api.groq.com/openai/v1',
        mistral:   'https://api.mistral.ai/v1',
        xai:       'https://api.x.ai/v1',
        together:  'https://api.together.xyz/v1',
        openrouter:'https://openrouter.ai/api/v1',
        bedrock:   'https://bedrock-runtime.us-east-1.amazonaws.com',
      }

      // Protocol details go into models.providers
      const providerConfig: any = { 
        apiKey: c.apiKey || 'local-embedded',
        models: (c.provider === 'embedded' || c.provider === 'local' || providerKey === 'ollama') ? AVAILABLE_MODELS.map(m => ({ id: m.id, name: m.name })) : []
      }
      
      const nativeProviders = ['google', 'anthropic', 'openai'];
      if (!nativeProviders.includes(providerKey)) {
        providerConfig.api = apiProtocol;
        providerConfig.baseUrl = c.baseUrl || PROVIDER_BASE_URLS[providerKey] || 'https://api.openai.com/v1';
      }

      if (providerKey === 'ollama') {
        providerConfig.apiKey = 'ollama-local'
        providerConfig.baseUrl = c.baseUrl || 'http://127.0.0.1:11434'
      } else if (c.provider === 'embedded' || c.provider === 'local') {
        providerConfig.apiKey = 'local-embedded'
        // Port will be dynamically updated by ensureLocalEngineRunning based on detected backend
        providerConfig.baseUrl = c.baseUrl || 'http://127.0.0.1:11434/v1'
      } else {
         providerConfig.apiKey = c.apiKey
      }

      const final = {
        ...ex,
        auth: {
          ...ex.auth,
          profiles: {
            ...ex.auth?.profiles,
            [profileId]: authProfile
          }
        },
        models: {
          ...ex.models,
          providers: {
            ...ex.models?.providers,
            [providerKey]: providerConfig
          }
        },
        tools: {
          profile: c.enableComputerControl !== false ? 'coding' : 'messaging',
          allow: c.enableWebBrowser !== false ? ['browser', 'web_search', 'web_fetch'] : undefined
        },
        gateway: {
          mode: 'local',
          port: GATEWAY_PORT,
          bind: 'loopback',
          auth: { mode: 'token', token: ex.gateway?.auth?.token || generateToken() }
        },
        agents: {
          ...ex.agents,
          defaults: {
            ...ex.agents?.defaults,
            timeoutSeconds: ex.agents?.defaults?.timeoutSeconds || 3600,
            model: c.model ? { primary: c.model } : ex.agents?.defaults?.model,
            sandbox: { mode: (c.enableSandbox && existsSync('C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe')) ? 'all' : 'off' }
          }
        },
        channels: {
          ...ex.channels,
          whatsapp: {
            enabled: true,
            dmPolicy: c.dmPolicy || 'pairing',
            allowFrom: (c.dmPolicy === 'open') ? ['*'] : ((c.dmPolicy === 'allowlist' && c.allowFrom) ? c.allowFrom.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined),
            groupPolicy: 'open'
          }
        },
        messages: {
          ...ex.messages,
          tts: {
            auto: c.enableTTS ? 'always' : 'off',
            provider: c.ttsProvider || 'edge'
          }
        }
      }

      // Add Telegram/Discord if tokens provided
      if (c.telegramToken) {
        (final as any).channels.telegram = { 
          enabled: true, 
          botToken: c.telegramToken, 
          dmPolicy: c.dmPolicy || 'pairing',
          allowFrom: (c.dmPolicy === 'open') ? ['*'] : ((c.dmPolicy === 'allowlist' && c.allowFrom) ? c.allowFrom.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined)
        }
      }
      if (c.discordToken) {
        (final as any).channels.discord = { enabled: true, botToken: c.discordToken }
      }

      // Personality: write SOUL.md template
      const templates: Record<string, string> = {
        pro: 'You are a precise, professional assistant. Respond formally with clear, actionable answers. Prioritize accuracy.',
        casual: 'You are a friendly, casual helper. Use conversational tone, emojis occasionally, and be warm and approachable.',
        creative: 'You are an imaginative, creative thinker. Use vivid language, metaphors, and think outside the box.',
        coder: 'You are a focused software architect. Prioritize code quality, explain with examples, and think systematically.'
      }
      const soulContent = templates[c.personalityTemplate] || templates.pro
      const soulPath = join(CLAWDASK_DIR, 'SOUL.md')
      writeFileSync(soulPath, `# ClawdAsk Agent Personality\n\n${soulContent}\n`)
      addLog(`[personality] Set to: ${c.personalityTemplate || 'pro'}`)

      // Clean up gateway logic
      delete (final as any).providers
      delete (final as any)._onboardingTemplate
      const cleaned = cleanConfig(final)
      writeFileSync(CONFIG_PATH, JSON.stringify(cleaned, null, 2))
      addLog('[config] Saved and cleaned')
      return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  // ─── API Key Management ───
  safeHandle('save-api-key', async (_e, provider: string, key: string) => {
    try {
      const authPath = join(CLAWDASK_DIR, 'agents', 'main', 'agent', 'auth-profiles.json')
      const authDir = dirname(authPath)
      if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true })
      
      let config: any = {}
      if (existsSync(authPath)) {
        try { config = JSON.parse(readFileSync(authPath, 'utf-8')) } catch { }
      }
      
      config[provider] = config[provider] || {}
      config[provider].default = config[provider].default || {}
      config[provider].default.apiKey = key
      
      writeFileSync(authPath, JSON.stringify(config, null, 2))
      addLog(`[auth] Securely stored API key for ${provider}`)
      
      // If gateway is running, it might need a restart to pick up new agent keys
      // though openclaw often re-reads them. We'll suggest a restart if needed.
      return { success: true }
    } catch (e: any) {
      addLog(`[auth:err] Failed to save key: ${e.message}`)
      return { success: false, error: e.message }
    }
  })

  safeHandle('get-local-ai-status', async (_e, modelId: string) => {
    return {
      engineInstalled: localAIManager.isEngineInstalled(),
      modelInstalled: localAIManager.isModelInstalled(modelId)
    }
  })

  safeHandle('get-all-local-ai-status', async () => {
    return {
      engineInstalled: localAIManager.isEngineInstalled(),
      models: localAIManager.getAllModelsStatus()
    }
  })

  safeHandle('detect-local-backend', async () => {
    return await localAIManager.detectBestBackend()
  })

  safeHandle('verify-model-integrity', async (_e, modelId: string) => {
    return localAIManager.verifyModelIntegrity(modelId)
  })

  safeHandle('check-disk-space', async (_e, requiredBytes: number) => {
    return localAIManager.checkDiskSpace(requiredBytes)
  })

  safeHandle('download-local-engine', async (e) => {
    const result = await localAIManager.downloadEngine((percent, text) => {
      e.sender.send('local-ai-download-progress', { type: 'engine', percent, text })
    })
    return result // Now returns { success, error?, errorCode? }
  })

  safeHandle('download-local-model', async (e, modelId: string, force = false) => {
    const result = await localAIManager.downloadModel(modelId, (percent, text) => {
      e.sender.send('local-ai-download-progress', { type: 'model', modelId, percent, text })
    }, force)
    return result 
  })

  safeHandle('open-whop-checkout', async (_e, url: string) => {
    try {
      const { shell } = require('electron')
      shell.openExternal(url)
      return { success: true }
    } catch (err) { return { success: false, error: String(err) } }
  })

  safeHandle('validate-whop-license', async (_e, key: string) => {
    try {
      if (!key || key.length < 10) {
        return { success: false, error: 'Invalid license key format.' }
      }
      
      const whopApiKey = process.env.WHOP_API_KEY || 'YOUR_WHOP_API_KEY_HERE';
      if (whopApiKey !== 'YOUR_WHOP_API_KEY_HERE') {
        const res = await fetch(`https://api.whop.com/api/v2/memberships/${key}`, { 
          headers: { 
            Authorization: `Bearer ${whopApiKey}`,
            accept: 'application/json'
          }
        });
        
        if (!res.ok) {
           return { success: false, error: 'Invalid or expired Whop license key.' }
        }
        
        const data = await res.json();
        if (data.status !== 'active') {
          return { success: false, error: 'License is not active on Whop.' }
        }
      }
      
      // Save valid license
      const licensePath = join(CLAWDASK_DIR, 'license.json')
      const licenseData = {
        status: 'active',
        key: key,
        activated_at: new Date().toISOString()
      }
      writeFileSync(licensePath, JSON.stringify(licenseData, null, 2))
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  safeHandle('check-license', async () => {
    const licensePath = join(CLAWDASK_DIR, 'license.json')
    if (existsSync(licensePath)) {
      try {
        const license = JSON.parse(readFileSync(licensePath, 'utf-8'))
        return { 
          activated: license.status === 'active' || license.activated === true,
          email: license.email,
          key: license.key
        }
      } catch { }
    }
    return { activated: false }
  })

  safeHandle('open-link', async (_e, url: string) => {
    const { shell } = require('electron')
    if (shell) shell.openExternal(url)
  })

  safeHandle('get-auth-token', async () => {
    try {
      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, ''))
      return config.gateway?.auth?.token || ''
    } catch { return '' }
  })

  safeHandle('verify-local-trust', async (event) => {
    const sender = event.sender
    const url = sender.getURL()
    // Trust requests originating from our own loopback gateway
    if (url.startsWith('http://127.0.0.1:18789') || url.startsWith('http://localhost:18789')) {
      addTrace('[auth] Verified local trust for internal dashboard')
      return true
    }
    return false
  })

  safeHandle('get-specs', async () => {
    return new Promise((resolve) => {
      const os = require('os')
      const totalMem = os.totalmem()
      try {
        require('child_process').exec('wmic path win32_VideoController get AdapterRAM', (err: any, stdout: string) => {
          let vram = 0
          if (!err && stdout) {
            const lines = stdout.split('\n').map((l: string) => l.trim()).filter((l: string) => l && !l.includes('AdapterRAM'))
            for (const line of lines) {
              const val = parseInt(line, 10)
              if (!isNaN(val) && val > vram) vram = val
            }
          }
          resolve({ totalMem, vram })
        })
      } catch {
        resolve({ totalMem, vram: 0 })
      }
    })
  })

  safeHandle('get-logs', async () => LOG_BUFFER.join('\n'))

  ipcMain.on('open-logs-folder', () => {
    const electron = require('electron')
    if (electron) electron.shell.openPath(join(CLAWDASK_DIR, 'logs'))
  })

  // Multi-Channel: WhatsApp Linking
  safeHandle('link-whatsapp', async () => {
    const bin = gateway.findBin()
    if (!bin) return { success: false, error: 'Binary not found' }

    return new Promise((resolve) => {
      const proc = spawn(process.execPath, [bin, 'channels', 'login', 'whatsapp'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true
      })

      let qrDetected = false
      proc.stdout?.on('data', (d) => {
        const s = d.toString()
        addLog(`[whatsapp] ${s}`)
        // Detect QR pattern or 'QR Code' string
        if (s.includes('QR') || s.length > 100) {
          qrDetected = true
          if (mainWindow) mainWindow.webContents.send('whatsapp-qr', s)
        }
      })

      proc.on('close', (code) => {
        resolve({ success: code === 0, qrDetected })
      })
    })
  })
  safeHandle('check-model', async (_e, modelName: string) => {
    try {
      const { execSync } = require('child_process')
      let ollamaInstalled = false
      try {
        execSync('ollama --version', { shell: true, stdio: 'ignore', windowsHide: true })
        ollamaInstalled = true
      } catch {}

      if (!ollamaInstalled) {
        return { ollamaInstalled: false, ollamaRunning: false, exists: false }
      }

      const resp = await fetch('http://127.0.0.1:11434/api/tags')
      if (!resp.ok) return { ollamaInstalled: true, ollamaRunning: false, exists: false, error: 'Ollama not responding' }
      const data: any = await resp.json()
      const models = data.models || []
      const exists = models.some((m: any) => {
        const n = (m.name || '').toLowerCase()
        const search = modelName.toLowerCase()
        return n === search || n === search + ':latest' || n.startsWith(search + ':')
      })
      return { ollamaInstalled: true, ollamaRunning: true, exists, models: models.map((m: any) => m.name) }
    } catch (e: any) { return { ollamaInstalled: true, ollamaRunning: false, exists: false, error: e.message } }
  })

  safeHandle('list-models', async () => {
    try {
      const resp = await fetch('http://127.0.0.1:11434/api/tags')
      if (!resp.ok) return { ollamaRunning: false, models: [] }
      const data: any = await resp.json()
      return { ollamaRunning: true, models: (data.models || []).map((m: any) => m.name) }
    } catch (e: any) { return { ollamaRunning: false, models: [], error: e.message } }
  })

  safeHandle('pull-model', async (event, modelName: string) => {
    try {
      const resp = await fetch('http://127.0.0.1:11434/api/pull', {
        method: 'POST',
        body: JSON.stringify({ name: modelName })
      })

      if (!resp.body) throw new Error('Failed to start pull stream')
      const reader = resp.body.getReader()
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = new TextDecoder().decode(value)
        const lines = chunk.split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const data = JSON.parse(line)
            event.sender.send('pull-progress', data)
          } catch { }
        }
      }
      return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  safeHandle('start-app', async () => {
    try {
      // The user is in the onboarding (Vue) window, which has its own nice loading state.
      // We will NO LONGER spawn the tiny transparent splash screen, as the user hates it.

      const bin = gateway.findBin()
      if (!bin) {
        return { success: false, error: 'AI gateway binary not found. Please reinstall ClawdAsk.' }
      }

      addLog('[start] Starting gateway...')
      const started = await gateway.start()

      if (started) {
        addLog('[start] Gateway started successfully!')
        createMainWindow() // Opens main window, loadURL triggers
        
        // Give mainWindow a split second to render before destroying the onboarding window
        setTimeout(() => {
          if (onboardingWindow && !onboardingWindow.isDestroyed()) {
            onboardingWindow.close()
            onboardingWindow = null
          }
          if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.close()
            splashWindow = null
          }
        }, 500)
        return { success: true }
      }

      // Gateway failed — gather diagnostics
      addLog('[start] Gateway failed to start, running diagnostics...')
      let diagnosticInfo = ''
      try {
        const doctorResult = execSync(`"${await gateway.runtime.getNodePath()}" "${bin}" doctor`, {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          encoding: 'utf-8',
          windowsHide: true
        }).toString()
        diagnosticInfo = doctorResult.trim()
        addLog(`[doctor] ${diagnosticInfo}`)
      } catch (e) {
        diagnosticInfo = 'Doctor command failed'
        addLog(`[doctor] Failed: ${e}`)
      }

      const errorMsg = diagnosticInfo
        ? `Gateway timeout.\n\nDiagnostics:\n${diagnosticInfo}`
        : 'The gateway did not respond in time. Make sure your API key is correct and try again.'

      return { success: false, error: errorMsg }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  safeHandle('get-logs', () => LOG_BUFFER)

  // ─── CLI Runner Helper ───────────────────────────────────────────
  async function runCLI(args: string[]): Promise<{ success: boolean; output: string }> {
    const bin = gateway.findBin()
    if (!bin) return Promise.resolve({ success: false, output: 'Binary not found' })
    return new Promise(async (resolve) => {
      const node = await gateway.runtime.getNodePath()
      const p = spawn(node, [bin, ...args], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      })
      let out = ''
      p.stdout?.on('data', (d) => { out += d.toString(); addLog(`[${args[0]}] ${d}`) })
      p.stderr?.on('data', (d) => { out += d.toString(); addLog(`[${args[0]}:err] ${d}`) })
      p.on('close', (code) => resolve({ success: code === 0, output: out }))
    })
  }

  // ─── Phase B: Security Audit ─────────────────────────────────────
  safeHandle('run-doctor', () => runCLI(['doctor']))
  safeHandle('run-security-audit', () => runCLI(['security', 'audit', '--json']))

  // ─── Phase E-G: Channel Setup ────────────────────────────────────
  safeHandle('setup-channel', async (_e: any, channel: string, config: any) => {
    try {
      const ex = loadConfig()
      if (!ex.channels) ex.channels = {}
      ex.channels[channel] = { enabled: true, ...config }
      writeFileSync(CONFIG_PATH, JSON.stringify(ex, null, 2))
      addLog(`[channels] Configured ${channel}`)
      // Restart gateway to apply channel changes
      await gateway.restart()
      return { success: true }
    } catch (err) { return { success: false, error: String(err) } }
  })

  safeHandle('channels-status', () => runCLI(['channels', 'status', '--probe']))

  // ─── Phase H: Gateway Health ─────────────────────────────────────
  safeHandle('gateway-health', () => runCLI(['health', '--json']))
  safeHandle('gateway-status', () => runCLI(['status', '--all']))

  // ─── Phase N: TTS Config ─────────────────────────────────────────
  safeHandle('set-tts', async (_e: any, ttsConfig: any) => {
    try {
      const ex = loadConfig()
      ex.tts = { enabled: true, ...ttsConfig }
      writeFileSync(CONFIG_PATH, JSON.stringify(ex, null, 2))
      addLog('[tts] Configuration updated')
      return { success: true }
    } catch (err) { return { success: false, error: String(err) } }
  })

  // ─── Phase R: Config Read/Write ──────────────────────────────────
  safeHandle('get-config', () => {
    try { return { success: true, config: loadConfig() } }
    catch (err) { return { success: false, error: String(err) } }
  })

  safeHandle('save-full-config', async (event: any, config: any) => {
    try {
      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))

      // Update auth-profiles.json separately if apiKey is provided
      if (config.apiKey) {
        const authProfilesPath = join(process.env.HOME || process.env.USERPROFILE || '', '.clawdask', 'auth-profiles.json')
        const providerKey = (config.provider === 'custom' || config.provider === 'moonshot' || config.provider === 'embedded') ? 'openai' : config.provider
        const profileId = `${providerKey}:default`

        let authProfiles: any = { version: 1, profiles: {} }
        if (existsSync(authProfilesPath)) {
          try {
            const raw = readFileSync(authProfilesPath, 'utf8').replace(/^\uFEFF/, '')
            authProfiles = JSON.parse(raw)
          } catch (e) { }
        }

        authProfiles.profiles[profileId] = {
          type: 'api_key',
          provider: providerKey,
          key: config.apiKey
        }

        writeFileSync(authProfilesPath, JSON.stringify(authProfiles, null, 2))
      }

      event.sender.send('config-saved', true)
      addLog('[config] Full config saved')
      await gateway.restart()
      return { success: true }
    } catch (err) { return { success: false, error: String(err) } }
  })

  // ─── Phase S: Update ─────────────────────────────────────────────
  ipcMain.handle('run-update', async () => {
    const { app } = require('electron')
    if (app.isPackaged) {
      autoUpdater.allowPrerelease = false
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      return autoUpdater.checkForUpdatesAndNotify()
    }
    return runCLI(['update'])
  })
}

// ─── Config Helper ──────────────────────────────────────────────────
function loadConfig(): any {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, '')) }
  catch { return {} }
}

function generateToken(): string {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let r = ''; for (let i = 0; i < 32; i++) r += c.charAt(Math.floor(Math.random() * c.length))
  return r
}

// ─── App Lifecycle ──────────────────────────────────────────────────────
const startApp = () => {
  try {
    addTrace('startApp() entry')
    migrateDataDirIfNeeded()
    // Ensure we are running in an Electron environment
    if (!app) {
      addTrace('FATAL: app module is undefined')
      logCrash('Electron app module not found in startApp')
      return
    }

    addTrace('Requesting single instance lock...')
    // Handle single instance lock
    const gotTheLock = app.requestSingleInstanceLock()
    if (!gotTheLock) {
      addTrace('Lock denied - Another instance found. Quitting.')
      app.quit()
      return
    }
    addTrace('Lock acquired.')

    // SELF-HEAL: Sanitize config BEFORE any logic or windows
    // Use the global gateway instance
    // @ts-ignore
    gateway.preStartConfigCleanup()

    setupDevPath()
  } catch (e) {
    addTrace(`Error in startApp entry: ${e}`)
    logCrash(e)
  }

  app.on('second-instance', () => {
    addTrace('Second instance detected - focusing and refreshing existing window')
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show(); 
      mainWindow.focus();
      
      // Force reload to ensure it picks up any updated token/URL
      const token = ensureGatewayToken();
      const newUrl = `${GATEWAY_URL}?token=${token}`;
      addTrace(`[main-window] Second instance reload: ${newUrl}`);
      mainWindow.loadURL(newUrl);
    } else if (onboardingWindow && !onboardingWindow.isDestroyed()) {
      if (onboardingWindow.isMinimized()) onboardingWindow.restore()
      onboardingWindow.show(); onboardingWindow.focus()
    } else {
      if (hasValidConfig()) createMainWindow()
      else createOnboardingWindow()
    }
  })

  addTrace('Setting up app.whenReady() sequence...')
  app.whenReady().then(async () => {
    addTrace('app.ready event received.')
    try { 
      app.setAppUserModelId(APP_ID)
      addTrace(`AppUserModelId set to ${APP_ID}`)
    } catch (e) { addTrace(`Warning: Failed to set AppUserModelId: ${e}`) }

    // ─── CLOUD SENTINEL ───
    if (checkCloudPath()) {
      showCloudWarning()
    }

    addTrace('Running setupIPC...')
    setupIPC()
    addTrace('Running createTray...')
    createTray()
    addTrace('Running bootstrapSkills...')
    await bootstrapSkills()
    addTrace('Skills bootstrapped.')

    // Global Shortcut: Ctrl+Alt+C to show/focus
    try {
      addTrace('Registering Global Shortcut...')
      globalShortcut.register('CommandOrControl+Alt+C', () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) { mainWindow.hide() }
          else { mainWindow.show(); mainWindow.focus() }
        }
      })
      addTrace('Shortcut registered.')
    } catch (e) { addTrace(`Shortcut registration failed: ${e}`) }

    addTrace('Checking hasValidConfig()...')
    if (hasValidConfig()) {
      addTrace('Config is valid.')
      // Phase 10: Check if ANY valid provider is setup (not just Anthropic)
      const authPath = join(CLAWDASK_DIR, 'agents', 'main', 'agent', 'auth-profiles.json')
      
      let hasValidProvider = false
      if (existsSync(authPath)) {
        const content = readFileSync(authPath, 'utf-8')
        // Include google, anthropic, openai in valid provider list
        hasValidProvider = content.includes('"key"') || !!content.match(/"provider"\s*:\s*"(ollama|custom|local|google|anthropic|openai)"/i)
      }
      addTrace(`hasValidProvider initial check: ${hasValidProvider}`)
      
      // Fallback for older configurations or Ollama setups
      if (!hasValidProvider && existsSync(CONFIG_PATH)) {
        try {
          const raw = readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, '')
          const cfg = JSON.parse(raw)
          const primaryModel = cfg?.agents?.defaults?.model?.primary || cfg?.model || ''
          const prov = primaryModel.split('/')[0]
          const validProvs = ['ollama', 'custom', 'local', 'google', 'anthropic', 'openai']
          if (validProvs.includes(prov)) {
            hasValidProvider = true
          }
        } catch { }
      }
      addTrace(`hasValidProvider fallback check: ${hasValidProvider}`)
      
      if (!hasValidProvider && !isMinimized) {
        addTrace('Missing provider - Routing to onboarding window...')
        createOnboardingWindow()
        return // Halt gateway boot to let user finish setup
      }

      if (!isMinimized) {
        addTrace('Valid config found - Showing branded initializer...')
        createOnboardingWindow()
      }
      
      // Run gateway start in background
      addTrace('Initiating gateway.start()...')
      gateway.start().then((started) => {
        addTrace(`gateway.start() result: ${started}`)
        if (!started) {
          addLog('[start:err] Gateway failed to respond. Remaining in background.')
          return
        }

        if (!isMinimized && !mainWindow) {
          addTrace('Gateway started - Transitioning to Main Window...')
          createMainWindow()
          // createMainWindow handles closing the onboarding window automatically
        }
      })
    } else {
      addTrace('Config invalid. Routing to onboarding...')
      if (!isMinimized) {
        addTrace('Attempting to create Onboarding Window (invalid config path)...')
        createOnboardingWindow()
      }
    }

    // Check for updates on startup if packaged
    if (app.isPackaged) {
      try {
        addTrace('Checking for updates...')
        autoUpdater.checkForUpdatesAndNotify().catch(e => addTrace(`Update check failed (non-fatal): ${e}`))
      } catch (e) {
        addTrace(`Update check error (non-fatal): ${e}`)
      }
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        if (hasValidConfig()) createMainWindow()
        else createOnboardingWindow()
      }
    })
  })

  app.on('will-quit', () => { globalShortcut.unregisterAll() })
  app.on('window-all-closed', () => { })
  app.on('before-quit', () => { isQuitting = true; gateway.stop() })
}

// Initial Kick-off
startApp()
