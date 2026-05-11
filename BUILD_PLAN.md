# ClawdAsk Build Plan

## Vision
Transform OpenClaw into **ClawdAsk**: A premium, zero-configuration desktop AI experience with built-in lifetime licensing via Whop.

---

## 🚀 Status: Milestone 1 & 2 Complete (Branding, Onboarding & Infrastructure)

### Phase 1 — Core Rebrand
- [x] Audit all brand references
- [x] Create BUILD_PLAN.md
- [x] Update `package.json` → `name: clawdask`, correct description
- [x] Update `electron-builder.yml` → `productName: ClawdAsk`, all references
- [x] Update `src/main/index.ts`:
  - [x] `OPENCLAW_DIR` constant → `CLAWDASK_DIR` pointing to `~/.clawdask`
  - [x] Migration shim (copy `~/.openclaw` → `~/.clawdask` if exists)
  - [x] All user-visible status messages: ORRERY / OpenClaw → ClawdAsk

### Phase 2 — Premium Landing Page
- [x] Design dark-themed, conversion-optimized `docs/index.html`
- [x] Implement 3D-inspired aesthetics and animations
- [x] Focus copy on Privacy & One-time payment (Whop)

### Phase 3 — Hardware-First Onboarding
- [x] Implement state machine in `App.vue`: `welcome` → `hardware_check` → `model_setup` → `demo` → `paywall` → `activated` → `starting`
- [x] Integrate `api.getSpecs()` for RAM/VRAM detection
- [x] Build "Magic" model download UI with rotating quotes
- [x] Expose all required APIs in `preload/index.ts`

### Phase 4 — Whop & Supabase Integration
- [x] Implement `open-whop-checkout` IPC
- [x] Implement local license polling and `check-license` IPC
- [x] Create `src/main/supabase.ts` manager for activation logging
- [x] Connect `log-activation` IPC to Supabase client
- [x] Trigger telemetry from `App.vue` upon successful activation

### Phase 5 — Production & Maintenance (CURRENT)
- [x] Enable silent background updates via `electron-updater`
- [x] Fix syntax/encoding issues in `package.json` and `index.ts`
- [x] Verify successful boot and dev server execution (`npm run dev`)
- [ ] Finalize code signing & release to GitHub

---

## 📋 Next Steps
1. **Supply Credentials**: Add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to the environment to enable activation logging.
2. **Production Packaging**: Run `npm run build:win` to generate the final installer.
3. **Webhook Setup**: Configure a Whop webhook to deliver the `license.json` file to users upon purchase.

---

## ⚙️ Technical Decisions Log
1. **Data Directory**: Switched to `.clawdask` for a clean slate.
2. **Whop Checkout**: Using `shell.openExternal` for security; polling locally for `license.json`.
3. **Embedded Engine**: Defaulting to the local-ai-manager for "Zero-Config" experience.
4. **Supabase**: Added a dedicated manager for telemetry/activations to keep the main process clean.
