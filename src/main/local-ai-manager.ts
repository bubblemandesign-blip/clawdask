import * as path from 'path'
import * as fs from 'fs'
import * as https from 'https'
import { spawn, ChildProcess } from 'child_process'
import { app } from 'electron'

const ENGINE_DIR = path.join(app.getPath('userData'), 'engine')
const MODELS_DIR = path.join(ENGINE_DIR, 'models')

// Use latest stable build of llama-server for Windows (CPU - universal compatibility)
const SERVER_URL = 'https://github.com/ggml-org/llama.cpp/releases/download/b8272/llama-b8272-bin-win-cpu-x64.zip'

export interface ModelPreset {
  id: string
  name: string
  filename: string
  url: string
  sizeBytes: number
}

// Recommended friction-less models
export const AVAILABLE_MODELS: ModelPreset[] = [
  {
    id: 'phi3-mini',
    name: 'Phi-3 Mini (Fast & Light)',
    filename: 'Phi-3-mini-4k-instruct-q4.gguf',
    url: 'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-q4.gguf',
    sizeBytes: 2390000000 
  },
  {
    id: 'glm-4-9b',
    name: 'GLM-4 9B (Powerful & Smart)',
    filename: 'glm-4-9b-chat.Q4_K_M.gguf',
    url: 'https://huggingface.co/lmstudio-community/glm-4-9b-chat-GGUF/resolve/main/glm-4-9b-chat-Q4_K_M.gguf',
    sizeBytes: 5500000000 
  },
  {
    id: 'deepseek-r1-7b',
    name: 'DeepSeek R1 7B (Reasoning)',
    filename: 'DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/DeepSeek-R1-Distill-Qwen-7B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf',
    sizeBytes: 4700000000
  },
  {
    id: 'llama3.2-1b',
    name: 'Llama 3.2 1B (Ultra Fast)',
    filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    sizeBytes: 800000000
  },
  {
    id: 'llama3.1-8b',
    name: 'Llama 3.1 8B (Classic)',
    filename: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
    sizeBytes: 4900000000
  }
]

export class LocalAIManager {
  private serverProcess: ChildProcess | null = null
  private isServerRunning = false

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

