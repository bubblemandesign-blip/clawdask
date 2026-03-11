try {
  delete process.env['ELECTRON_RUN_AS_NODE']
  delete process.env['ELECTRON_NO_ASAR']
} catch { }

// Force Ollama Authentication for local bypass (OpenClaw requirement)
process.env['OLLAMA_API_KEY'] = 'ollama-local'

import { autoUpdater } from 'electron-updater'
import { join, dirname } from 'path'
import { ChildProcess, spawn, execSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'fs'
import { homedir } from 'os'
import http from 'http'
import https from 'https'
import { bootstrapSkills } from './skills-bootstrapper'
import { localAIManager } from './local-ai-manager'

// ─── Constants ───────────────────────────────────────────────────────────
const APP_ID = 'com.clawdesk.app'
let GATEWAY_PORT = 18789
let GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`
const OPENCLAW_DIR = join(homedir(), '.openclaw')
const CONFIG_PATH = join(OPENCLAW_DIR, 'openclaw.json')

// ─── Enterprise Logs ─────────────────────────────────────────────────────
const MAX_LOGS = 1000
let LOG_BUFFER: string[] = []

function addLog(line: string) {
  LOG_BUFFER.push(`[${new Date().toLocaleTimeString()}] ${line.trim()}`)
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
let retryCount = 0
const isMinimized = process.argv.includes('--minimized')

function sendGatewayStatus(msg: string) {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.webContents.send('gateway-status-update', msg)
  }
}

// ─── Tunnel & Cloudflared Logic ────────────────────────────────────────
class RuntimeManager {
  private binDir = join(OPENCLAW_DIR, 'bin')
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

  getNodePath(): string {
    return existsSync(this.nodePath) ? this.nodePath : process.execPath
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
  private maxRestarts = 3
  private restartDelay = 2000
  private lastCrashTime = 0
  private crashFrequency = 0
  private watchdogInterval: NodeJS.Timeout | null = null
  private runtime: RuntimeManager

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
    if (!existsSync(OPENCLAW_DIR)) {
      try { mkdirSync(OPENCLAW_DIR, { recursive: true }) } catch (e) { console.error('[env] Failed to create OPENCLAW_DIR:', e) }
    }
    subdirs.forEach(d => {
      const p = join(OPENCLAW_DIR, d)
      try {
        if (!existsSync(p)) mkdirSync(p, { recursive: true })
      } catch (e) { console.error(`[env] Failed to create subdir ${d}:`, e) }
    })
    addLog('[env] Enterprise environment verification complete')
  }

  private findCloudflared(): string | null {
    const { app } = require('electron')
    const possiblePaths = [
      join(app.getAppPath(), 'cloudflared.exe'),
      join(process.resourcesPath, 'cloudflared.exe'),
      join(process.cwd(), 'cloudflared.exe'),
      'cloudflared.exe'
    ]
    for (const p of possiblePaths) {
      if (existsSync(p)) return p
    }
    return null
  }

  private preStartConfigCleanup(): void {
    if (!existsSync(CONFIG_PATH)) return
    try {
      let rawConfig = readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, '')
      let config = JSON.parse(rawConfig)
      let changed = false

      // 1. Ensure Top-Level Structure
      const defaults = { auth: {}, agents: { defaults: { sandbox: { mode: 'off' } } }, skills: { entries: {} } }
      Object.keys(defaults).forEach(key => {
        if (!config[key]) {
          config[key] = defaults[key]
          changed = true
          addLog(`[sentinel] Injected missing config key: ${key}`)
        }
      })

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
      // OpenClaw needs models.providers.custom.apiKey to register our internal server.
      const primaryModel = config?.agents?.defaults?.model?.primary || config?.model || ''
      if (primaryModel.startsWith('local/')) {
        if (!config.models) config.models = {}
        if (!config.models.providers) config.models.providers = {}
        if (!config.models.providers.custom || !config.models.providers.custom.apiKey) {
          config.models = config.models || {}
          config.models.providers = config.models.providers || {}
          config.models.providers.custom = {
            ...(config.models.providers.custom || {}),
            apiKey: 'local-embedded',
            api: 'openai', // llama-server provides OpenAI-compatible endpoints
            baseUrl: 'http://127.0.0.1:8080/v1',
            models: []
          }
          changed = true
          addLog('[sentinel] Injected Embedded provider registration (apiKey: local-embedded)')
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

      if (changed) writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    } catch (e) { console.error('[config:sentinel] Error:', e) }
  }

  async ensureLocalEngineRunning(): Promise<void> {
    try {
      if (!existsSync(CONFIG_PATH)) return
      const rawConfig = readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, '')
      const config = JSON.parse(rawConfig)
      
      const primaryModel = config?.agents?.defaults?.model?.primary || config?.model || ''
      
      // We only care about internal models prefixed with 'local/'
      if (!primaryModel.startsWith('local/')) return
      
      const targetModelId = primaryModel.replace('local/', '')
      const { localAIManager } = require('./local-ai-manager')
      
      // 1. Is the engine or model entirely missing?
      if (!localAIManager.isEngineInstalled() || !localAIManager.isModelInstalled(targetModelId)) {
        addLog(`[gateway:err] Local AI requires components (Engine/Model: ${targetModelId}). Please download via UI.`)
        // The UI handles the blocking UX
        return
      }

      // 2. Start the embedded server
      sendGatewayStatus('Warming up embedded AI engine...')
      const success = await localAIManager.startEngine(targetModelId, 8080)
      
      if (success) {
        addLog('[gateway] Embedded AI engine successfully started on port 8080')
      } else {
        addLog('[gateway:err] Embedded AI engine failed to start.')
      }
      
    } catch (e) {
      addLog('[gateway:err] Failed to verify/start embedded AI: ' + e)
    }
  }

  private startWatchdog(): void {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval)
    this.watchdogInterval = setInterval(async () => {
      if (this.state === 'running') {
        const alive = await this.verifyGateway()
        if (!alive) {
          addLog('[watchdog] Liveness probe failed — attempting auto-revive')
          this.restart()
        }
      }
    }, 60000) // Pulse check every 60s
  }

  async start(): Promise<boolean> {
    if (this.state === 'running' || this.state === 'starting') return true

    sendGatewayStatus('Cleaning up old processes...')
    await this.cleanupZombies()

    sendGatewayStatus('Verifying Javascript runtime...')
    const nodeExec = await this.runtime.ensureRuntime()
    const bin = this.findBin()
    if (!bin) {
      console.error('[gateway] Binary not found')
      return false
    }

    sendGatewayStatus('Checking for existing gateway...')
    if (await this.verifyGateway()) {
      console.log('[gateway] Existing gateway detected — reusing')
      this.state = 'running'
      return true
    }

    this.state = 'starting'
    sendGatewayStatus('Preparing secure environment...')
    this.ensureEnvironment()
    this.preStartConfigCleanup()
    
    sendGatewayStatus('Ensuring local AI services are running...')
    await this.ensureLocalEngineRunning()

    console.log(`[gateway] Starting: ${bin}`)

    sendGatewayStatus('Booting OpenClaw Engine...')

    const logPath = join(OPENCLAW_DIR, 'logs', 'gateway_error.log')
    const errorLog = require('fs').createWriteStream(logPath, { flags: 'a' })
    errorLog.write(`\n--- [${new Date().toISOString()}] Starting Gateway ---\n`)

    this.process = spawn(nodeExec, [bin, 'gateway'], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ELECTRON_RUN_AS_NODE: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    // ─── Performance: Set Gateway Priority ───
    if (this.process.pid) {
      try {
        const os = require('os')
        const { constants } = os
        // Set to Above Normal priority
        os.setPriority(this.process.pid, constants.priority.PRIORITY_ABOVE_NORMAL)
        addLog(`[perf] Gateway priority boosted to Above Normal (PID: ${this.process.pid})`)
      } catch (e) { console.error('[perf] Failed to set gateway priority:', e) }
    }

    this.process.stdout?.on('data', (d: Buffer) => {
      const s = d.toString()
      console.log(`[gateway] ${s.trim()}`)
      addLog(s)
      if (s.toLowerCase().includes('started') || s.toLowerCase().includes('listening')) {
        sendGatewayStatus('OpenClaw Base initialized...')
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
    const readyPort = await waitForPortRange(18789, 18800, 45000)
    if (readyPort) {
      GATEWAY_PORT = readyPort
      GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`
      this.state = 'running'
      this.restartCount = 0
      
      // Zero-Crash Guard: Stability Delay
      sendGatewayStatus('Port allocated. Securing connection...')
      addLog(`[gateway] Port ${GATEWAY_PORT} detected. Waiting 1.5s for stability...`)
      await new Promise(r => setTimeout(r, 1500))

      this.startWatchdog()
      this.startTunnelSync()
      this.updateTray()
      sendGatewayStatus('Connected! Handing over to Dashboard...')
      return true
    }
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
    try {
      addLog('[proc] Cleaning up potential ghost processes...')

      // 1. Kill any existing cloudflared or hanging openclaw/clawdesk processes
      const targets = ['cloudflared.exe', 'openclaw.exe', 'ClawDesk.exe']
      targets.forEach(img => {
        try { execSync(`taskkill /F /IM ${img} /T`, { stdio: 'ignore', windowsHide: true }) } catch { }
      })

      // 2. Identify if anything is on our port
      try {
        const portInfo = execSync(`netstat -ano | findstr :${GATEWAY_PORT}`, { encoding: 'utf-8', windowsHide: true })
        if (portInfo.trim()) {
          const lines = portInfo.trim().split('\n')
          lines.forEach(line => {
            const parts = line.trim().split(/\s+/)
            const pid = parts[parts.length - 1]
            if (pid && !isNaN(parseInt(pid)) && parseInt(pid) !== process.pid) {
              addLog(`[proc] Reclaiming port ${GATEWAY_PORT} from PID ${pid}`)
              try { execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore', windowsHide: true }) } catch { }
            }
          })
        }
      } catch (e) { /* Likely no process found */ }

      addLog('[proc] Zero-Crash Guard: Environment sanitized')
    } catch (e) {
      addLog(`[proc] Cleanup warning: ${e}`)
    }
  }

  private enterSafeMode(): void {
    addLog('[safe-mode] Entering Safe Mode due to frequent crashes')
    this.state = 'crashed'
    if (tray) {
      tray.displayBalloon({
        title: 'ClawDesk Safe Mode',
        content: 'Gateway is crashing repeatedly. Settings have been reset to safe defaults.'
      })
    }
    // Force safe config
    if (existsSync(CONFIG_PATH)) {
      try {
        const rawConfig = readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, '')
        const config = JSON.parse(rawConfig)
        if (config.agents?.defaults?.sandbox) config.agents.defaults.sandbox.mode = 'off'
        writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
      } catch { }
    }
  }

  async restart(): Promise<boolean> {
    this.stop()
    await new Promise(r => setTimeout(r, 1000))
    return this.start()
  }

  private async handleCrash(): Promise<void> {
    const now = Date.now()
    if (now - this.lastCrashTime < 60000) {
      this.crashFrequency++
    } else {
      this.crashFrequency = 1
    }
    this.lastCrashTime = now

    if (this.crashFrequency >= 3) {
      this.enterSafeMode()
      return
    }

    if (this.restartCount >= this.maxRestarts) {
      console.error(`[gateway] Max restarts (${this.maxRestarts}) reached`)
      this.updateTray()
      if (tray) {
        tray.displayBalloon({
          title: 'ClawDesk',
          content: 'Gateway stopped unexpectedly. Click tray icon to troubleshoot.'
        })
      }
      return
    }
    this.restartCount++
    this.state = 'restarting'
    const delay = this.restartDelay * this.restartCount
    console.log(`[gateway] Restart in ${delay}ms (${this.restartCount}/${this.maxRestarts})`)
    this.updateTray()
    await new Promise(r => setTimeout(r, delay))
    if (this.state === 'restarting') await this.start()
  }

  private updateTray(): void { if (tray) createTrayMenu() }

  private verifyGateway(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${GATEWAY_PORT}`, (res) => {
        resolve(res.statusCode !== undefined && res.statusCode < 500)
        res.resume()
      })
      req.on('error', () => resolve(false))
      req.setTimeout(5000, () => { req.destroy(); resolve(false) })
    })
  }

  findBin(): string | null {
    const { app } = require('electron')
    const possiblePaths = [
      join(app.getAppPath(), 'node_modules', 'openclaw', 'openclaw.mjs'),
      join(process.resourcesPath, 'app', 'node_modules', 'openclaw', 'openclaw.mjs'),
      join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'openclaw', 'openclaw.mjs'),
      join(process.resourcesPath, 'app.asar', 'node_modules', 'openclaw', 'openclaw.mjs'),
      join(dirname(process.execPath), 'resources', 'app.asar.unpacked', 'node_modules', 'openclaw', 'openclaw.mjs'),
      join(dirname(app.getAppPath()), 'node_modules', 'openclaw', 'openclaw.mjs'),
      join(homedir(), '.openclaw', 'bin', 'openclaw.mjs')
    ]
    for (const p of possiblePaths) {
      try { if (existsSync(p)) return p } catch { }
    }
    return null
  }
}

const gateway = new GatewayManager()

// ─── Utilities ───────────────────────────────────────────────────────────
function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}`, () => resolve(true))
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

