<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

const step = ref<'welcome' | 'provider_select' | 'hardware_check' | 'model_setup' | 'paywall' | 'activated' | 'starting' | 'error'>('welcome')
const detectedBackend = ref<'ollama' | 'embedded' | 'none'>('none')
const backendChecked = ref(false)
const backendEngineInstalled = ref(false)
const errorMessage = ref('')
const isLoading = ref(false)
const systemSpecs = ref({ totalMem: 0, vram: 0, cpu: '', gpu: '' })
const startupStatus = ref('Initializing engine...')
const enableComputerControl = ref(true)
const enableWebBrowser = ref(true)
const aiMode = ref<'local' | 'cloud'>('local')
const cloudProvider = ref('moonshot')
const cloudApiKey = ref('')
const cloudBaseUrl = ref('https://api.moonshot.ai/v1')
const whopLicenseKey = ref('')
const isWhopLoading = ref(false)
const isActivated = ref(false)
const whopCheckoutUrl = ref('https://whop.com/checkout/clawdask-lifetime-access')
const embeddedEngineInstalled = ref(false)
const embeddedModelInstalled = ref(false)
const isDownloadingEmbedded = ref(false)
const embeddedProgress = ref(0)
const embeddedStatus = ref('')
const embeddedError = ref('')
const api = (window as any).api
const selectedModel = ref('local/qwen2.5-7b')
const localModelsMap = ref<Record<string, boolean>>({})

const hardwareRating = computed(() => {
  const ramGB = systemSpecs.value.totalMem / (1024 * 1024 * 1024)
  if (ramGB >= 16) return { score: 'Excellent', color: '#f97316', text: 'Capable of running any local model.' }
  if (ramGB >= 8) return { score: 'Good', color: '#fb923c', text: 'Suitable for balanced 3B-8B models.' }
  return { score: 'Limited', color: '#f59e0b', text: 'Cloud AI recommended for 8GB or less.' }
})

async function detectBackend() {
  backendChecked.value = false
  try {
    const result = await api.detectLocalBackend()
    detectedBackend.value = result.backend
    backendEngineInstalled.value = result.engineInstalled
  } catch { detectedBackend.value = 'none' }
  backendChecked.value = true
}

async function refreshEmbeddedStatus() {
  if (aiMode.value !== 'local') return
  const modelId = selectedModel.value.replace('local/', '') || 'qwen2.5-7b'
  try {
    const status = await api.getLocalAiAllStatus()
    embeddedEngineInstalled.value = status.engineInstalled
    localModelsMap.value = status.models || {}
    embeddedModelInstalled.value = localModelsMap.value[modelId] || false
  } catch {}
}

async function startEmbeddedPull() {
  embeddedError.value = ''
  embeddedStatus.value = 'Initializing...'
  isDownloadingEmbedded.value = true
  const modelId = selectedModel.value.replace('local/', '') || 'qwen2.5-7b'
  if (!embeddedEngineInstalled.value) {
    embeddedStatus.value = 'Fetching engine...'
    const unsub = api.onLocalAiDownloadProgress((data: any) => { embeddedProgress.value = data.percent; embeddedStatus.value = data.text })
    const result = await api.downloadLocalEngine()
    unsub()
    if (!result.success) { embeddedError.value = result.error || 'Engine download failed.'; isDownloadingEmbedded.value = false; return }
    embeddedEngineInstalled.value = true
  }
  embeddedStatus.value = 'Fetching model parameters...'
  const unsubModel = api.onLocalAiDownloadProgress((data: any) => { embeddedProgress.value = data.percent; embeddedStatus.value = data.text })
  const resModel = await api.downloadLocalModel(modelId, false)
  unsubModel()
  if (resModel.success) {
    embeddedModelInstalled.value = true
    localModelsMap.value[modelId] = true
    embeddedStatus.value = 'Ready.'
    setTimeout(() => { isDownloadingEmbedded.value = false; step.value = 'paywall' }, 1000)
  } else { embeddedError.value = resModel.error || 'Model download failed.'; isDownloadingEmbedded.value = false }
}

