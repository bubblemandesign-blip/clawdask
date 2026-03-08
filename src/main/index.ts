// ─── Fix environment BEFORE anything else ───────────────────────────────
delete process.env['ELECTRON_RUN_AS_NODE']

// ─── Electron Resolver (Resilience) ──────────────────────────────────────
const getElectron = () => {
  try { return require('electron') } catch { return null }
}
const getApp = () => getElectron()?.app
import { autoUpdater } from 'electron-updater'
import { join, dirname } from 'path'
import { ChildProcess, spawn, execSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'fs'
import { homedir } from 'os'
import http from 'http'
import { bootstrapSkills } from './skills-bootstrapper'

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
  if (mainWindow) mainWindow.webContents.send('log-update', LOG_BUFFER[LOG_BUFFER.length - 1])
}

// ─── State ───────────────────────────────────────────────────────────────
let mainWindow: any = null
let onboardingWindow: any = null
let splashWindow: any = null
let tray: any = null
let isQuitting = false
const isMinimized = process.argv.includes('--minimized')

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

  get isRunning(): boolean { return this.state === 'running' }
  get currentState(): GatewayState { return this.state }
  get pid(): number | undefined { return this.process?.pid }

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
    if (!existsSync(OPENCLAW_DIR)) mkdirSync(OPENCLAW_DIR, { recursive: true })
    subdirs.forEach(d => {
      const p = join(OPENCLAW_DIR, d)
      if (!existsSync(p)) mkdirSync(p, { recursive: true })
    })
    addLog('[env] Multi-layer environment verification complete')
  }

  private preStartConfigCleanup(): void {
    if (!existsSync(CONFIG_PATH)) return
    try {
      let config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
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

      if (changed) writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    } catch (e) { console.error('[config:sentinel] Error:', e) }
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

    await this.cleanupZombies()

    const bin = this.findBin()
    if (!bin) {
      console.error('[gateway] Binary not found')
      return false
    }

    if (await this.verifyGateway()) {
      console.log('[gateway] Existing gateway detected — reusing')
      this.state = 'running'
      return true
    }

    this.state = 'starting'
    this.ensureEnvironment()
    this.preStartConfigCleanup()
    console.log(`[gateway] Starting: ${bin}`)

    const logPath = join(OPENCLAW_DIR, 'logs', 'gateway_error.log')
    const errorLog = require('fs').createWriteStream(logPath, { flags: 'a' })
    errorLog.write(`\n--- [${new Date().toISOString()}] Starting Gateway ---\n`)

    this.process = spawn(process.execPath, [bin, 'gateway'], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ELECTRON_RUN_AS_NODE: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.process.stdout?.on('data', (d: Buffer) => {
      const s = d.toString()
      console.log(`[gateway] ${s.trim()}`)
      addLog(s)
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

    const readyPort = await waitForPortRange(18789, 18800, 45000)
    if (readyPort) {
      GATEWAY_PORT = readyPort
      GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`
      this.state = 'running'
      this.restartCount = 0
      this.startWatchdog()
      this.updateTray()
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
        try { execSync(`taskkill /pid ${this.process.pid} /f /t`, { stdio: 'ignore' }) }
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
      // 1. Kill any existing openclaw or node processes that might be hanging
      const cmd = `taskkill /F /IM openclaw.exe /T /FI "STATUS eq RUNNING"`
      execSync(cmd, { stdio: 'ignore' })

      // 2. Identify if anything is on our port
      try {
        const portInfo = execSync(`netstat -ano | findstr :${GATEWAY_PORT}`, { encoding: 'utf-8' })
        if (portInfo.trim()) {
          const lines = portInfo.trim().split('\n')
          lines.forEach(line => {
            const parts = line.trim().split(/\s+/)
            const pid = parts[parts.length - 1]
            if (pid && !isNaN(parseInt(pid)) && parseInt(pid) !== process.pid) {
              addLog(`[proc] Killing process ${pid} on port ${GATEWAY_PORT}`)
              execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore' })
            }
          })
        }
      } catch (e) { /* Likely no process found */ }

      addLog('[proc] Zombie & Port cleanup complete')
    } catch { }
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
        const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
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
    const electronApp = getApp()
    if (!electronApp) return null
    const possiblePaths = [
      join(electronApp.getAppPath(), 'node_modules', 'openclaw', 'openclaw.mjs'),
      join(process.resourcesPath, 'app', 'node_modules', 'openclaw', 'openclaw.mjs'),
      join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'openclaw', 'openclaw.mjs'),
      join(process.resourcesPath, 'app.asar', 'node_modules', 'openclaw', 'openclaw.mjs'),
      join(dirname(process.execPath), 'resources', 'app.asar.unpacked', 'node_modules', 'openclaw', 'openclaw.mjs'),
      join(dirname(electronApp.getAppPath()), 'node_modules', 'openclaw', 'openclaw.mjs'),
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
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
    return !!(config?.auth || config?.providers || config?.openai || config?.anthropic)
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
  const electronApp = getApp()
  return electronApp ? !electronApp.isPackaged : false
}

function cleanConfig(config: any): any {
  if (!config) return {}
  delete config.providers
  if (config.auth) {
    const allowed = [
      'openai', 'anthropic', 'google', 'groq', 'mistral',
      'together', 'openrouter', 'deepseek', 'xai', 'ollama', 'edge'
    ]
    Object.keys(config.auth).forEach(key => {
      if (!allowed.includes(key) && !key.startsWith('ollama') && !key.startsWith('lmstudio')) {
        delete config.auth[key]
      }
    })
  }
  return config
}

function getAutoStartEnabled(): boolean {
  if (process.platform !== 'win32') return false
  try {
    const result = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v ClawDesk', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    return result.includes('ClawDesk')
  } catch { return false }
}

function setAutoStart(enabled: boolean): void {
  if (process.platform !== 'win32') return
  const electronApp = getApp()
  if (!electronApp) return
  try {
    if (enabled) {
      const exePath = electronApp.getPath('exe')
      execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v ClawDesk /t REG_SZ /d "\\"${exePath}\\" --minimized" /f`, { stdio: 'ignore' })
    } else {
      execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v ClawDesk /f', { stdio: 'ignore' })
    }
  } catch { /* ignore */ }
}

// ─── Splash Screen ──────────────────────────────────────────────────────
function createSplashWindow(): void {
  const electron = getElectron()
  if (!electron) return
  const { BrowserWindow } = electron
  splashWindow = new BrowserWindow({
    width: 380, height: 280, frame: false, transparent: true,
    resizable: false, alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { sandbox: true }
  })
  const html = `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box}body{display:flex;align-items:center;justify-content:center;height:100vh;background:transparent;font-family:'Segoe UI',system-ui,sans-serif;-webkit-app-region:drag;user-select:none}.c{background:#0a0a0a;border-radius:20px;padding:48px 40px;text-align:center;border:1px solid rgba(255,255,255,0.04);box-shadow:0 40px 100px rgba(0,0,0,0.9);animation:f .4s ease-out}@keyframes f{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}svg{width:40px;height:40px;margin-bottom:14px;opacity:.85}h1{color:#f0f0f0;font-size:22px;font-weight:700;letter-spacing:-.5px;margin-bottom:16px}.s{color:#444;font-size:13px}.d span{display:inline-block;animation:b 1.2s infinite both}.d span:nth-child(2){animation-delay:.15s}.d span:nth-child(3){animation-delay:.3s}@keyframes b{0%,80%,100%{opacity:.2}40%{opacity:1}}</style></head><body><div class="c"><svg viewBox="0 0 40 40" fill="none"><path d="M8 28 L14 12 L20 22 L26 12 L32 28" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="20" cy="32" r="2" fill="#fff" opacity=".3"/></svg><h1>ClawDesk</h1><p class="s">Starting<span class="d"><span>.</span><span>.</span><span>.</span></span></p></div></body></html>`
  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

// ─── Onboarding ─────────────────────────────────────────────────────────
function createOnboardingWindow(): void {
  const electron = getElectron()
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

// ─── Main Window ────────────────────────────────────────────────────────
function createMainWindow(): void {
  const electron = getElectron()
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
    mainWindow?.show()
    splashWindow?.close()
    splashWindow = null
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow?.hide() }
  })

  mainWindow.on('closed', () => { mainWindow = null })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const electron = getElectron()
    if (electron) electron.shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.loadURL(GATEWAY_URL)

  mainWindow.webContents.on('did-finish-load', () => {
    // ─── ClawDesk Branding Injection ───────────────────────────────────
    // The OpenClaw Gateway Dashboard already has ALL features:
    // Chat, Channels, Sessions, Cron, Agents, Skills, Nodes, Config, Logs, etc.
    // We just rebrand it with ClawDesk identity.

    const brandingCSS = `
      /* ── Hide OpenClaw onboarding wizard (we have our own) ── */
      div[class*="SetupWizard"], div[class*="Onboarding"] { display: none !important; }

      /* ── Replace OpenClaw logo with ClawDesk style ── */
      [alt="OpenClaw Logo"], .openclaw-logo, img[src*="logo"] {
        filter: grayscale(100%) brightness(200%) !important;
      }

      /* ── Premium dark theme override ── */
      :root {
        --bg-primary: #0a0a0a !important;
        --bg-secondary: #111111 !important;
        --bg-tertiary: #1a1a1a !important;
        --text-primary: #f0f0f0 !important;
        --text-secondary: #999999 !important;
        --accent-primary: #ffffff !important;
        --border-color: rgba(255,255,255,0.08) !important;
      }
      body {
        font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif !important;
      }
    `
    mainWindow?.webContents.insertCSS(brandingCSS)

    // ─── JS Branding: Replace all "OpenClaw" text with "ClawDesk" ───
    const brandingScript = `
      (function() {
        if (window.__clawdeskBranded) return;
        window.__clawdeskBranded = true;

        // ── Text replacement function ──
        function rebrand() {
          // Replace in title
          if (document.title.includes('OpenClaw')) {
            document.title = document.title.replace(/OpenClaw/gi, 'ClawDesk');
          }

          // Walk all text nodes and replace OpenClaw → ClawDesk
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
          let node;
          while (node = walker.nextNode()) {
            if (node.nodeValue && node.nodeValue.includes('OpenClaw')) {
              node.nodeValue = node.nodeValue.replace(/OpenClaw/gi, 'ClawDesk');
            }
            if (node.nodeValue && node.nodeValue.includes('OPENCLAW')) {
              node.nodeValue = node.nodeValue.replace(/OPENCLAW/gi, 'CLAWDESK');
            }
            if (node.nodeValue && node.nodeValue.includes('openclaw')) {
              node.nodeValue = node.nodeValue.replace(/openclaw/gi, 'clawdesk');
            }
          }

          // Replace in header/sidebar branding elements
          document.querySelectorAll('h1, h2, h3, [class*="brand"], [class*="logo"], [class*="title"], [class*="header"], span, a, p, button, label').forEach(el => {
            if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
              el.textContent = el.textContent.replace(/OpenClaw/gi, 'ClawDesk').replace(/OPENCLAW/gi, 'CLAWDESK').replace(/openclaw/gi, 'clawdesk');
            }
          });

          // Replace in input placeholders
          document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
            if (el.placeholder.includes('openclaw') || el.placeholder.includes('OpenClaw')) {
              el.placeholder = el.placeholder.replace(/OpenClaw/gi, 'ClawDesk').replace(/openclaw/gi, 'clawdesk');
            }
          });

          // Replace logo image with text if it's a small logo
          document.querySelectorAll('img[src*="logo"], img[alt*="OpenClaw"], img[alt*="openclaw"]').forEach(img => {
            const parent = img.parentElement;
            if (parent && img.width < 200) {
              const brand = document.createElement('span');
              brand.textContent = 'CLAWDESK';
              brand.style.cssText = 'font-weight:800;font-size:14px;letter-spacing:2px;color:#fff;font-family:Inter,sans-serif;';
              parent.replaceChild(brand, img);
            }
          });

          // Replace "GATEWAY DASHBOARD" subtitle
          document.querySelectorAll('span, div, p').forEach(el => {
            if (el.textContent.trim() === 'GATEWAY DASHBOARD') {
              el.textContent = 'PREMIER DASHBOARD';
            }
          });
        }

        // Run immediately
        rebrand();

        // Re-run on DOM changes (for SPA navigation) with debounce
        let brandingScheduled = false;
        const observer = new MutationObserver(() => {
          if (brandingScheduled) return;
          brandingScheduled = true;
          requestAnimationFrame(() => {
            observer.disconnect();
            rebrand();
            observer.observe(document.body, { childList: true, subtree: true });
            brandingScheduled = false;
          });
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // Also re-run periodically for any delayed renders (10 seconds total)
        let runs = 0;
        const interval = setInterval(() => {
          observer.disconnect();
          rebrand();
          observer.observe(document.body, { childList: true, subtree: true });
          runs++;
          if (runs > 20) clearInterval(interval);
        }, 500);
      })();
    `
    mainWindow?.webContents.executeJavaScript(brandingScript)
  })


  mainWindow.webContents.on('did-fail-load', () => {
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(GATEWAY_URL) }, 2000)
  })
}

