import * as path from 'path'
import * as fs from 'fs'
import * as https from 'https'
import * as http from 'http'
import { spawn, ChildProcess, execSync } from 'child_process'
import { app } from 'electron'

const ENGINE_DIR = path.join(app.getPath('userData'), 'engine')
const MODELS_DIR = path.join(ENGINE_DIR, 'models')

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
}

// Models that are 100% open (NO gated/license-acceptance required) and
// confirmed compatible with llama-server's OpenAI Chat API
export const AVAILABLE_MODELS: ModelPreset[] = [
  // ── Fast & Light ──
  {
    id: 'gemma2-2b',
    name: 'Gemma 2 2B',
    filename: 'gemma-2-2b-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf',
    sizeGB: '1.6',
    sizeBytes: 1600000000,
    description: 'Google\'s ultra-light model. Great for quick responses.',
    category: 'fast'
  },
  {
    id: 'phi3-mini',
    name: 'Phi-3 Mini',
    filename: 'Phi-3-mini-4k-instruct-q4.gguf',
    url: 'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-q4.gguf',
    sizeGB: '2.4',
    sizeBytes: 2390000000,
    description: 'Microsoft\'s efficient model. Fast and surprisingly smart.',
    category: 'fast'
  },
  {
    id: 'qwen2.5-3b',
    name: 'Qwen 2.5 3B',
    filename: 'Qwen2.5-3B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
    sizeGB: '2.1',
    sizeBytes: 2100000000,
    description: 'Alibaba\'s compact powerhouse. Best balance of speed & smarts.',
    category: 'fast'
  },
  // ── Balanced ──
  {
    id: 'qwen2.5-7b',
    name: 'Qwen 2.5 7B',
    filename: 'qwen2.5-7b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf',
    sizeGB: '4.7',
    sizeBytes: 4700000000,
    description: 'Best 7B model available. Excellent for everything.',
    category: 'balanced'
  },
  {
    id: 'mistral-7b',
    name: 'Mistral 7B v0.3',
    filename: 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
    sizeGB: '4.1',
    sizeBytes: 4100000000,
    description: 'Classic reliable model. Great for general conversation.',
    category: 'balanced'
  },
  // ── Powerful ──
  {
    id: 'glm-4-9b',
    name: 'GLM-4 9B',
    filename: 'glm-4-9b-chat-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/glm-4-9b-chat-GGUF/resolve/main/glm-4-9b-chat-Q4_K_M.gguf',
    sizeGB: '5.5',
    sizeBytes: 5500000000,
    description: 'Tsinghua\'s powerful model. Strong multilingual support.',
    category: 'powerful'
  },
  {
    id: 'qwen2.5-14b',
    name: 'Qwen 2.5 14B',
    filename: 'qwen2.5-14b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-14B-Instruct-GGUF/resolve/main/qwen2.5-14b-instruct-q4_k_m.gguf',
    sizeGB: '8.9',
    sizeBytes: 8900000000,
    description: 'Near GPT-4 quality. Needs 16GB+ RAM.',
    category: 'powerful'
  },
  // ── Reasoning ──
  {
    id: 'deepseek-r1-7b',
    name: 'DeepSeek R1 7B',
    filename: 'DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/DeepSeek-R1-Distill-Qwen-7B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf',
    sizeGB: '4.7',
    sizeBytes: 4700000000,
    description: 'Exceptional at multi-step reasoning and problem solving.',
    category: 'reasoning'
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
    category: 'code'
  }
]

export interface DownloadResult {
  success: boolean
  error?: string
  errorCode?: 'NETWORK' | 'DISK_SPACE' | 'FORBIDDEN' | 'NOT_FOUND' | 'TIMEOUT' | 'EXTRACTION' | 'UNKNOWN'
}

export class LocalAIManager {
  private serverProcess: ChildProcess | null = null
  private isServerRunning = false
  private lastError = ''

  constructor() {
    this.ensureDirectories()
  }