async function handleProviderSelection() {
  if (aiMode.value === 'local') { step.value = 'hardware_check' } else { step.value = 'paywall' }
}

async function openCheckout() { api.openWhopCheckout(whopCheckoutUrl.value) }

async function validateLicense() {
  if (!whopLicenseKey.value.trim()) { errorMessage.value = 'Please enter a valid license key.'; return }
  isWhopLoading.value = true
  errorMessage.value = ''
  const res = await api.validateWhopLicense(whopLicenseKey.value.trim())
  if (res.success) { isActivated.value = true; step.value = 'activated' }
  else { errorMessage.value = res.error || 'Invalid or expired license key.' }
  isWhopLoading.value = false
}

async function finishSetup() {
  isLoading.value = true
  step.value = 'starting'
  try {
    let config: any = { enableWebBrowser: enableWebBrowser.value, enableComputerControl: enableComputerControl.value, personalityTemplate: 'pro', enableTTS: false }
    if (aiMode.value === 'local') { config.provider = 'local'; config.model = selectedModel.value; config.apiKey = 'local' }
    else { config.provider = cloudProvider.value; config.apiKey = cloudApiKey.value; config.baseUrl = cloudBaseUrl.value; config.model = cloudProvider.value === 'moonshot' ? 'moonshot-v1-8k' : 'gpt-4o' }
    await api.saveConfig(config)
    await api.startApp()
  } catch (err) { step.value = 'error'; errorMessage.value = String(err) }
  isLoading.value = false
}

api.onGatewayStatus((status: string) => {
  if (status.startsWith('FATAL_ERROR:')) { step.value = 'error'; errorMessage.value = status.replace('FATAL_ERROR:', '').trim(); return }
  startupStatus.value = status
})

onMounted(async () => {
  const specs = await api.getSpecs()
  if (specs) systemSpecs.value = specs
  const result = await api.checkClawdAsk()
  if (result.hasValidConfig) { step.value = 'starting'; api.startApp() }
  else { step.value = 'welcome' }
  await detectBackend()
  await refreshEmbeddedStatus()
})
</script>