// ─── System Tray ────────────────────────────────────────────────────────
function createTray(): void {
  const electron = getElectron()
  if (!electron) return
  const { nativeImage, Tray } = electron
  const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARklEQVQ4y2NgGAUowMjIyMDAwMBwHpcCFgYGBgVcGpiwKWBiYGBQwKeBBZsCJnwaWHBpYMKlATkQ8WlgwaeBBZ8GFnwOAQBYjAf3C2TzlgAAAABJRU5ErkJggg==')
  tray = new Tray(icon)
  tray.setToolTip('ClawDesk')
  createTrayMenu()
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus() })
}

function createTrayMenu(): void {
  if (!tray) return
  const electron = getElectron()
  if (!electron) return
  const { Menu, shell, dialog, app } = electron
  const labels: any = { stopped: '⚫ Stopped', starting: '🟡 Starting…', running: '⚪ Running', crashed: '🔴 Crashed', restarting: '🟡 Restarting…' }
  const menu = Menu.buildFromTemplate([
    { label: 'Open ClawDesk', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { type: 'separator' },
    { label: `Gateway: ${labels[gateway.currentState]}`, enabled: false },
    { type: 'separator' },
    { label: 'Restart Gateway', click: async () => { await gateway.restart() } },
    { label: 'Run Diagnostics', click: () => { try { const bin = gateway.findBin(); if (bin) spawn(bin, ['doctor'], { shell: true, stdio: 'inherit' }) } catch { } } },
    { label: 'Open Error Logs', click: () => { shell.openPath(join(OPENCLAW_DIR, 'logs', 'gateway_error.log')) } },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: getAutoStartEnabled(), click: (i) => setAutoStart(i.checked) },
    { type: 'separator' },
    { label: 'About ClawDesk', click: () => { dialog.showMessageBox({ type: 'info', title: 'About ClawDesk', message: 'ClawDesk', detail: 'A desktop wrapper for OpenClaw.\n\nOpenClaw is MIT licensed.\nCopyright © 2025 Peter Steinberger\nhttps://github.com/openclaw/openclaw', buttons: ['OK'] }) } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; gateway.stop(); app.quit() } }
  ])
  tray.setContextMenu(menu)
}

