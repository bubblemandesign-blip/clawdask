import * as path from 'path'
import * as fs from 'fs'
import * as https from 'https'
import { spawn, ChildProcess } from 'child_process'
import { app } from 'electron'

const ENGINE_DIR = path.join(app.getPath('userData'), 'engine')
const MODELS_DIR = path.join(ENGINE_DIR, 'models')

// Use a static build of llama-server for Windows
const SERVER_URL = 'https://github.com/ggerganov/llama.cpp/releases/download/b3744/llama-b3744-bin-win-vulcan-x64.zip'

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
      https.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303 || response.statusCode === 307) {
          return resolve(this.downloadFileWithProgress(response.headers.location!, dest, onProgress))
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
          fs.unlink(dest, () => {})
          resolve(false)
        })
      }).on('error', (err) => {
        console.error('[LocalAI] HTTPS request error:', err)
        fs.unlink(dest, () => {})
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

    if (!success) return false
    
    onProgress?.(100, 'Extracting Engine...')
    
    return new Promise((resolve) => {
      const psScript = `Expand-Archive -Path "${zipPath}" -DestinationPath "${ENGINE_DIR}" -Force; Remove-Item "${zipPath}"`
      const p = spawn('powershell.exe', ['-NoProfile', '-Command', psScript], { windowsHide: true })
      p.on('close', (code) => {
        if (code === 0 && this.isEngineInstalled()) {
          resolve(true)
        } else {
          resolve(false)
        }
      })
    })
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