<template>
  <div class="app-shell">
    <div class="app-card">

      <!-- LOGO HEADER -->
      <div class="app-header">
        <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
          <path d="M6 24 L10 8 L16 18 L22 8 L26 24" stroke="#f97316" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="16" cy="27" r="1.5" fill="#f97316" opacity="0.5"/>
        </svg>
        <span class="app-brand">ClawdAsk</span>
      </div>

      <!-- WELCOME -->
      <div v-if="step === 'welcome'" class="step-box center-step">
        <div class="hero-claw">
          <svg width="80" height="80" viewBox="0 0 64 64" fill="none">
            <rect x="8" y="8" width="8" height="8" fill="#c2410c" rx="1"/>
            <rect x="8" y="16" width="8" height="8" fill="#f97316" rx="1"/>
            <rect x="16" y="16" width="8" height="8" fill="#fb923c" rx="1"/>
            <rect x="8" y="24" width="8" height="8" fill="#c2410c" rx="1"/>
            <rect x="16" y="24" width="8" height="8" fill="#f97316" rx="1"/>
            <rect x="48" y="8" width="8" height="8" fill="#c2410c" rx="1"/>
            <rect x="48" y="16" width="8" height="8" fill="#f97316" rx="1"/>
            <rect x="40" y="16" width="8" height="8" fill="#fb923c" rx="1"/>
            <rect x="48" y="24" width="8" height="8" fill="#c2410c" rx="1"/>
            <rect x="40" y="24" width="8" height="8" fill="#f97316" rx="1"/>
            <rect x="16" y="32" width="32" height="8" fill="#f97316" rx="1"/>
            <rect x="20" y="40" width="24" height="8" fill="#c2410c" rx="1"/>
            <rect x="24" y="48" width="16" height="8" fill="#7c2d12" rx="1"/>
          </svg>
        </div>
        <h1 class="welcome-title">Your Digital Employee</h1>
        <p class="welcome-sub">Autonomous agent. Real computer control. Zero subscriptions.</p>
        <button class="btn-primary" @click="step = 'provider_select'">Configure Workspace →</button>
      </div>

      <!-- PROVIDER SELECT -->
      <div v-if="step === 'provider_select'" class="step-box">
        <h2 class="step-title">Intelligence Source</h2>
        <p class="step-sub">Choose where your AI runs. Local for privacy, Cloud for maximum power.</p>
        <div class="radio-grid">
          <label class="radio-card" :class="{ active: aiMode === 'local' }">
            <input type="radio" v-model="aiMode" value="local" />
            <div class="radio-content">
              <span class="radio-icon">🖥️</span>
              <h4>Local Engine</h4>
              <p>Private, offline, no API costs</p>
            </div>
          </label>
          <label class="radio-card" :class="{ active: aiMode === 'cloud' }">
            <input type="radio" v-model="aiMode" value="cloud" />
            <div class="radio-content">
              <span class="radio-icon">☁️</span>
              <h4>Cloud API</h4>
              <p>Maximum reasoning power</p>
            </div>
          </label>
        </div>
        <div v-if="aiMode === 'cloud'" class="cloud-fields">
          <div class="field">
            <label>Provider</label>
            <select v-model="cloudProvider" class="input-field">
              <option value="moonshot">Kimi (Moonshot)</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="custom">Custom Endpoint</option>
            </select>
          </div>
          <div class="field">
            <label>API Key</label>
            <input type="password" v-model="cloudApiKey" class="input-field" placeholder="sk-..." />
          </div>
          <div class="field" v-if="cloudProvider === 'custom'">
            <label>Base URL</label>
            <input type="text" v-model="cloudBaseUrl" class="input-field" placeholder="https://api.example.com/v1" />
          </div>
        </div>
        <div class="actions">
          <button class="btn-ghost" @click="step = 'welcome'">Back</button>
          <button class="btn-primary" @click="handleProviderSelection()">Continue →</button>
        </div>
      </div>

      <!-- HARDWARE CHECK -->
      <div v-if="step === 'hardware_check'" class="step-box">
        <h2 class="step-title">Hardware Profile</h2>
        <p class="step-sub">Analyzing your system to select the optimal model.</p>
        <div class="specs-panel">
          <div class="spec-row">
            <span>System Memory</span>
            <span class="spec-val">{{ (systemSpecs.totalMem / (1024**3)).toFixed(1) }} GB</span>
          </div>
          <div class="spec-divider"></div>
          <div class="spec-row">
            <span>Capability Index</span>
            <span class="spec-val" :style="{ color: hardwareRating.color }">{{ hardwareRating.score }}</span>
          </div>
          <p class="spec-desc">{{ hardwareRating.text }}</p>
        </div>
        <div class="field" style="margin-top: 20px;">
          <label>Engine Core</label>
          <select v-model="selectedModel" class="input-field" @change="refreshEmbeddedStatus()">
            <option value="local/qwen2.5-0.5b">Qwen 2.5 0.5B — Micro</option>
            <option value="local/llama3.2-3b">Llama 3.2 3B — Fast</option>
            <option value="local/qwen2.5-7b">Qwen 2.5 7B — Default</option>
            <option value="local/deepseek-r1-7b">DeepSeek R1 7B — Reasoning</option>
          </select>
        </div>
        <div class="actions">
          <button class="btn-ghost" @click="step = 'provider_select'">Back</button>
          <button class="btn-primary" @click="step = 'model_setup'">Initialize →</button>
        </div>
      </div>

      <!-- MODEL SETUP -->
      <div v-if="step === 'model_setup'" class="step-box">
        <h2 class="step-title">Acquiring Weights</h2>
        <p class="step-sub">Downloading model files to your machine.</p>
        <div class="progress-wrap">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: embeddedProgress + '%' }"></div>
          </div>
          <div class="progress-meta">
            <span>{{ embeddedStatus || 'Awaiting command...' }}</span>
            <span class="pct">{{ embeddedProgress }}%</span>
          </div>
        </div>
        <p v-if="embeddedError" class="err-text">{{ embeddedError }}</p>
        <div class="actions" style="margin-top: 24px;">
          <button class="btn-ghost" @click="step = 'hardware_check'">Back</button>
          <button v-if="!isDownloadingEmbedded" class="btn-primary" @click="startEmbeddedPull()">
            {{ embeddedModelInstalled ? 'Continue →' : 'Start Download' }}
          </button>
        </div>
      </div>

      <!-- PAYWALL -->
      <div v-if="step === 'paywall'" class="step-box">
        <h2 class="step-title">Almost Ready</h2>
        <p class="step-sub">Start a free trial or activate with your license key.</p>

        <div class="perm-panel">
          <p class="perm-label">Agent Permissions</p>
          <label class="perm-row">
            <input type="checkbox" v-model="enableComputerControl" />
            <span>Allow Computer Control (Mouse &amp; Keyboard)</span>
          </label>
          <label class="perm-row">
            <input type="checkbox" v-model="enableWebBrowser" />
            <span>Allow Web Browsing</span>
          </label>
        </div>

        <div class="field">
          <label>License Key <span style="color: #444; font-weight: 400;">(optional — skip for trial)</span></label>
          <input type="text" v-model="whopLicenseKey" class="input-field mono" placeholder="whop_..." />
        </div>
        <p v-if="errorMessage" class="err-text">{{ errorMessage }}</p>

        <div class="actions" style="margin-top: 8px; flex-wrap: wrap; gap: 10px;">
          <a href="#" @click.prevent="openCheckout" class="link-orange">Purchase License</a>
          <div style="display: flex; gap: 10px; margin-left: auto;">
            <button class="btn-ghost" @click="finishSetup">Free Trial</button>
            <button class="btn-primary" :disabled="isWhopLoading" @click="validateLicense">
              {{ isWhopLoading ? 'Verifying...' : 'Activate' }}
            </button>
          </div>
        </div>
      </div>

      <!-- ACTIVATED -->
      <div v-if="step === 'activated'" class="step-box center-step">
        <div class="status-icon success">✓</div>
        <h2 class="step-title">License Verified</h2>
        <p class="step-sub">Your workspace is permanently unlocked.</p>
        <button class="btn-primary" @click="finishSetup">Launch Workspace →</button>
      </div>

      <!-- STARTING -->
      <div v-if="step === 'starting'" class="step-box center-step">
        <div class="spinner"></div>
        <h2 class="step-title">Starting Environment</h2>
        <p class="step-sub">{{ startupStatus }}</p>
      </div>

      <!-- ERROR -->
      <div v-if="step === 'error'" class="step-box center-step">
        <div class="status-icon error">!</div>
        <h2 class="step-title">Initialization Failed</h2>
        <p class="step-sub">{{ errorMessage }}</p>
        <button class="btn-primary" @click="step = 'welcome'">Restart →</button>
      </div>

    </div>
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #000; color: #ededed; font-family: 'Inter', sans-serif; -webkit-font-smoothing: antialiased; }
</style>