function hasValidConfig(): boolean {
  if (!existsSync(CONFIG_PATH)) return false
  try {
    const rawConfig = readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, '')
    const config = JSON.parse(rawConfig)
    return !!(config?.auth || config?.providers || config?.openai || config?.anthropic || config?.models?.providers?.ollama || config?.provider === 'ollama' || config?.model?.startsWith('ollama/'))
  } catch {
    try {
      const backup = CONFIG_PATH + '.bak.' + Date.now()
      renameSync(CONFIG_PATH, backup)
      console.error(`[config] Corrupt config backed up to ${backup}`)
    } catch { /* ignore */ }
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
    const result = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v ClawDesk', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    return result.includes('ClawDesk')
  } catch { return false }
}

function setAutoStart(enabled: boolean): void {
  if (process.platform !== 'win32') return
  const { app } = require('electron')
  if (!app) return
  try {
    if (enabled) {
      const exePath = app.getPath('exe')
      execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v ClawDesk /t REG_SZ /d "\\"${exePath}\\" --minimized" /f`, { stdio: 'ignore' })
    } else {
      execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v ClawDesk /f', { stdio: 'ignore' })
    }
  } catch { /* ignore */ }
}

// ─── Splash Screen (Deprecated, using Onboarding UI) ──────

// ─── Onboarding ─────────────────────────────────────────────────────────
function createOnboardingWindow(): void {
  const electron = require('electron')
  if (!electron) return
  const { BrowserWindow } = electron
  onboardingWindow = new BrowserWindow({
    width: 520, height: 620, frame: false, resizable: false, transparent: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  if (getIsDev() && process.env['ELECTRON_RENDERER_URL']) {
    onboardingWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    onboardingWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  onboardingWindow.on('closed', () => { onboardingWindow = null })
}

// ─── Quick Setup Window (Removed - Handled by App.vue) ────
// ─── Main Window ────────────────────────────────────────────────────────
function createMainWindow(): void {
  const electron = require('electron')
  if (!electron) return
  const { BrowserWindow } = electron
  mainWindow = new BrowserWindow({
    width: 1100, height: 750, minWidth: 800, minHeight: 600,
    show: false, autoHideMenuBar: true, title: 'ClawDesk',
    backgroundColor: '#0a0a0a',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })

  mainWindow.on('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
    if (onboardingWindow && !onboardingWindow.isDestroyed()) onboardingWindow.close()
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow?.hide() }
  })

  mainWindow.on('closed', () => { mainWindow = null })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const electron = require('electron')
    if (electron) electron.shell.openExternal(details.url)
    return { action: 'deny' }
  })

  let initialUrl = GATEWAY_URL
  try {
    if (existsSync(CONFIG_PATH)) {
      const rawConfig = readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, '')
      const config = JSON.parse(rawConfig)
      const token = config.gateway?.auth?.token
      if (token) initialUrl += `?token=${token}`
    }
  } catch {}

  mainWindow.loadURL(initialUrl)

  mainWindow.webContents.on('did-finish-load', () => {
    // ─── ClawDesk Branding Injection ───────────────────────────────────
    // The OpenClaw Gateway Dashboard already has ALL features:
    // Chat, Channels, Sessions, Cron, Agents, Skills, Nodes, Config, Logs, etc.
    // We just rebrand it with ClawDesk identity.

    const brandingCSS = `
      /* ── Hide OpenClaw onboarding wizard (we have our own) ── */
      div[class*="SetupWizard"], div[class*="Onboarding"] { display: none !important; }

      /* ── Replace OpenClaw logo with ClawDesk style ── */
      [alt="OpenClaw Logo"], .openclaw-logo, img[src*="logo"], svg:has(path[d*="M12 2A10 10 0"]) {
        display: none !important;
      }

      /* ── Premium dark theme override ── */
      :root {
        --bg-primary: #0a0a0a !important;
        --bg-secondary: #0f0f0f !important;
        --bg-tertiary: #141414 !important;
        --bg-quaternary: #1a1a1a !important;
        --text-primary: #ffffff !important;
        --text-secondary: #a0a0a0 !important;
        --text-tertiary: #666666 !important;
        --accent-primary: #ffffff !important;
        --accent-secondary: #e0e0e0 !important;
        --border-color: rgba(255,255,255,0.08) !important;
        --border-color-hover: rgba(255,255,255,0.15) !important;
        
        /* ── Specific OpenClaw Overrides ── */
        --color-background: var(--bg-primary) !important;
        --color-surface: var(--bg-secondary) !important;
        --color-surface-hover: var(--bg-tertiary) !important;
        --color-primary: var(--accent-primary) !important;
        --color-text: var(--text-primary) !important;
        --color-text-muted: var(--text-secondary) !important;
        --color-border: var(--border-color) !important;
        --sidebar-bg: var(--bg-primary) !important;
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

      /* ── Button aesthetics ── */
      button {
        border-radius: 8px !important;
      }
      button.primary, button[type="submit"] {
        background-color: #ffffff !important;
        color: #000000 !important;
        font-weight: 600 !important;
      }
      
      /* ── Card & Input aesthetics ── */
      .card, div[class*="Card"], div[class*="Container"], input, textarea, select {
        background-color: var(--bg-tertiary) !important;
        border: 1px solid var(--border-color) !important;
        color: var(--text-primary) !important;
        border-radius: 12px !important;
      }
      input:focus, textarea:focus {
        border-color: var(--accent-secondary) !important;
        outline: none !important;
        box-shadow: 0 0 0 2px rgba(255,255,255,0.1) !important;
      }
      
      /* ── Scrollbars ── */
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
    `
    mainWindow?.webContents.insertCSS(brandingCSS)

    // ─── JS Branding: Replace all "OpenClaw" text with "ClawDesk" ───
    const brandingScript = `
      (function() {
        if (window.__clawdeskBranded) return;
        window.__clawdeskBranded = true;

        const REPLACEMENT_MAP = [
          [/OpenClaw/gi, 'ClawDesk'],
          [/OPENCLAW/gi, 'CLAWDESK'],
          [/openclaw/gi, 'clawdesk']
        ];

        function applyReplacements(text) {
          if (!text) return text;
          let newText = text;
          for (const [regex, replacement] of REPLACEMENT_MAP) {
            newText = newText.replace(regex, replacement);
          }
          return newText;
        }

        // ── Surgical Rebranding ──
        function rebrand(root = document.body) {
          if (document.title.includes('OpenClaw')) {
            document.title = applyReplacements(document.title);
          }

          // Use a more efficient approach: target specific elements first
          const targetSelectors = 'h1, h2, h3, h4, [class*="brand"], [class*="logo"], [class*="title"], [class*="header"], span, a, p, button, label, li';
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

          // Input placeholders
          root.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
            const oldText = el.placeholder;
            const newText = applyReplacements(oldText);
            if (oldText !== newText) el.placeholder = newText;
          });

          // Logo images - Convert to text brand mark
          root.querySelectorAll('img[src*="logo"], img[alt*="OpenClaw"], img[alt*="openclaw"], svg[class*="logo"]').forEach(img => {
            if (img.parentElement && !img.dataset.branded) {
              img.dataset.branded = 'true';
              img.style.display = 'none'; // Ensure it's hidden
              
              const brandContainer = document.createElement('div');
              brandContainer.style.cssText = 'display:flex;align-items:center;gap:8px;';
              
              // Custom minimalist text logo
              const brandIcon = document.createElement('div');
              brandIcon.innerHTML = '<svg width="24" height="24" viewBox="0 0 40 40" fill="none"><path d="M8 28 L14 12 L20 22 L26 12 L32 28" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="20" cy="32" r="2" fill="#fff" opacity=".3"/></svg>';
              
              const brandText = document.createElement('span');
              brandText.textContent = 'ClawDesk';
              brandText.style.cssText = 'font-weight:700;font-size:18px;letter-spacing:-0.5px;color:#fff;font-family:"Inter",sans-serif;margin-left:4px;';
              
              brandContainer.appendChild(brandIcon);
              brandContainer.appendChild(brandText);
              
              img.parentElement.insertBefore(brandContainer, img);
            }
          });
        }

        requestAnimationFrame(() => rebrand());

        // ── Efficient MutationObserver ──
        const observer = new MutationObserver((mutations) => {
          let shouldRebrand = false;
          for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
              shouldRebrand = true;
              for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  try { requestAnimationFrame(() => rebrand(node)); } catch(e){}
                }
              }
            }
          }
          if (shouldRebrand) {
            requestAnimationFrame(() => {
              if (document.title.includes('OpenClaw')) document.title = applyReplacements(document.title);
            });
          }
        });
        
        observer.observe(document.body, { childList: true, subtree: true });

      })();
    `
    mainWindow?.webContents.executeJavaScript(brandingScript)

    // ─── Gateway Token Injection ───
    // Automatically authorize the dashboard using the token from openclaw.json
    try {
      if (existsSync(CONFIG_PATH)) {
        const rawConfig = readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, '')
        const config = JSON.parse(rawConfig);
        const token = config.gateway?.auth?.token;
        if (token) {
          const tokenScript = `
            (function() {
              const TOKEN = "${token}";
              const keys = ["openclaw-token", "gateway-token", "token"];
              keys.forEach(k => {
                if (localStorage.getItem(k) !== TOKEN) localStorage.setItem(k, TOKEN);
                if (sessionStorage.getItem(k) !== TOKEN) sessionStorage.setItem(k, TOKEN);
              });
              // We no longer trigger a location.href reload here. 
              // The main window's initialURL already included ?token=XYZ.
            })();
          `;
          mainWindow?.webContents.executeJavaScript(tokenScript);
        }
      }
    } catch (e) {
      addLog(`[auth:err] Failed to inject gateway token: ${e}`);
    }
  })
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
  tray.setToolTip('ClawDesk')
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
  const labels: any = { stopped: '⚫ Stopped', starting: '🟡 Starting…', running: '⚪ Running', crashed: '🔴 Crashed', restarting: '🟡 Restarting…' }
  const menu = Menu.buildFromTemplate([
    { 
      label: 'Open ClawDesk', 
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
    { label: `Gateway: ${labels[gateway.currentState]}`, enabled: false },
    { type: 'separator' },
    { label: 'Restart Gateway', click: async () => { await gateway.restart() } },
    { label: 'Run Diagnostics', click: () => { try { const bin = gateway.findBin(); if (bin) spawn(bin, ['doctor'], { shell: true, stdio: 'inherit', windowsHide: true }) } catch { } } },
    { label: 'Open Error Logs', click: () => { shell.openPath(join(OPENCLAW_DIR, 'logs', 'gateway_error.log')) } },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: getAutoStartEnabled(), click: (i: any) => setAutoStart(i.checked) },
    { type: 'separator' },
    { label: 'About ClawDesk', click: () => { dialog.showMessageBox({ type: 'info', title: 'About ClawDesk', message: 'ClawDesk', detail: 'A desktop wrapper for OpenClaw.\n\nOpenClaw is MIT licensed.\nCopyright © 2025 Peter Steinberger\nhttps://github.com/openclaw/openclaw', buttons: ['OK'] }) } },
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

  safeHandle('check-openclaw', async () => ({ installed: !!gateway.findBin(), path: gateway.findBin(), isGatewayStarting: gateway.currentState === 'starting' || gateway.currentState === 'running' }))
  safeHandle('save-config', async (_e, c: any) => {
    try {
      if (!existsSync(OPENCLAW_DIR)) mkdirSync(OPENCLAW_DIR, { recursive: true })
      let ex: any = {}; try { ex = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) } catch { }

      const providerKey = (c.provider === 'custom' || c.provider === 'moonshot' || c.provider === 'embedded') ? 'openai' : c.provider
      const profileId = `${providerKey}:default`
      const authProfile: any = { mode: 'api_key', provider: providerKey }
      if (c.baseUrl) authProfile.baseUrl = c.baseUrl
      else if (c.provider === 'moonshot') authProfile.baseUrl = 'https://api.moonshot.cn/v1'
      else if (c.provider === 'embedded') authProfile.baseUrl = 'http://127.0.0.1:8080/v1'

      // OpenClaw requires OLLAMA_API_KEY to be set, even though it's local.
      if (providerKey === 'ollama') {
        authProfile.apiKey = 'ollama-local'
      } else if (c.provider === 'embedded') {
        authProfile.apiKey = 'local-embedded'
      } else {
         // Keep existing apiKey logic for others
         authProfile.apiKey = c.apiKey
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
        tools: {
          profile: c.enableComputerControl ? 'coding' : 'messaging',
          allow: c.enableWebBrowser ? ['browser', 'web_search', 'web_fetch'] : undefined
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
            model: c.model ? { primary: c.model } : ex.agents?.defaults?.model,
            sandbox: { mode: (c.enableSandbox && existsSync('C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe')) ? 'all' : 'off' }
          }
        },
        channels: {
          ...ex.channels,
          whatsapp: {
            enabled: true,
            dmPolicy: c.dmPolicy || 'pairing',
            allowFrom: (c.dmPolicy === 'open') ? ['*'] : ((c.dmPolicy === 'allowlist' && c.allowFrom) ? c.allowFrom.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined)
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
      const soulPath = join(OPENCLAW_DIR, 'SOUL.md')
      writeFileSync(soulPath, `# ClawDesk Agent Personality\n\n${soulContent}\n`)
      addLog(`[personality] Set to: ${c.personalityTemplate || 'pro'}`)

      // Clean up OpenClaw logic
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
      const authPath = join(OPENCLAW_DIR, 'agents', 'main', 'agent', 'auth-profiles.json')
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

  safeHandle('download-local-engine', async (e) => {
    return await localAIManager.downloadEngine((percent, text) => {
      e.sender.send('local-ai-download-progress', { type: 'engine', percent, text })
    })
  })

  safeHandle('download-local-model', async (e, modelId: string) => {
    return await localAIManager.downloadModel(modelId, (percent, text) => {
      e.sender.send('local-ai-download-progress', { type: 'model', modelId, percent, text })
    })
  })

  safeHandle('open-link', async (_e, url: string) => {
    const { shell } = require('electron')
    if (shell) shell.openExternal(url)
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
    if (electron) electron.shell.openPath(join(OPENCLAW_DIR, 'logs'))
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
        return { success: false, error: 'OpenClaw binary not found. Please reinstall ClawDesk.' }
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
        const doctorResult = execSync(`"${process.execPath}" "${bin}" doctor`, {
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
  function runCLI(args: string[]): Promise<{ success: boolean; output: string }> {
    const bin = gateway.findBin()
    if (!bin) return Promise.resolve({ success: false, output: 'Binary not found' })
    return new Promise((resolve) => {
      const p = spawn(process.execPath, [bin, ...args], {
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
        const authProfilesPath = join(process.env.HOME || process.env.USERPROFILE || '', '.openclaw', 'auth-profiles.json')
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
// ─── Environment Helpers ──────────────────────────────────────────────
function getElectron(): any {
  const e = require('electron')
  if (e && typeof e !== 'string') return e
  return null
}


// ─── App Lifecycle ──────────────────────────────────────────────────────
const startApp = () => {
  const electron = getElectron()
  if (!electron || !electron.app) {
    if (retryCount < 10) {
      retryCount++
      console.log(`[boot] Electron API shadowing detected (Attempt ${retryCount}). Cleaning environment and retrying...`)
      try {
        delete process.env['ELECTRON_RUN_AS_NODE']
        delete require.cache[require.resolve('electron')]
      } catch {}
      setTimeout(startApp, 200)
    } else {
      console.error('[boot] Fatal: Electron API could not be resolved. Please ensure you are running via the Electron binary.')
    }
    return
  }

  const { app: electronApp, globalShortcut, BrowserWindow } = electron

  let hasLock = false
  try { hasLock = electronApp.requestSingleInstanceLock() } catch { hasLock = true }

  if (!hasLock) {
    electronApp.quit()
    return
  }

  electronApp.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show(); mainWindow.focus()
    } else if (onboardingWindow && !onboardingWindow.isDestroyed()) {
      if (onboardingWindow.isMinimized()) onboardingWindow.restore()
      onboardingWindow.show(); onboardingWindow.focus()
    } else {
      if (hasValidConfig()) createMainWindow()
      else createOnboardingWindow()
    }
  })

  electronApp.whenReady().then(async () => {
    try { electronApp.setAppUserModelId(APP_ID) } catch { }
    setupIPC(); createTray(); await bootstrapSkills()

    // Global Shortcut: Ctrl+Alt+C to show/focus
    globalShortcut.register('CommandOrControl+Alt+C', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) { mainWindow.hide() }
        else { mainWindow.show(); mainWindow.focus() }
      }
    })

    if (hasValidConfig()) {
      // Phase 10: Check if ANY valid provider is setup (not just Anthropic)
      const authPath = join(OPENCLAW_DIR, 'agents', 'main', 'agent', 'auth-profiles.json')
      
      let hasValidProvider = false
      if (existsSync(authPath)) {
         const content = readFileSync(authPath, 'utf-8');
         hasValidProvider = content.includes('"key"') || !!content.match(/"provider"\s*:\s*"(ollama|custom)"/i);
      }
      
      // Fallback for older configurations or Ollama setups
      if (!hasValidProvider && existsSync(CONFIG_PATH)) {
        try {
          const raw = readFileSync(CONFIG_PATH, 'utf-8').replace(/^\uFEFF/, '')
          const cfg = JSON.parse(raw)
          const primaryModel = cfg?.agents?.defaults?.model?.primary || cfg?.model || ''
          if (primaryModel.startsWith('ollama/') || primaryModel.startsWith('custom/')) {
            hasValidProvider = true
          }
        } catch { }
      }
      
      if (!hasValidProvider && !isMinimized) {
        addLog('[start] Missing AI provider configuration. Routing to main onboarding UI...')
        createOnboardingWindow()
        return // Halt gateway boot to let user finish setup
      }

      if (!isMinimized) createOnboardingWindow()
      // Run gateway start in background
      gateway.start().then((started) => {
        if (!started) {
          addLog('[start:err] Gateway failed to respond. Remaining in background.')
          return
        }

        if (!isMinimized && !mainWindow) {
          createMainWindow()
        }
      })
    } else {
      if (!isMinimized) createOnboardingWindow()
    }


    // Check for updates on startup if packaged
    if (electronApp.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify()
    }

    electronApp.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        if (hasValidConfig()) createMainWindow()
        else createOnboardingWindow()
      }
    })
  })

  electronApp.on('will-quit', () => { globalShortcut.unregisterAll() })
  electronApp.on('window-all-closed', () => { })
  electronApp.on('before-quit', () => { isQuitting = true; gateway.stop() })
}

// Initial Kick-off
startApp()
