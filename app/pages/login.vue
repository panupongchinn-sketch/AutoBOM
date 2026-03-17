<script setup lang="ts">
import { ref } from "vue"

definePageMeta({ layout: false })

const auth  = useAuth()
const route = useRoute()

type Tab = "login" | "register"
const tab = ref<Tab>("login")

const email    = ref("")
const password = ref("")
const fullName = ref("")
const loading  = ref(false)
const errorMsg = ref(
  route.query.reason === "email_mismatch"
    ? "อีเมลนี้ไม่ตรงกับที่ใช้ activate License กรุณาเข้าสู่ระบบด้วยอีเมลที่ถูกต้อง"
    : ""
)
const successMsg = ref("")
const showPass = ref(false)

function reset() {
  email.value    = ""
  password.value = ""
  fullName.value = ""
  errorMsg.value = ""
  successMsg.value = ""
}

function switchTab(t: Tab) {
  tab.value = t
  reset()
}

async function submit() {
  errorMsg.value   = ""
  successMsg.value = ""

  if (!email.value.trim() || !password.value) {
    errorMsg.value = "กรุณากรอกอีเมลและรหัสผ่าน"
    return
  }

  if (tab.value === "register" && !fullName.value.trim()) {
    errorMsg.value = "กรุณากรอกชื่อ-นามสกุล"
    return
  }

  loading.value = true
  try {
    if (tab.value === "login") {
      const { error } = await auth.signIn(email.value.trim(), password.value)
      if (error) { errorMsg.value = error.message; return }
      await navigateTo("/")
    } else {
      const { error } = await auth.signUp(email.value.trim(), password.value, fullName.value.trim())
      if (error) { errorMsg.value = error.message; return }
      successMsg.value = "สมัครสมาชิกสำเร็จ — กรุณาตรวจสอบอีเมลเพื่อยืนยัน"
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="lp-wrap">
    <!-- Card -->
    <div class="lp-card">

      <!-- Brand header -->
      <div class="lp-brand">
        <div class="lp-logo">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="#3a80e8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <div class="lp-app-name">BIM Viewer</div>
          <div class="lp-app-sub">Digital Twin Platform</div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="lp-tabs">
        <button
          class="lp-tab"
          :class="{ active: tab === 'login' }"
          @click="switchTab('login')"
        >เข้าสู่ระบบ</button>
        <button
          class="lp-tab"
          :class="{ active: tab === 'register' }"
          @click="switchTab('register')"
        >สมัครสมาชิก</button>
      </div>

      <!-- Form -->
      <form class="lp-form" @submit.prevent="submit">

        <!-- Full name (register only) -->
        <div v-if="tab === 'register'" class="lp-field">
          <label class="lp-label">ชื่อ-นามสกุล</label>
          <div class="lp-input-wrap">
            <svg class="lp-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            <input
              v-model="fullName"
              type="text"
              class="lp-input"
              placeholder="ชื่อจริง นามสกุล"
              autocomplete="name"
            />
          </div>
        </div>

        <!-- Email -->
        <div class="lp-field">
          <label class="lp-label">อีเมล</label>
          <div class="lp-input-wrap">
            <svg class="lp-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            <input
              v-model="email"
              type="email"
              class="lp-input"
              placeholder="your@email.com"
              autocomplete="email"
            />
          </div>
        </div>

        <!-- Password -->
        <div class="lp-field">
          <label class="lp-label">รหัสผ่าน</label>
          <div class="lp-input-wrap">
            <svg class="lp-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <input
              v-model="password"
              :type="showPass ? 'text' : 'password'"
              class="lp-input"
              placeholder="รหัสผ่าน"
              autocomplete="current-password"
            />
            <button type="button" class="lp-pass-toggle" tabindex="-1" @click="showPass = !showPass">
              <svg v-if="!showPass" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Error / Success -->
        <div v-if="errorMsg" class="lp-msg lp-msg-error">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
          </svg>
          {{ errorMsg }}
        </div>
        <div v-if="successMsg" class="lp-msg lp-msg-success">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {{ successMsg }}
        </div>

        <!-- Submit -->
        <button type="submit" class="lp-submit" :disabled="loading">
          <svg v-if="loading" class="lp-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 12a9 9 0 1 1-6.22-8.56"/>
          </svg>
          <span v-else-if="tab === 'login'">เข้าสู่ระบบ</span>
          <span v-else>สมัครสมาชิก</span>
        </button>

      </form>

      <!-- Footer link -->
      <div class="lp-footer-link">
        <template v-if="tab === 'login'">
          ยังไม่มีบัญชี?
          <button class="lp-link" @click="switchTab('register')">สมัครสมาชิก</button>
        </template>
        <template v-else>
          มีบัญชีแล้ว?
          <button class="lp-link" @click="switchTab('login')">เข้าสู่ระบบ</button>
        </template>
      </div>

    </div>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; }

/* ── Wrap ── */
.lp-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: url('/city-bg.png') center bottom / cover no-repeat;
  padding: 24px;
  position: relative;
  font-family: "Noto Sans Thai", -apple-system, "Segoe UI", sans-serif;
}

/* ── Card ── */
.lp-card {
  position: relative;
  width: 100%;
  max-width: 400px;
  background: #ffffff;
  border: 1px solid #d0daea;
  border-radius: 12px;
  padding: 32px 32px 24px;
  box-shadow: 0 8px 32px rgba(40, 80, 140, 0.12), 0 2px 8px rgba(0,0,0,0.06);
}

/* ── Brand ── */
.lp-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.lp-logo {
  width: 46px; height: 46px;
  background: #eef4fc;
  border: 1px solid #c0d4f0;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.lp-app-name {
  font-size: 17px;
  font-weight: 800;
  color: #1a2535;
  letter-spacing: 0.2px;
}

.lp-app-sub {
  font-size: 11px;
  color: #8090a8;
  margin-top: 1px;
}

/* ── Tabs ── */
.lp-tabs {
  display: flex;
  background: #f0f4f8;
  border-radius: 8px;
  padding: 3px;
  margin-bottom: 24px;
  gap: 3px;
}

.lp-tab {
  flex: 1;
  padding: 7px 0;
  background: none;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #6878a0;
  cursor: pointer;
  transition: all 0.15s;
}

.lp-tab:hover { color: #2a4060; }

.lp-tab.active {
  background: #ffffff;
  color: #1a4aaa;
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);
}

/* ── Form ── */
.lp-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.lp-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.lp-label {
  font-size: 11.5px;
  font-weight: 600;
  color: #5a6878;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.lp-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.lp-ico {
  position: absolute;
  left: 11px;
  color: #90a0b8;
  flex-shrink: 0;
}

.lp-input {
  width: 100%;
  height: 40px;
  padding: 0 38px 0 36px;
  background: #f8fafc;
  border: 1px solid #c8d4e0;
  border-radius: 7px;
  font-size: 13px;
  color: #1a2535;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.lp-input:focus {
  border-color: #3a80e8;
  box-shadow: 0 0 0 3px rgba(58,128,232,0.12);
  background: #ffffff;
}

.lp-input::placeholder { color: #a0b0c4; }

.lp-pass-toggle {
  position: absolute;
  right: 10px;
  background: none;
  border: none;
  color: #90a0b8;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
}

.lp-pass-toggle:hover { color: #3a80e8; }

/* ── Messages ── */
.lp-msg {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 9px 12px;
  border-radius: 7px;
  font-size: 12.5px;
  line-height: 1.5;
}

.lp-msg-error {
  background: #fdeaea;
  border: 1px solid #e8b0b0;
  color: #b02020;
}

.lp-msg-success {
  background: #e8f8ee;
  border: 1px solid #90d8a8;
  color: #1a6030;
}

/* ── Submit ── */
.lp-submit {
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
  box-shadow: 0 3px 10px rgba(58,128,232,0.35);
  margin-top: 4px;
}

.lp-submit:hover:not(:disabled) {
  background: linear-gradient(135deg, #2a70d8, #1a50b8);
  box-shadow: 0 4px 14px rgba(58,128,232,0.45);
  transform: translateY(-1px);
}

.lp-submit:disabled {
  opacity: 0.65;
  cursor: not-allowed;
  transform: none;
}

/* Spinner */
.lp-spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Footer links ── */
.lp-footer-link {
  margin-top: 18px;
  text-align: center;
  font-size: 12.5px;
  color: #7888a0;
}

.lp-link {
  background: none;
  border: none;
  color: #3a80e8;
  font-weight: 600;
  cursor: pointer;
  font-size: 12.5px;
  margin-left: 4px;
  padding: 0;
}

.lp-link:hover { color: #1a50b8; text-decoration: underline; }

.lp-back {
  margin-top: 14px;
  text-align: center;
}

.lp-back-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #90a0b8;
  text-decoration: none;
  transition: color 0.1s;
}

.lp-back-link:hover { color: #3a80e8; }
</style>
