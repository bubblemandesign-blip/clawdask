<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

// State
const step = ref<'checking' | 'setup' | 'capabilities' | 'security' | 'channels' | 'personality' | 'audio' | 'starting' | 'error'>('checking')
const provider = ref('openai')
const apiKey = ref('')
const customBaseUrl = ref('')
const errorMessage = ref('')
const isLoading = ref(false)

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

// Full provider list matching OpenClaw capabilities
const providers = [
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
  { id: 'custom', name: 'Custom', placeholder: 'API key', keyUrl: '' }
]

const selectedProvider = computed(() => providers.find(p => p.id === provider.value))
const isCustom = computed(() => provider.value === 'custom')

const personalities = [
  { id: 'pro', name: 'Professional', emoji: '👔', desc: 'Precise, helpful, and formal.' },
  { id: 'casual', name: 'Casual', emoji: '😊', desc: 'Friendly and conversational.' },
  { id: 'creative', name: 'Creative', emoji: '🎨', desc: 'Imaginative and poetic.' },
  { id: 'coder', name: 'The Architect', emoji: '💻', desc: 'Focused on code and logic.' }
]

onMounted(async () => {
  try {
    const result = await api.checkOpenClaw()
    if (result.installed) {
      step.value = 'setup'
    } else {
      step.value = 'setup'
    }
  } catch {
    step.value = 'setup'
  }
})

function goToCapabilities() {
  if (!apiKey.value.trim()) {
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
    const config: any = {
      provider: provider.value,
      apiKey: apiKey.value.trim(),
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
    if (isCustom.value) {
      config.baseUrl = customBaseUrl.value.trim()
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

          <label class="label" style="margin-top: 20px">API Key</label>
          <input
            v-model="apiKey"
            type="password"
            class="input"
            :placeholder="selectedProvider?.placeholder"
            @keyup.enter="goToCapabilities"
          />

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
            :disabled="!apiKey.trim() || (isCustom && !customBaseUrl.trim())"
            @click="goToCapabilities"
          >
            Continue
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
            <span v-else>Launch ClawDesk Premire</span>
          </button>
        </div>
      </div>

      <!-- Starting -->
      <div v-if="step === 'starting'" class="content">
        <div class="spinner-container">
          <div class="spinner"></div>
          <p class="status-text">Starting…</p>
          <p class="status-sub">Applying your premium configuration</p>
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
.error { color: #cc4444; font-size: 12px; margin-top: 8px; text-align: center; }
</style>

