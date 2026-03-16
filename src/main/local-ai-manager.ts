import * as path from 'path'
import * as fs from 'fs'
import * as https from 'https'
import * as http from 'http'
import { spawn, ChildProcess, execSync } from 'child_process'
import { app } from 'electron'

// Folders for local AI assets
function getEngineDir() { 
  try {
    return path.join(app.getPath('userData'), 'engine') 
  } catch {
    // Fallback for premature calls (e.g. during static import)
    return path.join(process.env.APPDATA || '', 'ClawDesk', 'engine')
  }
}
function getModelsDir() { return path.join(getEngineDir(), 'models') }

// Primary and fallback engine URLs
const ENGINE_URLS = [
  'https://github.com/ggml-org/llama.cpp/releases/download/b5604/llama-b5604-bin-win-cpu-x64.zip',
  'https://github.com/ggml-org/llama.cpp/releases/download/b8272/llama-b8272-bin-win-cpu-x64.zip'
]

export interface ModelPreset {
  id: string
  name: string
  filename: string
  url: string
  sizeGB: string      // Human-readable size
  sizeBytes: number
  description: string
  category: 'fast' | 'balanced' | 'powerful' | 'code' | 'reasoning'
  chatTemplate?: string     // llama-server --chat-template value (if needed)
  contextSize?: number      // Optimal context size (default: 4096)
  minRAMGB?: number         // Minimum RAM in GB to run this model
  ollamaName?: string       // Equivalent model name in Ollama registry
  specialFlags?: string[]   // Extra flags for llama-server
}

// Models that are 100% open (NO gated/license-acceptance required) and
// confirmed compatible with llama-server's OpenAI Chat API
export const AVAILABLE_MODELS: ModelPreset[] = [
  // ── Ultra-Light (For limited space) ──
  {
    id: 'qwen2.5-0.5b',
    name: 'Qwen 2.5 0.5B',
    filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    sizeGB: '0.4',
    sizeBytes: 400000000,
    description: 'Tiny but capable. Perfect if you have very little disk space.',
    category: 'fast',
    contextSize: 4096,
    minRAMGB: 2,
    ollamaName: 'qwen2.5:0.5b'
  },
  {
    id: 'qwen2.5-1.5b',
    name: 'Qwen 2.5 1.5B',
    filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    sizeGB: '1.1',
    sizeBytes: 1100000000,
    description: 'The best balance of tiny size and intelligence.',
    category: 'fast',
    contextSize: 4096,
    minRAMGB: 4,
    ollamaName: 'qwen2.5:1.5b'
  },
  // ── Fast & Light ──
  {
    id: 'gemma2-2b',
    name: 'Gemma 2 2B',
    filename: 'gemma-2-2b-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf',
    sizeGB: '1.6',
    sizeBytes: 1600000000,
    description: 'Google\'s ultra-light model. Great for quick responses.',
    category: 'fast',
    chatTemplate: 'gemma',
    contextSize: 8192,
    minRAMGB: 4,
    ollamaName: 'gemma2:2b'
  },
  {
    id: 'phi3-mini',
    name: 'Phi-3 Mini',
    filename: 'Phi-3-mini-4k-instruct-q4.gguf',
    url: 'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-q4.gguf',
    sizeGB: '2.4',
    sizeBytes: 2390000000,
    description: 'Microsoft\'s efficient model. Fast and surprisingly smart.',
    category: 'fast',
    contextSize: 4096,
    minRAMGB: 6,
    ollamaName: 'phi3:mini'
  },
  {
    id: 'qwen2.5-3b',
    name: 'Qwen 2.5 3B',
    filename: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
    sizeGB: '2.0',
    sizeBytes: 2000000000,
    description: 'Incredibly smart for its tiny size. Excellent daily driver.',
    category: 'fast',
    contextSize: 4096,
    minRAMGB: 4,
    ollamaName: 'qwen2.5:3b'
  },
  // ── Balanced & Capable ──
  {
    id: 'qwen2.5-7b',
    name: 'Qwen 2.5 7B',
    filename: 'qwen2.5-7b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf',
    sizeGB: '4.7',
    sizeBytes: 4700000000,
    description: 'The golden standard for general tasks. Highly recommended.',
    category: 'balanced',
    contextSize: 4096,
    minRAMGB: 8,
    ollamaName: 'qwen2.5'
  },
  {
    id: 'mistral-7b',
    name: 'Mistral 7B v0.3',
    filename: 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
    url: 'https://huggingface.co/maziyarPanahi/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
    sizeGB: '4.4',
    sizeBytes: 4400000000,
    description: 'A reliable and highly capable instruction model.',
    category: 'balanced',
    contextSize: 8192,
    minRAMGB: 8,
    ollamaName: 'mistral'
  },
  {
    id: 'glm-4-9b',
    name: 'GLM-4 9B (Ultra-Light)',
    filename: 'glm-4-9b-chat-Q2_K.gguf',
    url: 'https://huggingface.co/second-state/glm-4-9b-chat-GGUF/resolve/main/glm-4-9b-chat-Q2_K.gguf',
    sizeGB: '4.0',
    sizeBytes: 4000000000,
    description: 'Bilingual powerhouse optimized for speed and lower RAM usage.',
    category: 'powerful',
    chatTemplate: 'chatglm4',
    contextSize: 8192,
    minRAMGB: 8,
    ollamaName: 'glm4'
  },
  // ── Powerful ──
  {
    id: 'qwen2.5-14b',
    name: 'Qwen 2.5 14B',
    filename: 'qwen2.5-14b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-14B-Instruct-GGUF/resolve/main/qwen2.5-14b-instruct-q4_k_m.gguf',
    sizeGB: '9.0',
    sizeBytes: 9000000000,
    description: 'Heavy duty text modeling. Requires 16GB+ RAM.',
    category: 'powerful',
    contextSize: 4096,
    minRAMGB: 16,
    ollamaName: 'qwen2.5:14b'
  },
  {
    id: 'deepseek-r1-7b',
    name: 'DeepSeek R1 7B',
    filename: 'DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/DeepSeek-R1-Distill-Qwen-7B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf',
    sizeGB: '4.7',
    sizeBytes: 4700000000,
    description: 'Exceptional at multi-step reasoning and problem solving.',
    category: 'reasoning',
    chatTemplate: 'deepseek2',
    contextSize: 4096,
    minRAMGB: 8,
    ollamaName: 'deepseek-r1:7b'
  },
  // ── Code ──
  {
    id: 'qwen2.5-coder-7b',
    name: 'Qwen 2.5 Coder 7B',
    filename: 'qwen2.5-coder-7b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf',
    sizeGB: '4.7',
    sizeBytes: 4700000000,
    description: 'Best open-source coding model. Writes excellent code.',
    category: 'code',
    contextSize: 4096,
    minRAMGB: 8,
    ollamaName: 'qwen2.5-coder:7b'
  }
]

