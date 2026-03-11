<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'

// State
const step = ref<'checking' | 'setup' | 'capabilities' | 'security' | 'channels' | 'personality' | 'audio' | 'starting' | 'error'>('checking')
const provider = ref('openai')
const apiKey = ref('')
const customBaseUrl = ref('')
const errorMessage = ref('')
const isLoading = ref(false)
const systemSpecs = ref({ totalMem: 0, vram: 0 })
const modelInstalled = ref(true)  // Default true so user is never stuck
const ollamaInstalled = ref(true)
const ollamaRunning = ref(false)
const ollamaChecked = ref(false)
const installedModels = ref<string[]>([])
const pullProgress = ref(0)
const pullStatus = ref('')
const isPulling = ref(false)
const startupStatus = ref('Applying your premium configuration...')

// Embedded AI State
const embeddedEngineInstalled = ref(true)
const embeddedModelInstalled = ref(true)
const isDownloadingEmbedded = ref(false)
const embeddedProgress = ref(0)
const embeddedStatus = ref('')
const embeddedChecked = ref(false)

// Rotating quotes
const currentQuote = ref('')
const aiQuotes = [
  "Local AI means your data never leaves your machine.",
  "Did you know? ClawDesk runs completely offline.",
  "Downloading weights from the matrix...",
  "Warming up the neural engine...",
  "Preparing your personal AI assistant...",
  "Optimizing for your hardware..."
]
let quoteInterval: ReturnType<typeof setInterval>
function startQuotes() {
  if (quoteInterval) clearInterval(quoteInterval)
  currentQuote.value = aiQuotes[Math.floor(Math.random() * aiQuotes.length)]
  quoteInterval = setInterval(() => {
    currentQuote.value = aiQuotes[Math.floor(Math.random() * aiQuotes.length)]
  }, 4500)
}
function stopQuotes() {
  if (quoteInterval) clearInterval(quoteInterval)
}

watch(() => isPulling.value, (v) => v ? startQuotes() : stopQuotes())
watch(() => step.value, (v) => v === 'starting' ? startQuotes() : stopQuotes())

// Capabilities state
const enableWebBrowser = ref(true)
const enableComputerControl = ref(false)

// Security state
const dmPolicy = ref('pairing')
const allowFrom = ref('')
const enableSandbox = ref(false)

// Channels state
const telegramToken = ref('')
const discordToken = ref('')

// Personality state
const personalityTemplate = ref('pro')

// Audio state
const enableTTS = ref(false)
const ttsProvider = ref('edge')

// API access
const api = (window as any).api

const providers = [
  { id: 'embedded', name: 'Local AI (Zero Setup)', placeholder: '', keyUrl: '', isLocal: true },
  { id: 'moonshot', name: 'Moonshot (Kimi)', placeholder: 'sk-...', keyUrl: 'https://platform.moonshot.cn' },
  { id: 'openai', name: 'OpenAI', placeholder: 'sk-...', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Claude', placeholder: 'sk-ant-...', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openrouter', name: 'OpenRouter', placeholder: 'sk-or-...', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'google', name: 'Gemini', placeholder: 'AI...', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'groq', name: 'Groq', placeholder: 'gsk_...', keyUrl: 'https://console.groq.com/keys' },
  { id: 'mistral', name: 'Mistral', placeholder: 'M...', keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'xai', name: 'xAI', placeholder: 'xai-...', keyUrl: 'https://console.x.ai' },
  { id: 'deepseek', name: 'DeepSeek', placeholder: 'sk-...', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'together', name: 'Together', placeholder: 'tog-...', keyUrl: 'https://api.together.xyz/settings/api-keys' },
  { id: 'ollama', name: 'Ollama (Expert)', placeholder: 'No key required', keyUrl: '', isLocal: true },
  { id: 'custom', name: 'Custom API', placeholder: 'API key', keyUrl: '' }
]

const selectedProvider = computed(() => providers.find(p => p.id === provider.value))
const isCustom = computed(() => provider.value === 'custom')
const isLocal = computed(() => selectedProvider.value?.isLocal || false)

function vramTag(needed: number): string {
  const vramGB = Math.round(systemSpecs.value.vram / (1024 * 1024 * 1024))
  if (vramGB <= 0) return needed <= 4 ? ' - Lightweight' : ` - Needs ${needed}GB+ VRAM`
  if (vramGB >= needed) return ` - ✨ Great for your ${vramGB}GB VRAM`
  if (vramGB >= needed - 2) return ` - ⚡ OK on your ${vramGB}GB`
  return ` - ⚠️ Needs ${needed}GB+ VRAM`
}

function isModelDownloaded(ollamaName: string): boolean {
  return installedModels.value.some(m => {
    const n = m.toLowerCase()
    const s = ollamaName.toLowerCase()
    return n === s || n === s + ':latest' || n.startsWith(s + ':')
  })
}

const localModelsMap = ref<Record<string, boolean>>({})

function isEmbeddedDownloaded(modelId: string): boolean {
  return localModelsMap.value[modelId] || false
}