  private ensureDirectories() {
    if (!fs.existsSync(ENGINE_DIR)) fs.mkdirSync(ENGINE_DIR, { recursive: true })
    if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true })
  }

  public getEnginePath(): string {
    return path.join(ENGINE_DIR, 'llama-server.exe')
  }

  public isEngineInstalled(): boolean {
    return fs.existsSync(this.getEnginePath())
  }

  public isModelInstalled(modelId: string): boolean {
    const preset = AVAILABLE_MODELS.find(m => m.id === modelId)
    if (!preset) return false
    return fs.existsSync(path.join(MODELS_DIR, preset.filename))
  }

  public getAllModelsStatus(): Record<string, boolean> {
    const status: Record<string, boolean> = {}
    for (const model of AVAILABLE_MODELS) {
      status[model.id] = fs.existsSync(path.join(MODELS_DIR, model.filename))
    }
    return status
  }

  public getLastError(): string {
    return this.lastError
  }

  // ── Disk space check ──
  public checkDiskSpace(requiredBytes: number): { ok: boolean; availableGB: string; requiredGB: string } {
    try {
      const drive = ENGINE_DIR.charAt(0)
      const output = execSync(`wmic logicaldisk where "DeviceID='${drive}:'" get FreeSpace /format:value`, {
        windowsHide: true,
        encoding: 'utf-8'
      })
      const match = output.match(/FreeSpace=(\d+)/)
      const freeSpace = match ? parseInt(match[1], 10) : 0
      const extraMargin = 500 * 1024 * 1024 // 500MB safety margin
      return {
        ok: freeSpace > (requiredBytes + extraMargin),
        availableGB: (freeSpace / (1024 * 1024 * 1024)).toFixed(1),
        requiredGB: (requiredBytes / (1024 * 1024 * 1024)).toFixed(1)
      }
    } catch {
      return { ok: true, availableGB: '?', requiredGB: (requiredBytes / (1024 * 1024 * 1024)).toFixed(1) }
    }
  }

  // Wait for server to bind to port and respond
  private async waitForServerReady(port: number, timeoutMs = 60000): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`)
        if (res.ok) return true
      } catch {
        // expected to fail until server boots
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    return false
  }

  // Orchestrate bringing up the invisible server
  public async startEngine(modelId: string, port = 8080): Promise<boolean> {
    if (this.isServerRunning) return true

    const preset = AVAILABLE_MODELS.find(m => m.id === modelId)
    const modelPath = preset ? path.join(MODELS_DIR, preset.filename) : ''
    const engineExe = this.getEnginePath()

    if (!fs.existsSync(engineExe) || !modelPath || !fs.existsSync(modelPath)) {
      console.error('[LocalAI] Cannot start: Engine or Model missing')
      return false
    }

    console.log(`[LocalAI] Starting embedded server on port ${port} with model ${modelPath}...`)

    try {
      this.serverProcess = spawn(engineExe, [
        '-m', modelPath,
        '--port', port.toString(),
        '-c', '4096',
        '--parallel', '1',
        '--n-gpu-layers', '99',
      ], {
        windowsHide: true,
        stdio: 'ignore'
      })

      this.serverProcess.on('error', (err) => {
        console.error('[LocalAI] llama-server crashed:', err)
        this.isServerRunning = false
      })
      this.serverProcess.on('close', (code) => {
        console.log(`[LocalAI] Server exited with code ${code}`)
        this.isServerRunning = false
      })

      const isResponsive = await this.waitForServerReady(port)
      if (isResponsive) {
        console.log('[LocalAI] Server is online and accepting requests.')
        this.isServerRunning = true
        return true
      } else {
        console.error('[LocalAI] Server failed to bind in time.')
        this.stopEngine()
        return false
      }
    } catch (err) {
      console.error('[LocalAI] Exception spawning server:', err)
      return false
    }
  }

  public stopEngine() {
    if (this.serverProcess) {
      console.log('[LocalAI] Shutting down server...')
      this.serverProcess.kill()
      this.serverProcess = null
    }
    this.isServerRunning = false
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
        const options: any = {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Connection': 'keep-alive'
          },
          timeout: 45000  // 45 seconds to establish connection
        }

        console.log(`[LocalAI] Download attempt ${attempt + 1}/${maxRetries}: ${currentUrl.substring(0, 80)}...`)
        onProgress?.(0, 'Connecting to server...')

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
          if (response.statusCode === 401 || response.statusCode === 403) {
            // Attempt fallback from 'resolve' to 'download' if on huggingface
            if (currentUrl.includes('huggingface.co') && currentUrl.includes('/resolve/')) {
               const fallbackUrl = currentUrl.replace('/resolve/', '/download/')
               console.log(`[LocalAI] Got ${response.statusCode}, trying fallback: ${fallbackUrl}`)
               onProgress?.(0, 'Access restricted, trying alternate route...')
               return tryDownload(fallbackUrl, redirectCount + 1)
            }
            this.lastError = `Access denied (${response.statusCode}). This repository might be private or require a session.`
            return resolve({ success: false, error: this.lastError, errorCode: 'FORBIDDEN' })
          }
          if (response.statusCode === 404) {
            this.lastError = `File not found (404). The download URL may have changed.`
            return resolve({ success: false, error: this.lastError, errorCode: 'NOT_FOUND' })
          }
          if (response.statusCode !== 200) {
            this.lastError = `Server returned status ${response.statusCode}`
            // Retry on 5xx errors
            if ((response.statusCode || 0) >= 500 && attempt < maxRetries - 1) {
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
          const totalBytes = parseInt(response.headers['content-length'] || '0', 10)
          let downloadedBytes = 0
          let lastReportedPercent = -1
          let lastSpeedUpdate = Date.now()
          let lastSpeedBytes = 0

          const file = fs.createWriteStream(dest)

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
            // Verify the file was fully downloaded
            if (totalBytes > 0) {
              const actualSize = fs.statSync(dest).size
              if (actualSize < totalBytes * 0.95) {
                console.error(`[LocalAI] Incomplete download: got ${actualSize} of ${totalBytes} bytes`)
                try { fs.unlinkSync(dest) } catch {}
                if (attempt < maxRetries - 1) {
                  attempt++
                  onProgress?.(0, 'Incomplete download, retrying...')
                  setTimeout(() => tryDownload(currentUrl, 0), 3000)
                  return
                }
                this.lastError = 'Download was incomplete — the file was corrupted during transfer.'
                resolve({ success: false, error: this.lastError, errorCode: 'NETWORK' })
                return
              }
            }
            console.log(`[LocalAI] Download complete: ${dest}`)
            resolve({ success: true })
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
            onProgress?.(0, 'Connection timeout, retrying...')
            setTimeout(() => tryDownload(currentUrl, 0), 3000)
          } else {
            this.lastError = 'Connection timed out after 30 seconds. Your internet may be blocked or too slow.'
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

    const zipPath = path.join(ENGINE_DIR, 'llama-server.zip')

    // Try each URL until one works
    for (let i = 0; i < ENGINE_URLS.length; i++) {
      const url = ENGINE_URLS[i]
      console.log(`[LocalAI] Trying engine URL ${i + 1}/${ENGINE_URLS.length}: ${url}`)
      onProgress?.(0, `Downloading Core Engine (source ${i + 1})...`)

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
    const extractDir = path.join(ENGINE_DIR, '_extract')

    // Use tar if available (faster), fallback to PowerShell
    const extracted = await new Promise<boolean>((resolve) => {
      // Try tar first (available on Windows 10+, much faster)
      const tarResult = spawn('tar', ['-xf', zipPath, '-C', ENGINE_DIR], { windowsHide: true, stdio: 'ignore' })
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

    // Search in both ENGINE_DIR (tar) and extractDir (PowerShell)
    let exePath = findExe(ENGINE_DIR)
    if (!exePath && fs.existsSync(extractDir)) {
      exePath = findExe(extractDir)
    }

    if (!exePath) {
      this.lastError = 'llama-server.exe not found inside the downloaded package.'
      try { fs.rmSync(extractDir, { recursive: true, force: true }) } catch {}
      return { success: false, error: this.lastError, errorCode: 'EXTRACTION' }
    }

    // If the exe is not in ENGINE_DIR root, move it with all siblings
    if (path.dirname(exePath) !== ENGINE_DIR) {
      const exeDir = path.dirname(exePath)
      try {
        const siblings = fs.readdirSync(exeDir)
        for (const file of siblings) {
          const src = path.join(exeDir, file)
          const destFile = path.join(ENGINE_DIR, file)
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
  public async downloadModel(modelId: string, onProgress?: (percent: number, text: string) => void): Promise<DownloadResult> {
    const preset = AVAILABLE_MODELS.find(m => m.id === modelId)
    if (!preset) {
      return { success: false, error: `Unknown model: ${modelId}`, errorCode: 'UNKNOWN' }
    }

    if (this.isModelInstalled(modelId)) return { success: true }

    // Check disk space
    const spaceCheck = this.checkDiskSpace(preset.sizeBytes)
    if (!spaceCheck.ok) {
      return {
        success: false,
        error: `Not enough disk space. Need ${spaceCheck.requiredGB}GB free, but only ${spaceCheck.availableGB}GB available.`,
        errorCode: 'DISK_SPACE'
      }
    }

    const outputFilePath = path.join(MODELS_DIR, preset.filename)
    console.log(`[LocalAI] Downloading model ${preset.name} from: ${preset.url}`)

    const result = await this.downloadFileWithProgress(preset.url, outputFilePath, (p, text) => {
      onProgress?.(p, `${preset.name}: ${text}`)
    })

    if (!result.success) {
      try { if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath) } catch {}
    }
    return result
  }
}

// Singleton export
export const localAIManager = new LocalAIManager()