// ─── IPC ────────────────────────────────────────────────────────────────
function setupIPC(): void {
  const electron = getElectron()
  if (!electron) return
  const { ipcMain } = electron
  ipcMain.handle('check-openclaw', async () => ({ installed: !!gateway.findBin(), path: gateway.findBin() }))
  ipcMain.handle('save-config', async (_e, c: any) => {
    try {
      if (!existsSync(OPENCLAW_DIR)) mkdirSync(OPENCLAW_DIR, { recursive: true })
      let ex: any = {}; try { ex = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) } catch { }

      const providerKey = (c.provider === 'custom' || c.provider === 'moonshot') ? 'openai' : c.provider
      const profileId = `${providerKey}:default`
      const authProfile: any = { mode: 'api_key', provider: providerKey }
      if (c.baseUrl) authProfile.baseUrl = c.baseUrl
      else if (c.provider === 'moonshot') authProfile.baseUrl = 'https://api.moonshot.cn/v1'

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
            sandbox: { mode: (c.enableSandbox && existsSync('C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe')) ? 'all' : 'off' }
          }
        },
        channels: {
          ...ex.channels,
          whatsapp: {
            enabled: true,
            dmPolicy: c.dmPolicy || 'pairing',
            allowFrom: (c.dmPolicy === 'allowlist' && c.allowFrom) ? c.allowFrom.split(',').map(s => s.trim()).filter(Boolean) : undefined
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
        final.channels.telegram = { enabled: true, botToken: c.telegramToken, dmPolicy: c.dmPolicy || 'pairing' }
      }
      if (c.discordToken) {
        final.channels.discord = { enabled: true, botToken: c.discordToken }
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
    } catch (err) { return { success: false, error: String(err) } }
  })

  // Multi-Channel: WhatsApp Linking
  ipcMain.handle('link-whatsapp', async () => {
    const bin = gateway.findBin()
    if (!bin) return { success: false, error: 'Binary not found' }

    return new Promise((resolve) => {
      const proc = spawn(process.execPath, [bin, 'channels', 'login', 'whatsapp'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
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
  ipcMain.handle('start-app', async () => {
    try {
      if (onboardingWindow) onboardingWindow.close()
      createSplashWindow()

      // Check binary exists first
      const bin = gateway.findBin()
      if (!bin) {
        splashWindow?.close()
        return { success: false, error: 'OpenClaw binary not found. Please reinstall ClawDesk.' }
      }

      addLog('[start] Starting gateway...')
      const started = await gateway.start()

      if (started) {
        addLog('[start] Gateway started successfully!')
        createMainWindow()
        return { success: true }
      }

      // Gateway failed — gather diagnostics
      addLog('[start] Gateway failed to start, running diagnostics...')
      let diagnosticInfo = ''
      try {
        const doctorResult = execSync(`"${process.execPath}" "${bin}" doctor`, {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          timeout: 10000
        }).toString()
        diagnosticInfo = doctorResult.trim()
        addLog(`[doctor] ${diagnosticInfo}`)
      } catch (e) {
        diagnosticInfo = 'Doctor command failed'
        addLog(`[doctor] Failed: ${e}`)
      }

      splashWindow?.close()

      const errorMsg = diagnosticInfo
        ? `Gateway timeout.\n\nDiagnostics:\n${diagnosticInfo}`
        : 'The gateway did not respond in time. Make sure your API key is correct and try again.'

      return { success: false, error: errorMsg }
    } catch (err) {
      splashWindow?.close()
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('get-logs', () => LOG_BUFFER)

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
  ipcMain.handle('run-doctor', () => runCLI(['doctor']))
  ipcMain.handle('run-security-audit', () => runCLI(['security', 'audit', '--json']))

  // ─── Phase E-G: Channel Setup ────────────────────────────────────
  ipcMain.handle('setup-channel', async (_e: any, channel: string, config: any) => {
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

  ipcMain.handle('channels-status', () => runCLI(['channels', 'status', '--probe']))

  // ─── Phase H: Gateway Health ─────────────────────────────────────
  ipcMain.handle('gateway-health', () => runCLI(['health', '--json']))
  ipcMain.handle('gateway-status', () => runCLI(['status', '--all']))

  // ─── Phase N: TTS Config ─────────────────────────────────────────
  ipcMain.handle('set-tts', async (_e: any, ttsConfig: any) => {
    try {
      const ex = loadConfig()
      ex.tts = { enabled: true, ...ttsConfig }
      writeFileSync(CONFIG_PATH, JSON.stringify(ex, null, 2))
      addLog('[tts] Configuration updated')
      return { success: true }
    } catch (err) { return { success: false, error: String(err) } }
  })

  // ─── Phase R: Config Read/Write ──────────────────────────────────
  ipcMain.handle('get-config', () => {
    try { return { success: true, config: loadConfig() } }
    catch (err) { return { success: false, error: String(err) } }
  })

  ipcMain.handle('save-full-config', async (event: any, config: any) => {
    try {
      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))

      // Update auth-profiles.json separately if apiKey is provided
      if (config.apiKey) {
        const authProfilesPath = join(process.env.HOME || process.env.USERPROFILE || '', '.openclaw', 'auth-profiles.json')
        const providerKey = (config.provider === 'custom' || config.provider === 'moonshot') ? 'openai' : config.provider
        const profileId = `${providerKey}:default`

        let authProfiles: any = { version: 1, profiles: {} }
        if (existsSync(authProfilesPath)) {
          try { authProfiles = JSON.parse(readFileSync(authProfilesPath, 'utf8')) } catch (e) { }
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
    const electronApp = getApp()
    if (electronApp?.isPackaged) {
      return autoUpdater.checkForUpdatesAndNotify()
    }
    return runCLI(['update'])
  })
}

// ─── Config Helper ──────────────────────────────────────────────────
function loadConfig(): any {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) }
  catch { return {} }
}

function generateToken(): string {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let r = ''; for (let i = 0; i < 32; i++) r += c.charAt(Math.floor(Math.random() * c.length))
  return r
}

// ─── App Lifecycle ──────────────────────────────────────────────────────
const startApp = () => {
  const electron = getElectron()
  if (!electron) {
    console.error('[boot] Electron module not found, retrying...')
    setTimeout(startApp, 100)
    return
  }
  const { app, globalShortcut, BrowserWindow } = electron

  let hasLock = false
  try { hasLock = app.requestSingleInstanceLock() } catch { hasLock = true }

  if (!hasLock) {
    app.quit()
    return
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show(); mainWindow.focus()
    } else if (onboardingWindow) {
      if (onboardingWindow.isMinimized()) onboardingWindow.restore()
      onboardingWindow.show(); onboardingWindow.focus()
    }
  })
  app.whenReady().then(async () => {
    try { app.setAppUserModelId(APP_ID) } catch { }
    setupIPC(); createTray(); await bootstrapSkills()

    // Global Shortcut: Ctrl+Alt+C to show/focus
    globalShortcut.register('CommandOrControl+Alt+C', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) { mainWindow.hide() }
        else { mainWindow.show(); mainWindow.focus() }
      }
    })

    if (hasValidConfig()) {
      if (!isMinimized) createSplashWindow()
      // Run gateway start in background or with a shorter wait for the splash
      gateway.start().then((started) => {
        if (!started) {
          addLog('[start] Gateway failed to start, but opening UI for diagnostics.')
        }
        splashWindow?.close()
        if (!isMinimized && !mainWindow) createMainWindow()
      })

      // Safety timeout: if gateway is taking too long, show UI anyway
      setTimeout(() => {
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.close()
          if (!mainWindow && !isMinimized) createMainWindow()
        }
      }, 5000)
    } else {
      if (!isMinimized) createOnboardingWindow()
    }

    // Check for updates on startup if packaged
    if (app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify()
    }

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { if (hasValidConfig()) createMainWindow(); else createOnboardingWindow() } })
  })
  app.on('will-quit', () => { globalShortcut.unregisterAll() })
  app.on('window-all-closed', () => { })
  app.on('before-quit', () => { isQuitting = true; gateway.stop() })
}

// Initial Kick-off with a safety delay
setTimeout(startApp, 100)