const modelVersions = computed<Record<string, { id: string, name: string }[]>>(() => {
  return {
    anthropic: [
      { id: 'anthropic/claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet (Latest)' },
      { id: 'anthropic/claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
      { id: 'anthropic/claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Fast)' },
      { id: 'anthropic/claude-3-opus-20240229', name: 'Claude 3 Opus (Powerful)' }
    ],
    openai: [
      { id: 'openai/gpt-4o', name: 'GPT-4o (Latest)' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini (Fast)' },
      { id: 'openai/o1-preview', name: 'o1 Preview (Reasoning)' },
      { id: 'openai/o3-mini', name: 'o3 Mini (Reasoning)' },
      { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo' }
    ],
    google: [
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'google/gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash Exp' },
      { id: 'google/gemini-1.5-pro', name: 'Gemini 1.5 Pro' }
    ],
    openrouter: [
      { id: 'openrouter/anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet' },
      { id: 'openrouter/google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'openrouter/deepseek/deepseek-r1', name: 'DeepSeek R1' },
      { id: 'openrouter/meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
      { id: 'openrouter/qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B' }
    ],
    deepseek: [
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 (Chat)' },
      { id: 'deepseek/deepseek-reasoner', name: 'DeepSeek R1 (Reasoner)' }
    ],
    groq: [
      { id: 'groq/llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Ultra Fast)' },
      { id: 'groq/llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
      { id: 'groq/mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
      { id: 'groq/gemma2-9b-it', name: 'Gemma2 9B' }
    ],
    mistral: [
      { id: 'mistral/mistral-large-latest', name: 'Mistral Large (Latest)' },
      { id: 'mistral/mistral-small-latest', name: 'Mistral Small (Fast)' },
      { id: 'mistral/codestral-latest', name: 'Codestral (Code)' },
      { id: 'mistral/mistral-medium-latest', name: 'Mistral Medium' }
    ],
    xai: [
      { id: 'xai/grok-2-latest', name: 'Grok 2 (Latest)' },
      { id: 'xai/grok-2-mini', name: 'Grok 2 Mini (Fast)' }
    ],
    together: [
      { id: 'together/meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo' },
      { id: 'together/Qwen/Qwen2.5-72B-Instruct-Turbo', name: 'Qwen 2.5 72B Turbo' },
      { id: 'together/mistralai/Mixtral-8x7B-Instruct-v0.1', name: 'Mixtral 8x7B' },
      { id: 'together/deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1' }
    ],
    moonshot: [
      { id: 'moonshot/moonshot-v1-8k', name: 'Moonshot V1 (8K Context)' },
      { id: 'moonshot/moonshot-v1-32k', name: 'Moonshot V1 (32K Context)' },
      { id: 'moonshot/moonshot-v1-128k', name: 'Moonshot V1 (128K Context)' }
    ],
    embedded: [
      { id: 'local/phi3-mini', name: 'Phi-3 Mini (Fast) - 2.4GB' + (isEmbeddedDownloaded('phi3-mini') ? ' ✅' : '') },
      { id: 'local/glm-4-9b', name: 'GLM-4 9B (Smart) - 5.5GB' + (isEmbeddedDownloaded('glm-4-9b') ? ' ✅' : '') },
      { id: 'local/deepseek-r1-7b', name: 'DeepSeek R1 7B (Reasoning) - 4.7GB' + (isEmbeddedDownloaded('deepseek-r1-7b') ? ' ✅' : '') },
      { id: 'local/llama3.1-8b', name: 'Llama 3.1 8B (Classic) - 4.9GB' + (isEmbeddedDownloaded('llama3.1-8b') ? ' ✅' : '') },
      { id: 'local/llama3.2-1b', name: 'Llama 3.2 1B (Ultra Fast) - 0.8GB' + (isEmbeddedDownloaded('llama3.2-1b') ? ' ✅' : '') }
    ],
    ollama: [
      { id: 'ollama/glm4', name: 'GLM-4 9B' + vramTag(4) + (isModelDownloaded('glm4') ? ' ✅' : '') },
      { id: 'ollama/qwen2.5', name: 'Qwen 2.5 7B' + vramTag(4) + (isModelDownloaded('qwen2.5') ? ' ✅' : '') },
      { id: 'ollama/phi4', name: 'Phi-4 14B' + vramTag(6) + (isModelDownloaded('phi4') ? ' ✅' : '') },
      { id: 'ollama/gemma2', name: 'Gemma 2 9B' + vramTag(5) + (isModelDownloaded('gemma2') ? ' ✅' : '') },
      { id: 'ollama/mistral', name: 'Mistral 7B v0.3' + vramTag(4) + (isModelDownloaded('mistral') ? ' ✅' : '') },
      { id: 'ollama/llama3.1', name: 'Llama 3.1 8B' + vramTag(5) + (isModelDownloaded('llama3.1') ? ' ✅' : '') },
      { id: 'ollama/deepseek-r1:7b', name: 'DeepSeek R1 7B' + vramTag(4) + (isModelDownloaded('deepseek-r1:7b') ? ' ✅' : '') },
      { id: 'ollama/codegemma', name: 'CodeGemma 7B' + vramTag(4) + (isModelDownloaded('codegemma') ? ' ✅' : '') },
      { id: 'ollama/starcoder2', name: 'StarCoder2 7B' + vramTag(4) + (isModelDownloaded('starcoder2') ? ' ✅' : '') },
      { id: 'ollama/deepseek-coder-v2', name: 'DeepSeek Coder V2' + vramTag(8) + (isModelDownloaded('deepseek-coder-v2') ? ' ✅' : '') },
      { id: 'ollama/llama3.3', name: 'Llama 3.3 70B' + vramTag(24) + (isModelDownloaded('llama3.3') ? ' ✅' : '') },
      { id: 'ollama/qwen2.5:32b', name: 'Qwen 2.5 32B' + vramTag(12) + (isModelDownloaded('qwen2.5:32b') ? ' ✅' : '') }
    ]
  }
})

const selectedModel = ref('openai/gpt-4o')
const availableModels = computed(() => modelVersions.value[provider.value] || [])

watch(provider, async (newProv) => {
  const models = modelVersions.value[newProv]
  if (models && models.length > 0) {
    selectedModel.value = models[0].id
    if (newProv === 'ollama') {
      await refreshOllamaStatus()
    } else if (newProv === 'embedded') {
      await refreshEmbeddedStatus()
    }
  } else {
    selectedModel.value = ''
  }
})

// Re-check when user changes model selection
watch(selectedModel, async () => {
  if (provider.value === 'ollama') {
    await checkModelStatus()
  } else if (provider.value === 'embedded') {
    await refreshEmbeddedStatus()
  }
})

async function refreshOllamaStatus() {
  try {
    const result = await api.listModels()
    if (result.ollamaInstalled !== undefined) {
      ollamaInstalled.value = result.ollamaInstalled
    }
    ollamaRunning.value = result.ollamaRunning
    ollamaChecked.value = true
    if (result.ollamaRunning) {
      installedModels.value = result.models || []
    }
    await checkModelStatus()
  } catch {
    ollamaRunning.value = false
    ollamaChecked.value = true
    modelInstalled.value = true // Don't block user
  }
}

async function checkModelStatus() {
  if (provider.value !== 'ollama') return
  const modelName = selectedModel.value.split('/')[1] || 'glm4'
  const result = await api.checkModel(modelName)
  ollamaInstalled.value = result.ollamaInstalled ?? true
  ollamaRunning.value = result.ollamaRunning
  if (result.ollamaRunning) {
    modelInstalled.value = result.exists
  } else {
    modelInstalled.value = true  // Don't block if we can't be sure
  }
}

async function startModelPull() {
  const modelName = selectedModel.value.split('/')[1] || 'glm4'
  isPulling.value = true
  pullProgress.value = 0
  pullStatus.value = 'Initializing...'
  
  api.onPullProgress((data: any) => {
    if (data.status) pullStatus.value = data.status
    if (data.completed && data.total) {
      pullProgress.value = Math.round((data.completed / data.total) * 100)
    }
  })

  const result = await api.pullModel(modelName)
  if (result.success) {
    modelInstalled.value = true
    pullStatus.value = 'Download complete!'
    await refreshOllamaStatus()
  } else {
    if (result.error && result.error.includes('no space left on device')) {
      errorMessage.value = 'Error: Not enough storage space available on your drive.'
    } else {
      errorMessage.value = 'Pull failed: ' + result.error
    }
  }
  isPulling.value = false
}

async function refreshEmbeddedStatus() {
  if (provider.value !== 'embedded') return
  const modelId = selectedModel.value.replace('local/', '') || 'glm-4-9b'
  embeddedChecked.value = false
  const status = await api.getLocalAiAllStatus()
  embeddedEngineInstalled.value = status.engineInstalled
  localModelsMap.value = status.models || {}
  embeddedModelInstalled.value = localModelsMap.value[modelId] || false
  embeddedChecked.value = true
}

async function startEmbeddedPull() {
  if (!embeddedEngineInstalled.value) {
    isDownloadingEmbedded.value = true
    embeddedStatus.value = 'Preparing engine download...'
    embeddedProgress.value = 0
    
    const unsub = api.onLocalAiDownloadProgress((data: any) => {
      embeddedProgress.value = data.percent
      embeddedStatus.value = data.text
    })

    const success = await api.downloadLocalEngine()
    unsub()
    
    if (success) {
       embeddedEngineInstalled.value = true
       if (!embeddedModelInstalled.value) {
         await downloadModelOnly()
       } else {
         embeddedStatus.value = 'Engine installed!'
         setTimeout(() => { isDownloadingEmbedded.value = false }, 1500)
       }
    } else {
       embeddedStatus.value = 'Engine download failed!'
       setTimeout(() => { isDownloadingEmbedded.value = false }, 3000)
    }
  } else if (!embeddedModelInstalled.value) {
    await downloadModelOnly()
  }
}

async function downloadModelOnly() {
  const modelId = selectedModel.value.replace('local/', '') || 'glm-4-9b'
  isDownloadingEmbedded.value = true
  embeddedStatus.value = 'Preparing model download...'
  embeddedProgress.value = 0
  
  const unsub = api.onLocalAiDownloadProgress((data: any) => {
    embeddedProgress.value = data.percent
    embeddedStatus.value = data.text
  })

  const success = await api.downloadLocalModel(modelId)
  unsub()
  
  if (success) {
    embeddedModelInstalled.value = true
    embeddedStatus.value = 'Ready!'
    setTimeout(() => { isDownloadingEmbedded.value = false }, 1500)
  } else {
    embeddedStatus.value = 'Model download failed!'
    setTimeout(() => { isDownloadingEmbedded.value = false }, 3000)
  }
}
api.onGatewayStatus((status: string) => {
  startupStatus.value = status
})

const personalities = [
  { id: 'pro', name: 'Professional', emoji: '👔', desc: 'Precise, helpful, and formal.' },
  { id: 'casual', name: 'Casual', emoji: '😊', desc: 'Friendly and conversational.' },
  { id: 'creative', name: 'Creative', emoji: '🎨', desc: 'Imaginative and poetic.' },
  { id: 'coder', name: 'The Architect', emoji: '💻', desc: 'Focused on code and logic.' }
]

onMounted(async () => {
  try {
    const specs = await api.getSpecs()
    if (specs) {
      systemSpecs.value = specs
    }

    const result = await api.checkOpenClaw()
    if (result.isGatewayStarting) {
      step.value = 'starting'
    } else {
      step.value = 'setup'
    }
    
    // Always check local AI status on mount for accurate UI checkmarks
    await refreshEmbeddedStatus()

    if (result.installed) {
      await refreshOllamaStatus()
    }
  } catch {
    step.value = 'setup'
  }
})

function goToCapabilities() {
  if (!isLocal.value && !apiKey.value.trim()) {
    errorMessage.value = 'Please enter your API key'
    return
  }
  if (isCustom.value && !customBaseUrl.value.trim()) {
    errorMessage.value = 'Please enter the base URL for your custom provider'
    return
  }
  errorMessage.value = ''
  step.value = 'capabilities'
}

async function saveAndStart() {
  isLoading.value = true
  step.value = 'starting'
  errorMessage.value = ''

  try {
    if (provider.value === 'ollama') {
      await api.saveApiKey('ollama', 'ollama-local')
    } else if (provider.value === 'embedded') {
      await api.saveApiKey('custom', 'local-embedded')
    } else if (apiKey.value.trim()) {
      await api.saveApiKey(provider.value, apiKey.value.trim())
    }

    const config: any = {
      provider: provider.value,
      apiKey: apiKey.value.trim() || 'local',
      enableWebBrowser: enableWebBrowser.value,
      enableComputerControl: enableComputerControl.value,
      dmPolicy: dmPolicy.value,
      allowFrom: allowFrom.value,
      enableSandbox: enableSandbox.value,
      telegramToken: telegramToken.value,
      discordToken: discordToken.value,
      personalityTemplate: personalityTemplate.value,
      enableTTS: enableTTS.value,
      ttsProvider: ttsProvider.value
    }
    
    if (selectedModel.value) {
      config.model = selectedModel.value
    }
    
    if (isCustom.value) {
      config.baseUrl = customBaseUrl.value.trim()
    } else if (provider.value === 'embedded') {
      config.baseUrl = 'http://127.0.0.1:8080/v1'
    }

    const saveResult = await api.saveConfig(config)
    if (!saveResult.success) {
      errorMessage.value = 'Config error: ' + saveResult.error
      step.value = 'audio'
      isLoading.value = false
      return
    }

    const startResult = await api.startApp()
    if (!startResult.success) {
      errorMessage.value = 'Start failed: ' + startResult.error
      step.value = 'audio'
    }
  } catch (err) {
    errorMessage.value = String(err)
    step.value = 'audio'
  }
  isLoading.value = false
}
</script>

<template>
  <div class="onboarding">
    <div class="card">
      <!-- Logo & Title -->
      <div class="header">
        <svg class="logo-svg" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 28 L14 12 L20 22 L26 12 L32 28" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          <circle cx="20" cy="32" r="2" fill="#ffffff" opacity="0.4"/>
        </svg>
        <h1 class="title">ClawDesk</h1>
        <p class="subtitle">AI assistant — local, private, yours</p>
      </div>

      <!-- Checking -->
      <div v-if="step === 'checking'" class="content">
        <div class="spinner-container">
          <div class="spinner"></div>
          <p class="status-text">Checking system…</p>
        </div>
      </div>

      <!-- Setup: Provider + API Key -->
      <div v-if="step === 'setup'" class="content">
        <div class="form">
          <label class="label">Provider</label>
          <div class="provider-grid">
            <button
              v-for="p in providers"
              :key="p.id"
              class="provider-btn"
              :class="{ active: provider === p.id }"
              @click="provider = p.id"
            >
              <span class="provider-name">{{ p.name }}</span>
            </button>
          </div>

          <!-- Custom provider URL -->
          <template v-if="isCustom">
            <label class="label" style="margin-top: 20px">Base URL</label>
            <input
              v-model="customBaseUrl"
              type="url"
              class="input"
              placeholder="https://api.example.com/v1"
            />
          </template>

          <!-- Model Version Selection -->
          <template v-if="availableModels.length > 0">
            <label class="label" style="margin-top: 20px">Model Version</label>
            <select v-model="selectedModel" class="input" style="font-family: inherit;">
              <option v-for="m in availableModels" :key="m.id" :value="m.id">{{ m.name }}</option>
            </select>
          </template>

          <template v-if="!isLocal">
            <label class="label" style="margin-top: 20px">API Key</label>
            <input
              v-model="apiKey"
              type="password"
              class="input"
              :placeholder="selectedProvider?.placeholder"
              @keyup.enter="goToCapabilities"
            />
          </template>

          <template v-if="provider === 'ollama'">
            <!-- Ollama Status Badge -->
            <div class="ollama-status" style="margin-top: 20px;">
              <span v-if="!ollamaChecked" class="status-badge checking">⏳ Checking Ollama...</span>
              <span v-else-if="!ollamaInstalled" class="status-badge error">❌ Ollama Not Installed</span>
              <span v-else-if="ollamaRunning" class="status-badge online">🟢 Ollama Running</span>
              <span v-else class="status-badge offline">🟡 Ollama Offline (Auto-Start)</span>
            </div>

            <p class="status-sub" style="margin-bottom: 12px; margin-top: 8px; font-size: 13px;">Ollama is free and runs locally on your machine. No API key needed.</p>
            
            <div v-if="ollamaChecked && !ollamaInstalled" class="model-pull-section" style="border-color: rgba(232, 107, 107, 0.3); background: rgba(232, 107, 107, 0.05); margin-bottom: 12px;">
              <p style="font-size: 13px; color: #e86b6b; font-weight: 600; margin-bottom: 4px;">⚠️ Action Required: Install Ollama</p>
              <p style="font-size: 12px; line-height: 1.4; color: #666;">You selected a local model, but Ollama is not installed on your system. Please download and install it from <a href="#" @click.prevent="api.openLink('https://ollama.com')" style="color: #4a90e2; text-decoration: underline;">ollama.com</a> before continuing.</p>
            </div>
            
            <!-- Model already installed -->
            <div v-if="modelInstalled && ollamaRunning" class="model-pull-section" style="border-color: rgba(107, 187, 107, 0.3); background: rgba(107, 187, 107, 0.05);">
              <p style="font-size: 13px; color: #6bbb6b; font-weight: 600; margin-bottom: 4px;">✅ {{ selectedModel.split('/')[1] }} is already downloaded!</p>
              <p style="font-size: 11px; color: #888;">Clicking continue below will <b>NOT</b> download it again. It will simply start.</p>
            </div>
            
            <!-- Model NOT installed but Ollama IS running -->
            <div v-else-if="ollamaRunning && !modelInstalled" class="model-pull-section">
              <button class="btn btn-secondary" @click="startModelPull" :disabled="isPulling">
                <span v-if="isPulling" class="spinner-small" style="margin-right: 8px;"></span>
                {{ isPulling ? 'Downloading...' : '⬇️ Download ' + selectedModel.split('/')[1] }}
              </button>
              <div v-if="isPulling" class="progress-container">
                <div class="progress-bar" :style="{ width: pullProgress + '%' }"></div>
                <span class="progress-text">{{ pullStatus }} ({{ pullProgress }}%)</span>
                <p v-if="currentQuote" class="status-sub" style="margin-top: 12px; font-style: italic; color: #888; font-size: 12px; text-align: center;">"{{ currentQuote }}"</p>
              </div>
              <p v-else class="status-sub" style="margin-top: 8px; color: #888;">Or skip to continue without downloading.</p>
            </div>

            <!-- Ollama NOT running -->
            <div v-else-if="!ollamaRunning && ollamaChecked" style="margin-bottom: 12px;">
              <p class="status-sub" style="font-size: 12px; color: #e8a838;">⚠️ Ollama is not running. Start it first, or continue anyway and configure later.</p>
            </div>
          </template>

          <!-- Embedded Local AI UI -->
          <template v-if="provider === 'embedded'">
            <!-- Status Badge -->
            <div class="ollama-status" style="margin-top: 20px;">
              <span v-if="!embeddedChecked" class="status-badge checking">⏳ Initializing Engine...</span>
              <span v-else-if="embeddedEngineInstalled && embeddedModelInstalled" class="status-badge online">🟢 Ready & Installed</span>
              <span v-else class="status-badge offline">🟡 Components Missing</span>
            </div>

            <p class="status-sub" style="margin-bottom: 12px; margin-top: 8px; font-size: 13px;">ClawDesk runs entirely offline via a powerful built-in core. Zero setup required.</p>
            
            <!-- Missing Comps -->
            <div v-if="embeddedChecked && (!embeddedEngineInstalled || !embeddedModelInstalled)" class="model-pull-section" style="border-color: rgba(66, 153, 225, 0.4); background: rgba(66, 153, 225, 0.05); margin-bottom: 12px;">
              <p style="font-size: 13px; color: #4299e1; font-weight: 600; margin-bottom: 4px;">🚀 Download Required</p>
              <p style="font-size: 12px; line-height: 1.4; color: #aaa; margin-bottom: 10px;">
                <span v-if="!embeddedEngineInstalled">The core AI engine (~40MB) and </span>
                <span>{{ selectedModel.split('/')[1] }}</span>
                <span> must be downloaded securely to your device.</span>
              </p>
              
              <button class="btn btn-secondary" @click="startEmbeddedPull" :disabled="isDownloadingEmbedded">
                <span v-if="isDownloadingEmbedded" class="spinner-small" style="margin-right: 8px;"></span>
                {{ isDownloadingEmbedded ? 'Downloading Component...' : '⬇️ Download Now' }}
              </button>
              
              <div v-if="isDownloadingEmbedded" class="progress-container" style="margin-top: 10px;">
                <div class="progress-bar" :style="{ width: embeddedProgress + '%' }"></div>
                <span class="progress-text">{{ embeddedStatus }} ({{ embeddedProgress }}%)</span>
                <p v-if="currentQuote" class="status-sub" style="margin-top: 12px; font-style: italic; color: #888; font-size: 12px; text-align: center;">"{{ currentQuote }}"</p>
              </div>
            </div>
            
            <!-- Fully Installed -->
            <div v-if="embeddedChecked && embeddedEngineInstalled && embeddedModelInstalled" class="model-pull-section" style="border-color: rgba(107, 187, 107, 0.3); background: rgba(107, 187, 107, 0.05);">
              <p style="font-size: 13px; color: #6bbb6b; font-weight: 600; margin-bottom: 4px;">✅ Embedded AI is ready!</p>
              <p style="font-size: 11px; color: #888;">No further action needed. The local AI model will start seamlessly in the background when you continue.</p>
            </div>
          </template>

          <a
            v-if="selectedProvider?.keyUrl"
            class="help-link"
            :href="selectedProvider.keyUrl"
            target="_blank"
          >
            Get {{ selectedProvider.name }} API key →
          </a>

          <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

          <button
            class="btn btn-primary"
            :disabled="(!isLocal && !apiKey.trim()) || (isCustom && !customBaseUrl.trim()) || (provider === 'ollama' && !ollamaInstalled) || (provider === 'embedded' && (!embeddedEngineInstalled || !embeddedModelInstalled))"
            @click="goToCapabilities"
          >
            {{ provider === 'embedded' ? `Start using ${selectedModel.split('/')[1]}` : (provider === 'ollama' && modelInstalled ? `Start using ${selectedModel.split('/')[1]}` : (provider === 'ollama' && !modelInstalled ? 'Skip Download & Continue' : 'Continue')) }}
          </button>
        </div>
      </div>

      <!-- Capabilities & Security -->
      <div v-if="step === 'capabilities'" class="content">
        <label class="label">Superpowers & Security</label>
        <p class="status-sub" style="margin-bottom: 20px">Give ClawDesk access to your machine</p>

        <div class="caps-list">
          <label class="cap-card" :class="{ active: enableWebBrowser }">
            <div class="cap-info">
              <span class="cap-emoji">🌐</span>
              <div>
                <span class="cap-title">Web & Browser Access</span>
                <span class="cap-desc">Search the web and control a browser</span>
              </div>
            </div>
            <input type="checkbox" v-model="enableWebBrowser" class="cap-toggle">
          </label>

          <label class="cap-card" :class="{ active: enableComputerControl }">
            <div class="cap-info">
              <span class="cap-emoji">💻</span>
              <div>
                <span class="cap-title">Computer Control</span>
                <span class="cap-desc">Read files, edit code, execute commands</span>
              </div>
            </div>
            <input type="checkbox" v-model="enableComputerControl" class="cap-toggle">
          </label>

          <label class="cap-card" :class="{ active: enableSandbox }">
            <div class="cap-info">
              <span class="cap-emoji">🛡️</span>
              <div>
                <span class="cap-title">Isolated Sandbox</span>
                <span class="cap-desc">Run tools in a secure Docker container</span>
              </div>
            </div>
            <input type="checkbox" v-model="enableSandbox" class="cap-toggle">
          </label>
        </div>

        <div class="form" style="margin-top: 24px">
          <label class="label">DM Policy</label>
          <select v-model="dmPolicy" class="input" style="font-family: inherit;">
            <option value="pairing">Pairing (Confirm each sender)</option>
            <option value="allowlist">Allowlist (Only specific IDs)</option>
            <option value="open">Open (Anyone can DM)</option>
            <option value="disabled">Disabled (Ignore all DMs)</option>
          </select>

          <template v-if="dmPolicy === 'allowlist'">
            <label class="label" style="margin-top: 16px">Allowlist</label>
            <input v-model="allowFrom" class="input" placeholder="+15551234567, @username" />
          </template>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 24px;">
          <button class="btn btn-secondary" style="flex: 1;" @click="step = 'setup'">Back</button>
          <button class="btn btn-primary" style="flex: 2;" @click="step = 'channels'">Continue</button>
        </div>
      </div>

      <!-- Channels & Personality -->
      <div v-if="step === 'channels'" class="content">
        <label class="label">Channels & Personality</label>
        <p class="status-sub" style="margin-bottom: 20px">Where should ClawDesk live?</p>

        <div class="form">
          <label class="label">Telegram Bot Token (Optional)</label>
          <input v-model="telegramToken" class="input" placeholder="123456:ABC-DEF..." />
          
          <label class="label" style="margin-top: 16px">Discord Bot Token (Optional)</label>
          <input v-model="discordToken" class="input" placeholder="OTk4..." />
        </div>

        <label class="label" style="margin-top: 24px">Agent Personality</label>
        <div class="personality-grid">
          <button
            v-for="p in personalities"
            :key="p.id"
            class="personality-card"
            :class="{ active: personalityTemplate === p.id }"
            @click="personalityTemplate = p.id"
          >
            <span class="p-emoji">{{ p.emoji }}</span>
            <span class="p-name">{{ p.name }}</span>
            <span class="p-desc">{{ p.desc }}</span>
          </button>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 24px;">
          <button class="btn btn-secondary" style="flex: 1;" @click="step = 'capabilities'">Back</button>
          <button class="btn btn-primary" style="flex: 2;" @click="step = 'audio'">Continue</button>
        </div>
      </div>

      <!-- Audio / TTS -->
      <div v-if="step === 'audio'" class="content">
        <label class="label">Audio & Voice</label>
        <p class="status-sub" style="margin-bottom: 20px">Give your assistant a voice</p>

        <label class="cap-card" :class="{ active: enableTTS }">
          <div class="cap-info">
            <span class="cap-emoji">🔊</span>
            <div>
              <span class="cap-title">Speech Synthesis (TTS)</span>
              <span class="cap-desc">Let ClawDesk reply with voice notes</span>
            </div>
          </div>
          <input type="checkbox" v-model="enableTTS" class="cap-toggle">
        </label>

        <template v-if="enableTTS">
          <div class="form" style="margin-top: 20px">
            <label class="label">Voice Provider</label>
            <div class="provider-grid">
              <button class="provider-btn" :class="{ active: ttsProvider === 'edge' }" @click="ttsProvider = 'edge'">
                <span class="provider-name">Edge (Free)</span>
              </button>
              <button class="provider-btn" :class="{ active: ttsProvider === 'openai' }" @click="ttsProvider = 'openai'">
                <span class="provider-name">OpenAI</span>
              </button>
              <button class="provider-btn" :class="{ active: ttsProvider === 'elevenlabs' }" @click="ttsProvider = 'elevenlabs'">
                <span class="provider-name">ElevenLabs</span>
              </button>
            </div>
            <p v-if="ttsProvider !== 'edge'" class="status-sub" style="margin-top: 10px">Uses your provider API key</p>
          </div>
        </template>

        <p v-if="errorMessage" class="error" style="margin-top: 16px;">{{ errorMessage }}</p>

        <div style="display: flex; gap: 8px; margin-top: 40px;">
          <button class="btn btn-secondary" style="flex: 1;" @click="step = 'channels'">Back</button>
          <button
            class="btn btn-primary"
            style="flex: 2;"
            :disabled="isLoading"
            @click="saveAndStart"
          >
            <span v-if="isLoading" class="spinner-small"></span>
            <span v-else>Launch ClawDesk Premiere</span>
          </button>
        </div>
      </div>

      <!-- Starting -->
      <div v-if="step === 'starting'" class="content">
        <div class="spinner-container">
          <div class="spinner"></div>
          <p class="status-text">Starting Gateway…</p>
          <p class="status-sub" style="font-weight: 600; color: #6bbb6b; margin-top: 12px">{{ startupStatus }}</p>
          <p v-if="currentQuote" class="status-sub" style="margin-top: 24px; font-style: italic; color: #888; font-size: 13px;">"{{ currentQuote }}"</p>
        </div>
      </div>

      <!-- Error -->
      <div v-if="step === 'error'" class="content">
        <div class="error-section">
          <div class="error-dot"></div>
          <p class="error-msg">{{ errorMessage }}</p>
          <button class="btn btn-secondary" @click="step = 'setup'">Retry</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
</style>

<style scoped>
.onboarding {
  width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center;
  background: transparent; font-family: 'Inter', system-ui, sans-serif;
  -webkit-app-region: drag; user-select: none;
}
.card {
  background: #0a0a0a; border-radius: 20px; padding: 40px 36px; width: 480px;
  max-height: 94vh; overflow-y: auto; border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 40px 100px rgba(0, 0, 0, 0.8); animation: fadeIn 0.4s ease-out; -webkit-app-region: no-drag;
}
.card::-webkit-scrollbar { width: 0; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
.header { text-align: center; margin-bottom: 28px; }
.logo-svg { width: 44px; height: 44px; margin-bottom: 12px; opacity: 0.9; }
.title { font-size: 24px; font-weight: 700; color: #f0f0f0; letter-spacing: -0.5px; }
.subtitle { color: #555; font-size: 13px; margin-top: 4px; }
.content { animation: contentFade 0.25s ease-out; }
@keyframes contentFade { from { opacity: 0; } to { opacity: 1; } }
.label { display: block; color: #666; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 10px; }
.provider-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.provider-btn {
  display: flex; align-items: center; justify-content: center; padding: 10px 4px;
  border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.06);
  background: #111; color: #666; cursor: pointer; transition: all 0.15s ease; font-family: inherit;
}
.provider-btn:hover { border-color: rgba(255, 255, 255, 0.12); background: #161616; color: #999; }
.provider-btn.active { border-color: rgba(255, 255, 255, 0.2); background: #1a1a1a; color: #f0f0f0; }
.provider-name { font-size: 10px; font-weight: 600; }
.input {
  width: 100%; padding: 12px 16px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.08);
  background: #111; color: #f0f0f0; font-size: 14px; outline: none; transition: border-color 0.15s ease;
}
.input:focus { border-color: rgba(255, 255, 255, 0.2); }
.help-link { display: inline-block; color: #555; font-size: 11px; margin-top: 8px; text-decoration: none; }
.btn { width: 100%; padding: 13px; border-radius: 12px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; margin-top: 16px; display: flex; align-items: center; justify-content: center; gap: 8px; }
.btn-primary { background: #f0f0f0; color: #0a0a0a; }
.btn-primary:hover:not(:disabled) { background: #ffffff; }
.btn-primary:disabled { opacity: 0.3; cursor: not-allowed; }
.btn-secondary { background: #1a1a1a; color: #999; border: 1px solid rgba(255, 255, 255, 0.08); }
.spinner-container { display: flex; flex-direction: column; align-items: center; padding: 36px 0; }
.spinner { width: 32px; height: 32px; border: 2px solid rgba(255, 255, 255, 0.06); border-top-color: #666; border-radius: 50%; animation: spin 0.7s linear infinite; }
.spinner-small { width: 16px; height: 16px; border: 2px solid rgba(0, 0, 0, 0.15); border-top-color: #0a0a0a; border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.status-text { color: #666; margin-top: 16px; font-size: 13px; }
.status-sub { color: #444; margin-top: 4px; font-size: 11px; }
.caps-list { display: flex; flex-direction: column; gap: 10px; }
.cap-card { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-radius: 12px; background: #111; border: 1px solid rgba(255, 255, 255, 0.06); cursor: pointer; transition: all 0.2s ease; }
.cap-card:hover { border-color: rgba(255, 255, 255, 0.12); }
.cap-card.active { background: #141414; border-color: rgba(255, 255, 255, 0.15); }
.cap-info { display: flex; align-items: center; gap: 12px; }
.cap-emoji { font-size: 18px; }
.cap-title { display: block; color: #f0f0f0; font-size: 13px; font-weight: 600; }
.cap-desc { color: #555; font-size: 11px; }
.cap-toggle { appearance: none; width: 36px; height: 20px; background: #222; border-radius: 20px; position: relative; cursor: pointer; transition: background 0.2s; }
.cap-toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #555; border-radius: 50%; transition: transform 0.2s; }
.cap-toggle:checked { background: #fff; }
.cap-toggle:checked::after { transform: translateX(16px); background: #000; }
.personality-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.personality-card { padding: 14px; border-radius: 12px; background: #111; border: 1px solid rgba(255, 255, 255, 0.06); text-align: left; cursor: pointer; transition: all 0.2s; display: flex; flex-direction: column; gap: 4px; }
.personality-card:hover { border-color: rgba(255, 255, 255, 0.12); }
.personality-card.active { border-color: rgba(255, 255, 255, 0.2); background: #161616; }
.p-emoji { font-size: 18px; }
.p-name { color: #f0f0f0; font-size: 13px; font-weight: 600; }
.p-desc { color: #555; font-size: 10px; line-height: 1.3; }
.progress-container { margin-top: 12px; height: 16px; background: #222; border-radius: 8px; position: relative; overflow: hidden; }
.progress-bar { height: 100%; background: #6bbb6b; transition: width 0.3s ease; }
.progress-text { position: absolute; top: 0; left: 0; width: 100%; text-align: center; color: #fff; font-size: 10px; line-height: 16px; font-weight: 600; }
.model-pull-section { margin-top: 16px; padding: 12px; border: 1px dashed rgba(255, 255, 255, 0.1); border-radius: 12px; background: rgba(255, 255, 255, 0.02); }
.ollama-status { display: flex; align-items: center; gap: 8px; }
.status-badge { font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 20px; }
.status-badge.online { color: #6bbb6b; background: rgba(107, 187, 107, 0.1); border: 1px solid rgba(107, 187, 107, 0.2); }
.status-badge.offline { color: #e8a838; background: rgba(232, 168, 56, 0.1); border: 1px solid rgba(232, 168, 56, 0.2); }
.status-badge.checking { color: #888; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.08); }
.error { color: #cc4444; font-size: 12px; margin-top: 8px; text-align: center; }
</style>