<style scoped>
/* ── Shell ── */
.app-shell {
  width: 100vw; height: 100vh;
  display: flex; align-items: center; justify-content: center;
  background: #000;
  -webkit-app-region: drag;
}

.app-card {
  width: 460px;
  background: #080808;
  border: 1px solid #1a1a1a;
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(249,115,22,0.04);
  overflow: hidden;
  -webkit-app-region: no-drag;
}

/* ── Header ── */
.app-header {
  display: flex; align-items: center; gap: 8px;
  padding: 18px 28px;
  border-bottom: 1px solid #111;
  background: #050505;
}
.app-brand { font-size: 15px; font-weight: 700; letter-spacing: -0.03em; }

/* ── Step containers ── */
.step-box { padding: 32px 28px; animation: fadein 0.2s ease; }
.center-step { text-align: center; }
@keyframes fadein { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; } }

/* ── Welcome ── */
.hero-claw { margin: 0 auto 20px; display: inline-block; animation: float-claw 3s ease-in-out infinite; }
@keyframes float-claw { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
.welcome-title { font-size: 22px; font-weight: 700; letter-spacing: -0.03em; margin-bottom: 8px; }
.welcome-sub { font-size: 13px; color: #666; margin-bottom: 28px; }

/* ── Step headings ── */
.step-title { font-size: 18px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 6px; }
.step-sub { font-size: 13px; color: #666; line-height: 1.5; margin-bottom: 24px; }

/* ── Buttons ── */
.btn-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 11px 20px; border-radius: 8px;
  background: #f97316; color: #fff;
  font-size: 13px; font-weight: 600; font-family: inherit;
  border: none; cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 0 16px rgba(249,115,22,0.15);
}
.btn-primary:hover { background: #fb923c; transform: translateY(-1px); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

.btn-ghost {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 11px 20px; border-radius: 8px;
  background: transparent; color: #888;
  font-size: 13px; font-weight: 500; font-family: inherit;
  border: 1px solid #1f1f1f; cursor: pointer;
  transition: all 0.2s;
}
.btn-ghost:hover { border-color: #333; color: #ededed; }

/* ── Radio cards ── */
.radio-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }
.radio-card {
  display: block; padding: 16px; border: 1px solid #1a1a1a;
  border-radius: 10px; cursor: pointer; transition: all 0.15s;
  background: #050505;
}
.radio-card:hover { border-color: #2a2a2a; }
.radio-card.active { border-color: #f97316; background: rgba(249,115,22,0.04); }
.radio-card input { display: none; }
.radio-content { text-align: center; }
.radio-icon { font-size: 22px; display: block; margin-bottom: 8px; }
.radio-content h4 { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
.radio-content p { font-size: 12px; color: #555; }

/* ── Fields ── */
.cloud-fields { margin-bottom: 20px; }
.field { margin-bottom: 14px; }
.field label { display: block; font-size: 11px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
.input-field {
  width: 100%; background: #0a0a0a; border: 1px solid #1f1f1f;
  padding: 10px 12px; border-radius: 7px; color: #ededed;
  font-family: inherit; font-size: 13px; outline: none;
  transition: border 0.15s;
}
.input-field:focus { border-color: #f97316; box-shadow: 0 0 0 2px rgba(249,115,22,0.08); }
.mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; }

/* ── Specs panel ── */
.specs-panel { background: #050505; border: 1px solid #141414; border-radius: 8px; padding: 16px; }
.spec-row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px; }
.spec-row span:first-child { color: #666; }
.spec-val { font-weight: 600; }
.spec-divider { height: 1px; background: #141414; margin: 10px 0; }
.spec-desc { font-size: 12px; color: #555; }

/* ── Progress ── */
.progress-wrap { margin-bottom: 8px; }
.progress-bar { height: 3px; background: #1a1a1a; border-radius: 2px; overflow: hidden; }
.progress-fill { height: 100%; background: #f97316; transition: width 0.25s linear; }
.progress-meta { display: flex; justify-content: space-between; font-size: 12px; color: #555; margin-top: 8px; }
.pct { color: #f97316; font-weight: 600; }

/* ── Permissions ── */
.perm-panel { background: #050505; border: 1px solid #141414; border-radius: 8px; padding: 14px 16px; margin-bottom: 16px; }
.perm-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #444; margin-bottom: 10px; }
.perm-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #888; cursor: pointer; margin-bottom: 6px; }
.perm-row:last-child { margin-bottom: 0; }
.perm-row input { accent-color: #f97316; }

/* ── Actions ── */
.actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 24px; align-items: center; }
.link-orange { font-size: 12px; color: #f97316; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }

/* ── Status icons ── */
.status-icon {
  width: 52px; height: 52px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; font-weight: 700; margin: 0 auto 20px;
}
.status-icon.success { background: rgba(249,115,22,0.1); color: #f97316; border: 1px solid rgba(249,115,22,0.2); }
.status-icon.error { background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.2); }

/* ── Spinner ── */
.spinner {
  width: 28px; height: 28px; border: 2px solid #1f1f1f;
  border-top-color: #f97316; border-radius: 50%;
  animation: spin 0.8s linear infinite; margin: 0 auto 20px;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Error ── */
.err-text { color: #ef4444; font-size: 12px; margin-top: 8px; }
</style>
