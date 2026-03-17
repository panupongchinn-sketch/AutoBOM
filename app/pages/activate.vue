<template>
  <div class="act-root">
    <div class="act-center">
      <!-- Logo / Brand -->
      <div class="act-brand">
        <div class="act-logo-ring">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="#3a80e8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <div class="act-brand-name">BIM Viewer</div>
          <div class="act-brand-sub">License Activation</div>
        </div>
      </div>

      <!-- Card -->
      <div class="act-card" :class="{ 'act-card-success': phase === 'success' }">

        <!-- ─── Phase: input ─── -->
        <template v-if="phase === 'input' || phase === 'error'">
          <div class="act-card-header">
            <div class="act-key-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="8" cy="15" r="4"/>
                <line x1="19" y1="5" x2="11.5" y2="12.5"/>
                <line x1="15" y1="5" x2="19" y2="9"/>
              </svg>
            </div>
            <div>
              <h1 class="act-title">กรอก License Key</h1>
              <p class="act-desc">ป้อน Product Key เพื่อเปิดใช้งานซอฟต์แวร์</p>
            </div>
          </div>

          <div class="act-form">
            <label class="act-label">License Key</label>
            <div class="act-input-wrap">
              <input
                v-model="keyInput"
                class="act-input"
                :class="{ 'act-input-error': phase === 'error' }"
                type="text"
                placeholder="XXXX-XXXX-XXXX-XXXX"
                maxlength="24"
                autocomplete="off"
                spellcheck="false"
                @input="onKeyInput"
                @keydown.enter="submit"
              />
              <button v-if="keyInput" class="act-input-clear" @click="keyInput = ''; phase = 'input'" title="ล้าง">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <!-- Error message -->
            <div v-if="phase === 'error'" class="act-error-msg">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/>
              </svg>
              {{ errorMsg }}
            </div>

          </div>

          <div class="act-actions">
            <button class="act-btn-primary" :disabled="!keyInput.trim() || loading" @click="submit">
              <span v-if="!loading">เปิดใช้งาน License</span>
              <span v-else class="act-spinner-row">
                <span class="act-spinner"></span> กำลังตรวจสอบ…
              </span>
            </button>
            <button class="act-btn-ghost" @click="signOut">ออกจากระบบ</button>
          </div>
        </template>

        <!-- ─── Phase: success ─── -->
        <template v-if="phase === 'success'">
          <div class="act-success-wrap">
            <div class="act-checkmark">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h2 class="act-success-title">เปิดใช้งานสำเร็จ!</h2>
            <div class="act-license-badge">{{ activatedLabel }}</div>
            <div class="act-expires-row">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              หมดอายุ: <strong>{{ formattedExpiry }}</strong>
            </div>
            <button class="act-btn-primary act-btn-enter" @click="goHome">
              เข้าใช้งานโปรแกรม
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
            </button>
          </div>
        </template>

      </div>

      <!-- Footer -->
      <div class="act-footer">
        ต้องการความช่วยเหลือ? ติดต่อทีมสนับสนุน
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: [] })   // ข้าม auth middleware ในหน้านี้

const { activateLicense } = useLicense()
const auth = useAuth()

const keyInput = ref("")
const phase = ref<"input" | "error" | "success">("input")
const loading = ref(false)
const errorMsg = ref("")
const activatedLabel = ref("")
const activatedExpiry = ref("")

function onKeyInput() {
  phase.value = "input"
}

const formattedExpiry = computed(() => {
  if (!activatedExpiry.value) return ""
  return new Date(activatedExpiry.value).toLocaleDateString("th-TH", {
    year: "numeric", month: "long", day: "numeric",
  })
})

async function submit() {
  if (!keyInput.value.trim() || loading.value) return
  loading.value = true
  const result = await activateLicense(keyInput.value)
  loading.value = false

  if (result.success) {
    activatedLabel.value = result.label ?? ""
    activatedExpiry.value = result.expiresAt ?? ""
    phase.value = "success"
  } else {
    errorMsg.value = result.message
    phase.value = "error"
  }
}

async function signOut() {
  await auth.signOut()
  navigateTo("/login")
}

function goHome() {
  navigateTo("/")
}
</script>

<style scoped>
* { box-sizing: border-box; }

/* ── Wrap ── */
.act-root {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: url('/city-bg.png') center bottom / cover no-repeat;
  padding: 24px;
  position: relative;
  font-family: "Noto Sans Thai", -apple-system, "Segoe UI", sans-serif;
}

.act-center {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 400px;
}

/* ── Card ── */
.act-card {
  background: #ffffff;
  border: 1px solid #d0daea;
  border-radius: 12px;
  padding: 32px 32px 28px;
  box-shadow: 0 8px 32px rgba(40, 80, 140, 0.12), 0 2px 8px rgba(0,0,0,0.06);
  transition: border-color 0.3s;
}