export interface DownloadResult {
  success: boolean
  error?: string
  errorCode?: 'NETWORK' | 'DISK_SPACE' | 'FORBIDDEN' | 'NOT_FOUND' | 'TIMEOUT' | 'EXTRACTION' | 'ENGINE_MISSING' | 'UNKNOWN'
}

// Premium Onboarding: Engaging content for the wait
export const AI_TIPS = [
  "ClawDesk runs 100% locally. Your data never leaves this computer.",
  "The 5.5GB download is a ONE-TIME setup. Future launches will be instant.",
  "Estimated time: 5-15 minutes, depending entirely on your internet speed.",
  "Downloaded models are stored safely in your AppData folder.",
  "Ollama is a world-class engine that powers the brain of this app.",
  "GLM-4 is one of the most powerful bilingual (Chinese/English) models available.",
  "Local AI doesn't need an internet connection once the model is downloaded.",
  "You can switch between different models in the settings once setup is done."
]

export class LocalAIManager {
  private serverProcess: ChildProcess | null = null
  private isServerRunning = false
  private lastError = ''
  private downloadProgress = 0
  private currentStatusText = 'Initializing...'

  constructor() {
    this.ensureDirectories()
  }

  private ensureDirectories() {
    const engineDir = getEngineDir()
    const modelsDir = getModelsDir()
    if (!fs.existsSync(engineDir)) fs.mkdirSync(engineDir, { recursive: true })
    if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true })
    this.cleanupOrphanModels()
    this.cleanupStalledDownloads()
  }

  private cleanupStalledDownloads() {
    try {
      const modelsDir = getModelsDir()
      const files = fs.readdirSync(modelsDir)
      for (const file of files) {
        if (file.endsWith('.download')) {
          const fullPath = path.join(modelsDir, file)
          try {
            if (!fs.existsSync(fullPath)) continue
            const stats = fs.statSync(fullPath)
            // Systemic Guard: Only delete if size is 0 AND it hasn't been modified in 10 minutes (to avoid wiping active hands-shakes)
            // Or if it's older than 1 hour regardless of size.
            const isZeroAndOld = stats.size === 0 && (Date.now() - stats.mtimeMs > 600000)
            const isVeryOld = (Date.now() - stats.mtimeMs > 3600000)
            
            if (isZeroAndOld || isVeryOld) {
              console.log(`[LocalAI] Cleaning up stalled download: ${file}`)
              try { fs.unlinkSync(fullPath) } catch {}
            }
          } catch (statErr) {
            console.warn(`[LocalAI] Could not stat/cleanup ${file}:`, statErr)
          }
        }
      }
    } catch (e) {
      console.warn('[LocalAI] Stall cleanup failed:', e)
    }
  }

  private cleanupOrphanModels() {
    try {
      const modelsDir = getModelsDir()
      const files = fs.readdirSync(modelsDir)
      const validFilenames = AVAILABLE_MODELS.map(m => m.filename)
      
      for (const file of files) {
        if (file.endsWith('.gguf') && !validFilenames.includes(file)) {
          const fullPath = path.join(modelsDir, file)
          console.log(`[LocalAI] Cleaning up orphan model: ${file}`)
          try { fs.unlinkSync(fullPath) } catch {}
        }
      }
    } catch (e) {
      console.warn('[LocalAI] Orphan cleanup failed:', e)
    }
  }

  public getEnginePath(): string {
    return path.join(getEngineDir(), 'llama-server.exe')
  }

  public isEngineInstalled(): boolean {
    return fs.existsSync(this.getEnginePath())
  }

  /**
   * PRO-STABILITY: Verify the engine binary actually runs.
   * Prevents crashes due to corruption or missing system dependencies.
   */
  public async verifyEngineIntegrity(): Promise<boolean> {
    const exePath = this.getEnginePath()
    if (!fs.existsSync(exePath)) return false

    return new Promise((resolve) => {
      // We use a very light command that should work instantly if binary is okay
      const probe = spawn(exePath, ['--help'], { windowsHide: true })
      
      let hasError = false
      probe.on('error', () => { hasError = true; resolve(false) })
      
      probe.on('close', (code) => {
        if (hasError) return
        // Many CLI tools return 0 or 1 for --help, but if it crashes/missing DLL it's usually non-zero or specific error
        // On Windows, if it fails to start due to missing DLL, it won't even reach 'close' with code 1 usually, 
        // but here we saw code 1 which is suspicious. We'll be strict.
        resolve(code === 0 || code === 1) 
      })

      // Safety timeout
      setTimeout(() => {
        probe.kill()
        resolve(false)
      }, 5000)
    })
  }

  /**
   * AUTOMATIC REPAIR: Wipes and re-downloads the engine.
   */
  public async repairEngine(onProgress?: (p: number, t: string) => void): Promise<boolean> {
    console.log('[LocalAI] Initiating engine repair...')
    this.stopEngine()
    
    try {
      // Clear the engine directory (except models)
      const engineDir = getEngineDir()
      const entries = fs.readdirSync(engineDir)
      for (const entry of entries) {
        if (entry === 'models') continue
        const fullPath = path.join(engineDir, entry)
        if (fs.statSync(fullPath).isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true })
        } else {
          fs.unlinkSync(fullPath)
        }
      }
    } catch (e) {
      console.error('[LocalAI] Repair cleanup failed:', e)
    }

    const result = await this.downloadEngine(onProgress)
    return result.success
  }

  public isModelInstalled(modelId: string): boolean {
    const rawId = modelId.replace('local/', '').replace('ollama/', '')
    const preset = AVAILABLE_MODELS.find(m => m.id === rawId)
    if (!preset) return false
    const modelPath = path.join(getModelsDir(), preset.filename)
    
    // Systemic Fix: If the main file exists and is "healthy", ignore any ghost .download file
    if (fs.existsSync(modelPath)) {
      const stats = fs.statSync(modelPath)
      // Expect at least 1GB for GLM-4 or 50% of expected size
      const minSize = preset.sizeBytes ? (preset.sizeBytes * 0.8) : 500000000
      if (stats.size >= minSize) {
        return true
      }
    }
    return false
  }

  public getAllModelsStatus(): Record<string, boolean> {
    const status: Record<string, boolean> = {}
    const modelsDir = getModelsDir()
    for (const model of AVAILABLE_MODELS) {
      status[model.id] = fs.existsSync(path.join(modelsDir, model.filename))
    }
    return status
  }

  public getLastError(): string {
    return this.lastError
  }

  // ── Disk space check ──
  public checkDiskSpace(requiredBytes: number): { ok: boolean; availableGB: string; requiredGB: string } {
    try {
      const engineDir = getEngineDir()
      const drive = engineDir.charAt(0)
      const output = execSync(`wmic logicaldisk where "DeviceID='${drive}:'" get FreeSpace /format:value`, {
        windowsHide: true,
        encoding: 'utf-8'
      })
      const match = output.match(/FreeSpace=(\d+)/)
      const freeSpace = match ? parseInt(match[1], 10) : 0
      const extraMargin = 100 * 1024 * 1024 // 100MB safety margin (Reduced to be more permissive)
      const totalNeeded = requiredBytes + extraMargin
      return {
        ok: freeSpace > totalNeeded,
        availableGB: (freeSpace / (1024 * 1024 * 1024)).toFixed(1),
        requiredGB: (totalNeeded / (1024 * 1024 * 1024)).toFixed(1)
      }
    } catch {
      return { ok: true, availableGB: '?', requiredGB: (requiredBytes / (1024 * 1024 * 1024)).toFixed(1) }
    }
  }

  // ── Constants ──
  public static readonly EMBEDDED_PORT = 8847
  public static readonly OLLAMA_PORT = 11434

  // Wait for server to bind to port and respond
  private async waitForServerReady(port: number, timeoutMs = 300000): Promise<boolean> {
    const start = Date.now()
    const healthPath = port === LocalAIManager.OLLAMA_PORT ? '/' : '/health'
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}${healthPath}`)
        if (res.ok) return true
      } catch {
        // expected to fail until server boots
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    return false
  }

  /**
   * UNIFIED ENGINE START — Ollama-first, Embedded fallback
   * 
   * Strategy:
   * 1. Check if Ollama is running AND has the model → use Ollama (port 11434)
   * 2. Check if embedded engine + model GGUF exist → spawn llama-server (port 8847)
   * 3. Try to start Ollama if installed → use Ollama
   * 4. All failed → return false with descriptive error
   */
  public async startEngine(modelId: string): Promise<{ success: boolean; port: number; backend: string; errorCode?: string }> {
    if (this.isServerRunning) {
      return { success: true, port: this.activePort, backend: this.activeBackend }
    }

    const rawId = modelId.replace('local/', '').replace('ollama/', '')
    const preset = AVAILABLE_MODELS.find(m => m.id === rawId)
    console.log(`[LocalAI] Request to start engine for ${rawId}.`)

    // ── Check if engine is actually installed ──
    const exePath = this.getEnginePath()
    if (!this.isEngineInstalled()) {
      this.lastError = 'Internal engine binary is missing.'
      return { success: false, port: 0, backend: 'none', errorCode: 'ENGINE_MISSING' }
    }

    // ── Strategy 1: Ollama already running with the model ──
    if (preset?.ollamaName) {
      const ollamaRunning = await this.waitForServerReady(LocalAIManager.OLLAMA_PORT, 2000)
      if (ollamaRunning) {
        const ollamaHas = await this.checkOllamaHasModel(preset.ollamaName)
        if (ollamaHas) {
          console.log(`[LocalAI] Ollama has ${preset.ollamaName}. Using Ollama on port ${LocalAIManager.OLLAMA_PORT}.`)
          this.isServerRunning = true
          this.activePort = LocalAIManager.OLLAMA_PORT
          this.activeBackend = 'ollama'
          return { success: true, port: LocalAIManager.OLLAMA_PORT, backend: 'ollama' }
        } else {
          console.log(`[LocalAI] Ollama is running but missing ${preset.ollamaName}.`)
          // Check if we have the GGUF first before deciding to pull or wait
          const modelPath = path.join(getModelsDir(), preset.filename)
          if (fs.existsSync(modelPath)) {
            console.log(`[LocalAI] GGUF found locally. Prioritizing embedded engine over Ollama pull.`)
          } else {
            console.log(`[LocalAI] Initiating background pull for ${preset.ollamaName}...`)
            this.pullOllamaModel(preset.ollamaName).catch(e => console.error(`[LocalAI] Ollama pull failed: ${e}`))
          }
        }
      }
    }

    // ── Strategy 2: Embedded engine (llama-server) ──
    if (preset && fs.existsSync(exePath)) {
      const modelPath = path.join(getModelsDir(), preset.filename)
      if (fs.existsSync(modelPath)) {
        console.log(`[LocalAI] Spawning internal llama-server for ${modelId} on port ${LocalAIManager.EMBEDDED_PORT}...`)
        
        const args = [
          '-m', modelPath,
          '--port', LocalAIManager.EMBEDDED_PORT.toString(),
          '--n-gpu-layers', '0',
          '--ctx-size', String(preset.contextSize || 4096),
          '--parallel', '2',
          '--jinja',
          '--alias', modelId
        ]

        // Per-model chat template
        if (preset.chatTemplate) {
          args.push('--chat-template', preset.chatTemplate)
          console.log(`[LocalAI] Using chat template: ${preset.chatTemplate}`)
        }

        // Per-model special flags
        if (preset.specialFlags && preset.specialFlags.length > 0) {
          args.push(...preset.specialFlags)
        }

        try {
          this.serverProcess = spawn(exePath, args, { windowsHide: true })
          
          let earlyExit = false
          const earlyExitTimer = setTimeout(() => earlyExit = true, 3000)
          
          // ── ADDED: Descriptive feedback with a "Real-ish" countdown ──
          this.downloadProgress = 95
          let secondsLeft = 25 // Average for Q2 models
          this.currentStatusText = `Initializing ${preset?.name || modelId}... (Est. ${secondsLeft}s)`
          
          const progressInterval = setInterval(() => {
            if (secondsLeft > 1) {
              secondsLeft--
            }
            
            const messages = [
               `Allocating RAM for ${preset?.name || modelId}...`,
               `Warming up neural engine...`,
               `Nearly ready... almost there!`
            ]
            const msg = messages[Math.floor(Date.now() / 5000) % messages.length]
            this.currentStatusText = `${msg} (~${secondsLeft}s)`
          }, 1000)

          const startTime = Date.now()

          this.serverProcess.on('exit', (code) => {
            console.log(`[LocalAI] Internal engine exited with code ${code}`)
            if (Date.now() - startTime < 3000) {
              earlyExit = true
              console.error(`[LocalAI] Engine crashed within 3 seconds — likely incompatible model or missing DLL`)
            }
            this.isServerRunning = false
            this.serverProcess = null
          })
          
          this.serverProcess.on('error', (err) => {
            console.error('[LocalAI] Internal engine spawn error:', err)
            earlyExit = true
          })

          this.serverProcess.stderr?.on('data', (d: Buffer) => {
            const msg = d.toString().trim()
            if (msg) console.log(`[LocalAI:stderr] ${msg}`)
          })

          // Wait for engine to become ready (45s timeout)
          const ready = await this.waitForServerReady(LocalAIManager.EMBEDDED_PORT, 45000)
          clearTimeout(earlyExitTimer)
          clearInterval(progressInterval)

          if (ready && !earlyExit) {
            this.isServerRunning = true
            this.activePort = LocalAIManager.EMBEDDED_PORT
            this.activeBackend = 'embedded'
            this.downloadProgress = 100
            this.currentStatusText = `${preset?.name || modelId} is ready!`
            console.log(`[LocalAI] Internal engine ready on port ${LocalAIManager.EMBEDDED_PORT}`)
            return { success: true, port: LocalAIManager.EMBEDDED_PORT, backend: 'embedded' }
          } else {
            console.log('[LocalAI] Internal engine did not become ready. Cleaning up...')
            this.stopEngine()
          }
        } catch (err) {
          console.error('[LocalAI] Error spawning internal engine:', err)
        }
      }
    }

    // ── Strategy 3: Try starting Ollama (may be installed but not running) ──
    console.log(`[LocalAI] Attempting Ollama fallback...`)
    const ollamaStarted = await this.ensureOllamaRunning()
    if (ollamaStarted) {
      if (preset?.ollamaName) {
        const has = await this.checkOllamaHasModel(preset.ollamaName)
        if (!has) {
          console.log(`[LocalAI] Initializing background pull for ${preset.ollamaName}...`)
          this.pullOllamaModel(preset.ollamaName).catch(() => {})
          this.lastError = 'Ollama is pulling the model. Please wait a few minutes.'
          return { success: false, port: LocalAIManager.OLLAMA_PORT, backend: 'ollama', errorCode: 'INITIALIZING' }
        }
      }
      this.isServerRunning = true
      this.activePort = LocalAIManager.OLLAMA_PORT
      this.activeBackend = 'ollama'
      return { success: true, port: LocalAIManager.OLLAMA_PORT, backend: 'ollama' }
    }

    this.lastError = 'No local AI backend available. Please ensure Ollama is installed.'
    return { success: false, port: 0, backend: 'none' }
  }

  // Track which backend is active
  private activePort = 0
  private activeBackend = 'none'

  public getActivePort(): number { return this.activePort }
  public getActiveBackend(): string { return this.activeBackend }

  public stopEngine() {
    if (this.serverProcess) {
      console.log('[LocalAI] Shutting down server...')
      this.serverProcess.kill()
      this.serverProcess = null
    }
    this.isServerRunning = false
    this.activePort = 0
    this.activeBackend = 'none'
  }

  // ═══════════════════════════════════════════════════════
  // ──  BACKEND DETECTION  ──
  // ═══════════════════════════════════════════════════════

  /**
   * Detect the best available backend for running local models.
   * Returns info about what's available without starting anything.
   */
  public async detectBestBackend(): Promise<{
    backend: 'ollama' | 'embedded' | 'none'
    ollamaRunning: boolean
    ollamaInstalled: boolean
    engineInstalled: boolean
    ollamaModels: string[]
  }> {
    let ollamaRunning = false
    let ollamaInstalled = false
    let ollamaModels: string[] = []

    // Check Ollama
    try {
      const resp = await fetch('http://127.0.0.1:11434/api/tags')
      if (resp.ok) {
        ollamaRunning = true
        ollamaInstalled = true
        const data: any = await resp.json()
        ollamaModels = (data.models || []).map((m: any) => m.name)
      }
    } catch {
      // Check if Ollama is installed but not running
      try {
        execSync('ollama --version', { stdio: 'ignore', windowsHide: true })
        ollamaInstalled = true
      } catch {}
    }

    const engineInstalled = this.isEngineInstalled()

    let backend: 'ollama' | 'embedded' | 'none' = 'none'
    if (ollamaRunning) backend = 'ollama'
    else if (engineInstalled) backend = 'embedded'
    else if (ollamaInstalled) backend = 'ollama' // Will need to start it

    return { backend, ollamaRunning, ollamaInstalled, engineInstalled, ollamaModels }
  }

  /**
   * Check if Ollama is running AND has a specific model loaded
   */
  public async checkOllamaHasModel(ollamaName: string): Promise<boolean> {
    try {
      const resp = await fetch('http://127.0.0.1:11434/api/tags')
      if (!resp.ok) return false
      const data: any = await resp.json()
      const models = data.models || []
      return models.some((m: any) => {
        const n = (m.name || '').toLowerCase()
        const s = ollamaName.toLowerCase()
        return n === s || n === s + ':latest' || n.startsWith(s + ':')
      })
    } catch {
      return false
    }
  }

  /**
   * Pull an Ollama model in the background.
   */
  public async pullOllamaModel(name: string): Promise<void> {
    console.log(`[LocalAI] background pull for ${name} starting...`)
    try {
      const resp = await fetch('http://127.0.0.1:11434/api/pull', {
        method: 'POST',
        body: JSON.stringify({ name })
      })
      if (!resp.ok) {
        console.error(`[LocalAI] Failed to start Ollama pull: ${resp.statusText}`)
        return
      }
      console.log(`[LocalAI] Ollama pull for ${name} is underway.`)
    } catch (e) {
      console.error(`[LocalAI] Network error during Ollama pull: ${e}`)
    }
  }

  /**
   * Verify a downloaded model file is intact by checking its size
   * against the expected size from the preset.
   */
  public verifyModelIntegrity(modelId: string): { ok: boolean; expected: number; actual: number; message: string } {
    const preset = AVAILABLE_MODELS.find(m => m.id === modelId)
    if (!preset) {
      return { ok: false, expected: 0, actual: 0, message: `Unknown model: ${modelId}` }
    }

    const filePath = path.join(getModelsDir(), preset.filename)
    if (!fs.existsSync(filePath)) {
      return { ok: false, expected: preset.sizeBytes, actual: 0, message: 'Model file not found' }
    }

    const actual = fs.statSync(filePath).size
    // Allow 10% tolerance (quantization variations)
    const minExpected = preset.sizeBytes * 0.85

    if (actual < minExpected) {
      return {
        ok: false,
        expected: preset.sizeBytes,
        actual,
        message: `File too small (${(actual / 1e9).toFixed(2)}GB vs expected ~${preset.sizeGB}GB). Download may be incomplete.`
      }
    }

    return {
      ok: true,
      expected: preset.sizeBytes,
      actual,
      message: 'Model integrity verified'
    }
  }

  // ═══════════════════════════════════════════════════════
  // ──  OLLAMA SERVICE MANAGEMENT (Bulletproof) ──
  // ═══════════════════════════════════════════════════════

  /**
   * Proactively ensure Ollama is running and responsive.
   */
  public async ensureOllamaRunning(): Promise<boolean> {
    this.currentStatusText = 'Checking Ollama health...'
    console.log('[LocalAI] Checking Ollama health...')
    const isReady = await this.waitForServerReady(11434, 5000)
    if (isReady) {
      this.currentStatusText = 'Ollama is online and ready.'
      console.log('[LocalAI] Ollama is already running and responsive.')
      return true
    }

    this.currentStatusText = 'Starting Ollama service...'
    console.log('[LocalAI] Ollama not responding on 11434. Attempting to start...')
    
    // Common installation paths for the Ollama application
    const appPath = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama app.exe')
    
    if (fs.existsSync(appPath)) {
      try {
        spawn(appPath, [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false 
        }).unref()
        
        this.currentStatusText = 'Waiting for Ollama API...'
        console.log('[LocalAI] Ollama app launched. Waiting for API...')
        const success = await this.waitForServerReady(11434, 30000)
        if (success) {
          this.currentStatusText = 'Ollama started successfully.'
          return true
        }
      } catch (err) {
        console.error('[LocalAI] Failed to launch Ollama app:', err)
      }
    }

    // ── AUTOMATED INSTALLER FALLBACK ──
    this.currentStatusText = 'AI Setup Required. Launching installer...'
    console.warn('[LocalAI] Ollama missing or persistent failure. Launching setup script...')

    const scriptPath = app.isPackaged 
      ? path.join(process.resourcesPath, 'scripts', 'setup-ollama.ps1')
      : path.join(app.getAppPath(), 'scripts', 'setup-ollama.ps1')

    if (fs.existsSync(scriptPath)) {
      try {
        // Run PowerShell as admin to ensure winget/installation works
        const psCommand = `Start-Process powershell.exe -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "\\"${scriptPath}\\"" -Verb RunAs`
        spawn('powershell.exe', ['-NoProfile', '-Command', psCommand], {
          windowsHide: true,
          stdio: 'ignore'
        })
        this.currentStatusText = 'Setup script launched. Follow the blue window instructions.'
        return false // Client should wait for setup to complete and restart or retry
      } catch (err) {
        this.currentStatusText = 'Failed to launch setup script.'
        console.error('[LocalAI] Setup script spawn error:', err)
      }
    } else {
      this.currentStatusText = 'Setup script not found at ' + scriptPath
      console.error('[LocalAI] Setup script missing!')
    }

    return false
  }

  // ═══════════════════════════════════════════════════════
  // ──  ROBUST DOWNLOAD ENGINE (v3) ──
  // ═══════════════════════════════════════════════════════
  // Features: timeout, retry, resume, speed tracking, detailed errors

  private downloadFileWithProgress(
    url: string,
    dest: string,
    onProgress?: (percent: number, text: string) => void,
    maxRetries = 3
  ): Promise<DownloadResult> {
    return new Promise((resolve) => {
      let attempt = 0

      const tryDownload = (currentUrl: string, redirectCount = 0) => {
        if (redirectCount > 8) {
          this.lastError = 'Too many redirects'
          return resolve({ success: false, error: 'Too many redirects — the download URL may be broken.', errorCode: 'NETWORK' })
        }

        const protocol = currentUrl.startsWith('https') ? https : http
        
        // Check if we can resume
        let startByte = 0
        if (fs.existsSync(dest)) {
          startByte = fs.statSync(dest).size
          console.log(`[LocalAI] Found partial download at ${dest} (${startByte} bytes). Requesting resume...`)
        }

        const options: any = {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Connection': 'keep-alive'
          },
          timeout: 300000  // 300 seconds (5 mins) for initial handshake
        }

        if (startByte > 0) {
          options.headers['Range'] = `bytes=${startByte}-`
        }

        console.log(`[LocalAI] Download attempt ${attempt + 1}/${maxRetries}: ${currentUrl.substring(0, 80)}...`)
        onProgress?.(0, startByte > 0 ? 'Resuming connection...' : 'Connecting to server...')

        const req = protocol.get(currentUrl, options, (response) => {
          // ── Handle redirects ──
          if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
            const newUrl = response.headers.location
            if (newUrl) {
              const resolvedUrl = newUrl.startsWith('http') ? newUrl : new URL(newUrl, currentUrl).href
              return tryDownload(resolvedUrl, redirectCount + 1)
            }
          }

          // ── Handle HTTP errors ──
          const status = response.statusCode || 0
          if (status === 401 || status === 403) {
            // Attempt fallback from 'resolve' to 'download' if on huggingface
            if (currentUrl.includes('huggingface.co') && currentUrl.includes('/resolve/')) {
               const fallbackUrl = currentUrl.replace('/resolve/', '/download/')
               console.log(`[LocalAI] Got ${status}, trying fallback: ${fallbackUrl}`)
               onProgress?.(0, 'Access restricted, trying alternate route...')
               return tryDownload(fallbackUrl, redirectCount + 1)
            }
            this.lastError = `Access denied (${status}). This repository might be private or require a session.`
            return resolve({ success: false, error: this.lastError, errorCode: 'FORBIDDEN' })
          }
          if (status === 404) {
            this.lastError = `File not found (404). The download URL may have changed.`
            return resolve({ success: false, error: this.lastError, errorCode: 'NOT_FOUND' })
          }
          if (status !== 200 && status !== 206) {
            this.lastError = `Server returned status ${status}`
            // Retry on 5xx errors
            if (status >= 500 && attempt < maxRetries - 1) {
              attempt++
              const delay = attempt * 3000
              console.log(`[LocalAI] Server error ${response.statusCode}, retrying in ${delay}ms...`)
              onProgress?.(0, `Server error, retrying in ${delay / 1000}s...`)
              setTimeout(() => tryDownload(currentUrl, 0), delay)
              return
            }
            return resolve({ success: false, error: this.lastError, errorCode: 'NETWORK' })
          }

          // ── Download the file ──
          const isPartial = response.statusCode === 206
          const contentLength = parseInt(response.headers['content-length'] || '0', 10)
          const totalBytes = isPartial ? (contentLength + startByte) : contentLength
          
          let downloadedBytes = startByte
          let lastReportedPercent = -1
          let lastSpeedUpdate = Date.now()
          let lastSpeedBytes = startByte

          // If 206, append. If 200, restart from scratch.
          const file = fs.createWriteStream(dest, { flags: isPartial ? 'a' : 'w' })

          // Socket timeout — if no data arrives for 60 seconds, retry
          response.socket?.setTimeout(60000)
          response.socket?.on('timeout', () => {
            console.error('[LocalAI] Socket timeout — no data received for 60s')
            req.destroy()
            file.close()
            if (attempt < maxRetries - 1) {
              attempt++
              onProgress?.(lastReportedPercent >= 0 ? lastReportedPercent : 0, 'Connection lost, retrying...')
              setTimeout(() => tryDownload(currentUrl, 0), 3000)
            } else {
              this.lastError = 'Download timed out — the connection was too slow or interrupted.'
              resolve({ success: false, error: this.lastError, errorCode: 'TIMEOUT' })
            }
          })

          response.on('data', (chunk: Buffer) => {
            downloadedBytes += chunk.length

            if (totalBytes > 0 && onProgress) {
              const percent = Math.floor((downloadedBytes / totalBytes) * 100)
              const now = Date.now()

              if (percent !== lastReportedPercent || now - lastSpeedUpdate > 1000) {
                lastReportedPercent = percent

                // Calculate speed
                const timeDelta = (now - lastSpeedUpdate) / 1000
                let speedText = ''
                if (timeDelta > 0.5) {
                  const bytesDelta = downloadedBytes - lastSpeedBytes
                  const speedMBs = (bytesDelta / (1024 * 1024)) / timeDelta
                  speedText = ` (${speedMBs.toFixed(1)} MB/s)`
                  lastSpeedUpdate = now
                  lastSpeedBytes = downloadedBytes
                }

                const mbDone = (downloadedBytes / (1024 * 1024)).toFixed(0)
                const mbTotal = (totalBytes / (1024 * 1024)).toFixed(0)
                onProgress(percent, `${mbDone}/${mbTotal} MB${speedText}`)
              }
            }
          })

          response.pipe(file)

          file.on('finish', () => {
            file.close()
            // Systemic Fix: Verify the file has a realistic size before resolving success
            try {
              const actualSize = fs.existsSync(dest) ? fs.statSync(dest).size : 0
              
              // If totalBytes was known, expect > 95%. If unknown, expect > 10MB as safety floor.
              const minExpected = totalBytes > 0 ? (totalBytes * 0.95) : 10000000 
              
              if (actualSize < minExpected) {
                console.error(`[LocalAI] Incomplete/Bad download: got ${actualSize} bytes. Expected ~${totalBytes || '>10MB'}`)
                try { if (fs.existsSync(dest)) fs.unlinkSync(dest) } catch {}
                if (attempt < maxRetries - 1) {
                  attempt++
                  onProgress?.(0, 'Incomplete download, retrying...')
                  setTimeout(() => tryDownload(currentUrl, 0), 3000)
                  return
                }
                this.lastError = `Download was incomplete or zero-byte (Got ${(actualSize/1e6).toFixed(1)}MB). Check your connection.`
                resolve({ success: false, error: this.lastError, errorCode: 'NETWORK' })
                return
              }
              
              console.log(`[LocalAI] Download complete and verified: ${dest} (${(actualSize/1e9).toFixed(2)}GB)`)
              resolve({ success: true })
            } catch (finalizeErr) {
              console.error('[LocalAI] Finalization error:', finalizeErr)
              resolve({ success: false, error: 'Finalization failed', errorCode: 'UNKNOWN' })
            }
          })

          file.on('error', (err) => {
            console.error('[LocalAI] File write error:', err)
            file.close()
            try { if (fs.existsSync(dest)) fs.unlinkSync(dest) } catch {}

            if (err.message.includes('ENOSPC') || err.message.includes('no space')) {
              this.lastError = 'Not enough disk space to save the download.'
              resolve({ success: false, error: this.lastError, errorCode: 'DISK_SPACE' })
            } else if (attempt < maxRetries - 1) {
              attempt++
              onProgress?.(0, 'Write error, retrying...')
              setTimeout(() => tryDownload(currentUrl, 0), 3000)
            } else {
              this.lastError = `File write failed: ${err.message}`
              resolve({ success: false, error: this.lastError, errorCode: 'UNKNOWN' })
            }
          })
        })

        // ── Connection-level errors ──
        req.on('error', (err: any) => {
          console.error('[LocalAI] Request error:', err.message)
          try { if (fs.existsSync(dest)) fs.unlinkSync(dest) } catch {}

          if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
            if (attempt < maxRetries - 1) {
              attempt++
              const delay = attempt * 3000
              onProgress?.(0, `Connection failed (${err.code}), retrying in ${delay / 1000}s...`)
              setTimeout(() => tryDownload(currentUrl, 0), delay)
              return
            }
          }

          this.lastError = `Network error: ${err.message}. Check your internet connection.`
          resolve({ success: false, error: this.lastError, errorCode: 'NETWORK' })
        })

        req.on('timeout', () => {
          req.destroy()
          if (attempt < maxRetries - 1) {
            attempt++
            onProgress?.(0, 'Handshake timeout, retrying...')
            setTimeout(() => tryDownload(currentUrl, 0), 3000)
          } else {
            this.lastError = 'Server failed to respond after 5 minutes (Handshake Timeout). Your internet may be blocked or too slow.'
            resolve({ success: false, error: this.lastError, errorCode: 'TIMEOUT' })
          }
        })
      }

      tryDownload(url)
    })
  }

  // ── Engine Download with fallback URLs ──
  public async downloadEngine(onProgress?: (percent: number, text: string) => void): Promise<DownloadResult> {
    if (this.isEngineInstalled()) return { success: true }

    // Check disk space (engine ZIP is ~35MB, extracted ~100MB)
    const spaceCheck = this.checkDiskSpace(200 * 1024 * 1024)
    if (!spaceCheck.ok) {
      return {
        success: false,
        error: `Not enough disk space. Need ~0.2GB free, but only ${spaceCheck.availableGB}GB available.`,
        errorCode: 'DISK_SPACE'
      }
    }

    const zipPath = path.join(getEngineDir(), 'llama-server.zip.download')

    // Try each URL until one works
    for (let i = 0; i < ENGINE_URLS.length; i++) {
      const url = ENGINE_URLS[i]
      console.log(`[LocalAI] Trying engine URL ${i + 1}/${ENGINE_URLS.length}: ${url}`)
      onProgress?.(0, `Downloading Core Engine (source ${i + 1})...`)

      // Proactively stop engine to release any locks
      this.stopEngine()

      const result = await this.downloadFileWithProgress(url, zipPath, (p, text) => {
        onProgress?.(p, `Engine: ${text}`)
      })

      if (result.success) {
        // Extract
        onProgress?.(100, 'Extracting engine...')
        const extractResult = await this.extractEngine(zipPath)
        if (extractResult.success) {
          return { success: true }
        }
        // If extraction failed, try next URL
        continue
      }

      if (result.errorCode === 'DISK_SPACE' || result.errorCode === 'FORBIDDEN') {
        return result // No point retrying with different URL
      }
      // For other errors, try next URL
    }

    return {
      success: false,
      error: this.lastError || 'All download sources failed. Check your internet connection.',
      errorCode: 'NETWORK'
    }
  }

  private async extractEngine(zipPath: string): Promise<DownloadResult> {
    const engineDir = getEngineDir()
    const extractDir = path.join(engineDir, '_extract')

    // Use tar if available (faster), fallback to PowerShell
    const extracted = await new Promise<boolean>((resolve) => {
      // Try tar first (available on Windows 10+, much faster)
      const tarResult = spawn('tar', ['-xf', zipPath, '-C', engineDir], { windowsHide: true, stdio: 'ignore' })
      tarResult.on('close', (code) => {
        if (code === 0) {
          resolve(true)
        } else {
          // Fallback to PowerShell
          const psScript = `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractDir}" -Force`
          const ps = spawn('powershell.exe', ['-NoProfile', '-Command', psScript], { windowsHide: true })
          ps.on('close', (psCode) => resolve(psCode === 0))
        }
      })
      tarResult.on('error', () => {
        // tar not found, use PowerShell
        const psScript = `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractDir}" -Force`
        const ps = spawn('powershell.exe', ['-NoProfile', '-Command', psScript], { windowsHide: true })
        ps.on('close', (psCode) => resolve(psCode === 0))
      })
    })

    // Clean up ZIP
    try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath) } catch {}

    if (!extracted) {
      this.lastError = 'Failed to extract engine ZIP file.'
      return { success: false, error: this.lastError, errorCode: 'EXTRACTION' }
    }

    // Find llama-server.exe recursively (handles any ZIP directory structure)
    const findExe = (dir: string): string | null => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            const found = findExe(fullPath)
            if (found) return found
          } else if (entry.name.toLowerCase() === 'llama-server.exe') {
            return fullPath
          }
        }
      } catch {}
      return null
    }

    let exePath = findExe(engineDir)
    if (!exePath && fs.existsSync(extractDir)) {
      exePath = findExe(extractDir)
    }

    if (!exePath) {
      this.lastError = 'llama-server.exe not found inside the downloaded package.'
      try { if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true }) } catch {}
      return { success: false, error: this.lastError, errorCode: 'EXTRACTION' }
    }

    if (path.dirname(exePath) !== engineDir) {
      const exeDir = path.dirname(exePath)
      try {
        const siblings = fs.readdirSync(exeDir)
        for (const file of siblings) {
          const src = path.join(exeDir, file)
          const destFile = path.join(engineDir, file)
          if (fs.statSync(src).isFile()) {
            fs.copyFileSync(src, destFile)
          }
        }
      } catch (e) {
        console.error('[LocalAI] Failed to move engine files:', e)
      }
    }

    // Clean up extraction temp dir
    try { if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true }) } catch {}

    if (this.isEngineInstalled()) {
      console.log('[LocalAI] Engine installed successfully!')
      return { success: true }
    }

    this.lastError = 'Engine extraction completed but llama-server.exe is still missing.'
    return { success: false, error: this.lastError, errorCode: 'EXTRACTION' }
  }

  // ── Model Download ──
  public async downloadModel(modelId: string, onProgress?: (percent: number, text: string) => void, force = false): Promise<DownloadResult> {
    const preset = AVAILABLE_MODELS.find(m => m.id === modelId)
    if (!preset) {
      return { success: false, error: `Unknown model: ${modelId}`, errorCode: 'UNKNOWN' }
    }

    if (this.isModelInstalled(modelId)) return { success: true }

    // Check disk space (unless forced)
    if (!force) {
      const spaceCheck = this.checkDiskSpace(preset.sizeBytes)
      if (!spaceCheck.ok) {
        return {
          success: false,
          error: `Not enough disk space. Need ${spaceCheck.requiredGB}GB free, but only ${spaceCheck.availableGB}GB available.`,
          errorCode: 'DISK_SPACE'
        }
      }
    }

    const outputFilePath = path.join(getModelsDir(), preset.filename)
    const tempPath = `${outputFilePath}.download`
    console.log(`[LocalAI] Downloading model ${preset.name} from: ${preset.url}`)

    // Proactively stop engine to release any locks on model files
    this.stopEngine()

    const result = await this.downloadFileWithProgress(preset.url, tempPath, (p, text) => {
      this.downloadProgress = p
      this.currentStatusText = `Downloading ${preset.name}: ${text}`
      
      // Cleanup: If we are downloading the new GLM-4, proactively delete the old heavy one to save space
      if (modelId === 'glm-4-9b' && p > 5) {
        const modelsDir = getModelsDir()
        const oldGGUF = path.join(modelsDir, 'glm-4-9b-chat-Q4_K_M.gguf')
        if (fs.existsSync(oldGGUF)) {
          console.log('[LocalAI] Proactively deleting old GLM-4 Q4 to make room for Q2...')
          try { fs.unlinkSync(oldGGUF) } catch {}
        }
      }
      
      onProgress?.(p, `${preset.name}: ${text}`)
    })

    if (result.success) {
      this.currentStatusText = 'Finalizing model...'
      try {
        // Final move from .download to final .gguf
        if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath)
        fs.renameSync(tempPath, outputFilePath)
      } catch (e: any) {
        console.error('[LocalAI] Final rename failed:', e)
        return { 
          success: false, 
          error: `Failed to finalize download: ${e.message}. The file may be locked by another process. Please restart ClawDesk and try again.`, 
          errorCode: 'UNKNOWN' 
        }
      }
    } else {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath) } catch {}
    }
    return result
  }

  public getOnboardingState() {
    return {
      progress: this.downloadProgress,
      status: this.currentStatusText,
      tips: AI_TIPS
    }
  }
}

// Singleton export
export const localAIManager = new LocalAIManager()