  // Wait for server to bind to port and respond
  private async waitForServerReady(port: number, timeoutMs = 15000): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`)
        if (res.ok) return true
      } catch (e) {
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

    if (!fs.existsSync(engineExe) || !modelPath || (!fs.existsSync(modelPath) && modelId !== 'dummy')) {
      console.error('[LocalAI] Cannot start: Engine or Model missing')
      return false
    }

    console.log(`[LocalAI] Starting embedded server on port ${port} with model ${modelPath}...`)
    
    // Spawn llama-server silently
    try {
      this.serverProcess = spawn(engineExe, [
        '-m', modelPath,
        '--port', port.toString(),
        '-c', '4096', // Context window
        '--parallel', '1', // Better for single user
        '--n-gpu-layers', '99', // Offload everything possible to GPU
      ], {
        // detached: true, // we want it attached so if ClawDesk dies, llama-server dies instantly
        windowsHide: true,
        stdio: 'ignore' // Hide verbose tokens
      })
      
      this.serverProcess.on('error', (err) => {
        console.error('[LocalAI] llama-server crashed natively:', err)
        this.isServerRunning = false
      })

      this.serverProcess.on('close', (code) => {
        console.log(`[LocalAI] Embedded server exited with code ${code}`)
        this.isServerRunning = false
      })

      const isResponsive = await this.waitForServerReady(port)
      if (isResponsive) {
        console.log('[LocalAI] Embedded server is fully online and accepting OpenAI API requests.')
        this.isServerRunning = true
        return true
      } else {
        console.error('[LocalAI] Embedded server failed to bind in time.')
        this.stopEngine()
        return false
      }
    } catch(err) {
      console.error('[LocalAI] Exception spawning server:', err)
      return false
    }
  }

  public stopEngine() {
    if (this.serverProcess) {
       console.log('[LocalAI] Shutting down embedded server...')
       this.serverProcess.kill()
       this.serverProcess = null
    }
    this.isServerRunning = false
  }

  private downloadFileWithProgress(url: string, dest: string, onProgress?: (p: number, mbytes: string) => void): Promise<boolean> {
    return new Promise((resolve) => {
      const protocol = url.startsWith('https') ? https : require('http')
      const options = {
        headers: {
          'User-Agent': 'ClawDesk-AI-Manager/1.0'
        }
      }

      protocol.get(url, options, (response) => {
        // Handle all common redirect codes (301, 302, 303, 307, 308)
        if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
          const newUrl = response.headers.location
          if (newUrl) {
            // Recurse with new URL
            return resolve(this.downloadFileWithProgress(newUrl, dest, onProgress))
          }
        }

        if (response.statusCode !== 200) {
          console.error(`[LocalAI] Download failed with status ${response.statusCode} from ${url}`)
          return resolve(false)
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10)
        let downloadedBytes = 0
        let lastReportedPercent = -1

        const file = fs.createWriteStream(dest)
        
        response.on('data', (chunk) => {
          downloadedBytes += chunk.length
          if (totalBytes > 0 && onProgress) {
            const percent = Math.floor((downloadedBytes / totalBytes) * 100)
            if (percent !== lastReportedPercent) {
              lastReportedPercent = percent
              const mbStr = (downloadedBytes / (1024 * 1024)).toFixed(1) + '/' + (totalBytes / (1024 * 1024)).toFixed(1) + ' MB'
              onProgress(percent, mbStr)
            }
          }
        })

        response.pipe(file)

        file.on('finish', () => {
          file.close()
          resolve(true)
        })

        file.on('error', (err) => {
          console.error('[LocalAI] File write error:', err)
          file.close()
          if (fs.existsSync(dest)) fs.unlinkSync(dest)
          resolve(false)
        })
      }).on('error', (err) => {
        console.error('[LocalAI] Request error:', err)
        if (fs.existsSync(dest)) fs.unlinkSync(dest)
        resolve(false)
      })
    })
  }

  // Helper to fetch the binary if missing
  public async downloadEngine(onProgress?: (percent: number, text: string) => void): Promise<boolean> {
    if (this.isEngineInstalled()) return true
    
    console.log(`[LocalAI] Downloading llama-server from: ${SERVER_URL}`)
    const zipPath = path.join(ENGINE_DIR, 'llama-server.zip')
    
    const success = await this.downloadFileWithProgress(SERVER_URL, zipPath, (p, text) => {
      onProgress?.(p, `Downloading Core Engine... ${text}`)
    })

    if (!success) {
      console.error('[LocalAI] Engine download failed!')
      return false
    }
    
    onProgress?.(100, 'Extracting Engine...')
    
    // Extract ZIP
    const extractDir = path.join(ENGINE_DIR, '_extract')
    const extracted = await new Promise<boolean>((resolve) => {
      const psScript = `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractDir}" -Force`
      const p = spawn('powershell.exe', ['-NoProfile', '-Command', psScript], { windowsHide: true })
      p.on('close', (code) => resolve(code === 0))
    })

    // Clean up ZIP
    try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath) } catch {}

    if (!extracted || !fs.existsSync(extractDir)) {
      console.error('[LocalAI] ZIP extraction failed')
      return false
    }

    // Recursively find llama-server.exe inside the extracted tree
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

    const exePath = findExe(extractDir)
    if (!exePath) {
      console.error('[LocalAI] llama-server.exe not found inside ZIP!')
      try { fs.rmSync(extractDir, { recursive: true, force: true }) } catch {}
      return false
    }

    // Move llama-server.exe and all sibling files (DLLs etc.) to ENGINE_DIR
    const exeDir = path.dirname(exePath)
    try {
      const siblings = fs.readdirSync(exeDir)
      for (const file of siblings) {
        const src = path.join(exeDir, file)
        const dest = path.join(ENGINE_DIR, file)
        if (fs.statSync(src).isFile()) {
          fs.copyFileSync(src, dest)
        }
      }
    } catch (e) {
      console.error('[LocalAI] Failed to move engine files:', e)
    }

    // Clean up extracted directory
    try { fs.rmSync(extractDir, { recursive: true, force: true }) } catch {}

    const installed = this.isEngineInstalled()
    console.log(`[LocalAI] Engine installed: ${installed}`)
    return installed
  }

  public async downloadModel(modelId: string, onProgress?: (percent: number, text: string) => void): Promise<boolean> {
    const preset = AVAILABLE_MODELS.find(m => m.id === modelId)
    if (!preset) return false
    
    if (this.isModelInstalled(modelId)) return true
    
    const outputFilePath = path.join(MODELS_DIR, preset.filename)
    console.log(`[LocalAI] Downloading model ${preset.name} from: ${preset.url}`)
    
    const success = await this.downloadFileWithProgress(preset.url, outputFilePath, (p, text) => {
      onProgress?.(p, `Downloading ${preset.name}... ${text}`)
    })
    
    if (!success) {
      if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath)
    }
    return success
  }
}

// Singleton export
export const localAIManager = new LocalAIManager()