.act-card-success {
  border-color: #90d8a8;
}

/* ── Brand ── */
.act-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 28px;
}

.act-logo-ring {
  width: 46px;
  height: 46px;
  border-radius: 10px;
  background: #eef4fc;
  border: 1px solid #c0d4f0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.act-brand-name {
  font-size: 17px;
  font-weight: 800;
  color: #1a2535;
  letter-spacing: 0.2px;
}

.act-brand-sub {
  font-size: 11px;
  color: #8090a8;
  margin-top: 1px;
}

/* ── Card header ── */
.act-card-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 24px;
}

.act-key-icon {
  width: 40px;
  height: 40px;
  border-radius: 9px;
  background: #eef4fc;
  border: 1px solid #c0d4f0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #3a80e8;
  flex-shrink: 0;
}

.act-title {
  font-size: 17px;
  font-weight: 700;
  color: #1a2535;
  margin: 0 0 3px 0;
}

.act-desc {
  font-size: 12.5px;
  color: #7888a0;
  margin: 0;
}

/* ── Form ── */
.act-form {
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.act-label {
  font-size: 11.5px;
  font-weight: 600;
  color: #5a6878;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.act-input-wrap {
  position: relative;
}

.act-input {
  width: 100%;
  height: 42px;
  padding: 0 38px 0 14px;
  background: #f8fafc;
  border: 1px solid #c8d4e0;
  border-radius: 7px;
  color: #1a2535;
  font-size: 14px;
  font-family: "Courier New", monospace;
  letter-spacing: 1px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
}

.act-input::placeholder {
  color: #a0b0c4;
  letter-spacing: 0.5px;
}

.act-input:focus {
  border-color: #3a80e8;
  box-shadow: 0 0 0 3px rgba(58, 128, 232, 0.12);
  background: #ffffff;
}

.act-input-error {
  border-color: #e8b0b0 !important;
  box-shadow: 0 0 0 3px rgba(220, 60, 60, 0.08) !important;
}

.act-input-clear {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: #90a0b8;
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 3px;
  border-radius: 4px;
  transition: color 0.15s;
}

.act-input-clear:hover { color: #3a80e8; }

.act-error-msg {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: #b02020;
  padding: 8px 12px;
  background: #fdeaea;
  border: 1px solid #e8b0b0;
  border-radius: 7px;
}

.act-hint {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #90a0b8;
}

/* ── Actions ── */
.act-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.act-btn-primary {
  height: 42px;
  width: 100%;
  background: linear-gradient(135deg, #3a80e8, #2a60c8);
  border: none;
  border-radius: 8px;
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow: 0 3px 10px rgba(58, 128, 232, 0.35);
}

.act-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #2a70d8, #1a50b8);
  box-shadow: 0 4px 14px rgba(58, 128, 232, 0.45);
  transform: translateY(-1px);
}

.act-btn-primary:active:not(:disabled) { transform: translateY(0); }

.act-btn-primary:disabled {
  opacity: 0.65;
  cursor: not-allowed;
  transform: none;
}

.act-btn-ghost {
  height: 38px;
  width: 100%;
  background: transparent;
  border: 1px solid #d0daea;
  border-radius: 8px;
  color: #7888a0;
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.act-btn-ghost:hover {
  border-color: #a0b0c8;
  color: #3a80e8;
}

/* Loading spinner */
.act-spinner-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.act-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Success state ── */
.act-success-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 14px;
  padding: 8px 0 4px;
}

.act-checkmark {
  width: 68px;
  height: 68px;
  border-radius: 50%;
  background: linear-gradient(135deg, #22a854, #1a8040);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 4px 20px rgba(30, 160, 80, 0.3);
  animation: pop-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes pop-in {
  from { transform: scale(0.4); opacity: 0; }
  to   { transform: scale(1);   opacity: 1; }
}

.act-success-title {
  font-size: 20px;
  font-weight: 800;
  color: #1a2535;
  margin: 0;
}

.act-license-badge {
  background: #eef4fc;
  border: 1px solid #c0d4f0;
  border-radius: 999px;
  padding: 5px 18px;
  font-size: 13px;
  font-weight: 700;
  color: #2a60c8;
}

.act-expires-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #7888a0;
}

.act-expires-row strong { color: #1a2535; }

.act-btn-enter {
  margin-top: 4px;
  min-width: 200px;
  width: auto;
}

/* ── Footer ── */
.act-footer {
  margin-top: 16px;
  text-align: center;
  font-size: 12px;
  color: #90a0b8;
}

</style>
