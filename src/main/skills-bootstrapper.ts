import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const CONFIG_DIR = join(app.getPath('home'), '.openclaw')
const CONFIG_PATH = join(CONFIG_DIR, 'openclaw.json')

/** Removes unrecognized keys that cause OpenClaw to crash */
function cleanConfig(config: any): any {
    if (!config) return {}

    // 1. Remove legacy root keys
    delete config.providers

    // 2. Clean auth keys (OpenClaw is strict about these)
    if (config.auth) {
        const allowed = [
            'openai', 'anthropic', 'google', 'groq', 'mistral',
            'together', 'openrouter', 'deepseek', 'xai', 'ollama', 'edge'
        ]
        Object.keys(config.auth).forEach(key => {
            // Allow detected local models (usually start with ollama or lmstudio)
            if (!allowed.includes(key) && !key.startsWith('ollama') && !key.startsWith('lmstudio')) {
                console.log(`[bootstrap] Removing invalid auth key: ${key}`)
                delete config.auth[key]
            }
        })
    }
    return config
}

export async function bootstrapSkills(): Promise<void> {
    console.log('[bootstrap] Ensuring skill configuration...')

    if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true })
    }

    let config: any = {}
    if (existsSync(CONFIG_PATH)) {
        try {
            config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
        } catch (err) {
            console.error('[bootstrap] Failed to parse existing config, starting fresh:', err)
            config = {}
        }
    }

    // 1. Ensure skills structure
    config.skills = config.skills || {}
    config.skills.entries = config.skills.entries || {}
    config.skills.load = config.skills.load || {}

    // 2. Inject bundled skills directory
    // We look for where openclaw is unpacked in the production build
    const internalSkillsDir = join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'openclaw',
        'skills'
    )

    if (existsSync(internalSkillsDir)) {
        const extraDirs = config.skills.load.extraDirs || []
        if (!extraDirs.includes(internalSkillsDir)) {
            console.log(`[bootstrap] Injecting internal skills: ${internalSkillsDir}`)
            config.skills.load.extraDirs = [...extraDirs, internalSkillsDir]
        }
    }

    // 3. Enable "Pro Defaults" if not explicitly disabled
    const proSkills = ['weather', 'web_search', 'browser', 'model-usage', 'summarize']
    proSkills.forEach(skill => {
        if (config.skills.entries[skill] === undefined) {
            config.skills.entries[skill] = { enabled: true }
            console.log(`[bootstrap] Enabled auto-skill: ${skill}`)
        }
    })

    // 4. Local Model Auto-Detection
    // Check for common local AI servers
    const localModelServices = [
        { name: 'Ollama', port: 11434, baseUrl: 'http://127.0.0.1:11434/v1', type: 'openai' },
        { name: 'LM Studio', port: 1234, baseUrl: 'http://127.0.0.1:1234/v1', type: 'openai' }
    ]

    for (const service of localModelServices) {
        const isLive = await checkPort(service.port)
        if (isLive) {
            console.log(`[bootstrap] Detected ${service.name} — adding auth entry`)
            config.auth = config.auth || {}
            // Use 'openai' compatible key since local models use OpenAI-compatible API
            const key = service.name.toLowerCase().replace(' ', '')
            config.auth[key] = {
                apiKey: 'not-required',
                baseUrl: service.baseUrl
            }
        }
    }

    // 5. Ensure basic auth structure for easier setup
    if (!config.auth) {
        config.auth = {}
        console.log('[bootstrap] Initializing auth placeholders')
    }

    // 6. Final Clean & Save
    config = cleanConfig(config)

    try {
        writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
        console.log('[bootstrap] Success: openclaw.json updated and cleaned')
    } catch (err) {
        console.error('[bootstrap] Failed to write config:', err)
    }
}

/** Check if a local port is responding */
function checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const http = require('http')
        const req = http.get(`http://127.0.0.1:${port}/`, () => resolve(true))
        req.on('error', () => resolve(false))
        req.setTimeout(500, () => { req.destroy(); resolve(false) })
    })
}
