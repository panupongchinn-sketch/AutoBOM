<script setup lang="ts">

interface AdminUser {
  id: string
  email: string
  full_name: string
  created_at: string
  project_count: number
  license_key: string | null
  license_label: string | null
  expires_at: string | null
  is_super_user: boolean
}

definePageMeta({ layout: false, middleware: "auth" })

const { $supabase } = useNuxtApp() as any
const auth = useAuth()
const superUser = useSuperUser()

// ── State ──────────────────────────────────────────────────────────────────
const loading    = ref(true)
const users      = ref<AdminUser[]>([])
const error      = ref("")
const search     = ref("")
const filterStatus = ref<"all" | "active" | "expired" | "none">("all")
const sortKey    = ref<keyof AdminUser>("created_at")
const sortDir    = ref<"asc" | "desc">("desc")

// ── Gen License Modal ──────────────────────────────────────────────────────
const showGenModal   = ref(false)
const genTargetUser  = ref<AdminUser | null>(null)
const genDuration    = ref(30)
const genGenerating  = ref(false)
const genResult      = ref<{ key: string; expires_at: string; label: string } | null>(null)
const genError       = ref("")

const DURATION_PRESETS = [
  { days: 7,   label: "7 วัน" },
  { days: 30,  label: "1 เดือน" },
  { days: 90,  label: "3 เดือน" },
  { days: 180, label: "6 เดือน" },
  { days: 365, label: "1 ปี" },
]

const selectedPreset = computed(() =>
  DURATION_PRESETS.find(p => p.days === genDuration.value) ?? null
)

function openGenModal(user: AdminUser) {
  genTargetUser.value = user
  genDuration.value   = 30
  genResult.value     = null
  genError.value      = ""
  showGenModal.value  = true
}

function closeGenModal() {
  showGenModal.value = false
  genTargetUser.value = null
  genResult.value = null
  genError.value = ""
}

async function generateLicense() {
  if (!genTargetUser.value) return
  genGenerating.value = true
  genError.value = ""
  genResult.value = null
  try {
    const preset = selectedPreset.value
    const label  = preset ? preset.label : `${genDuration.value} วัน`
    const { data, error: rpcErr } = await $supabase.rpc("admin_gen_license", {
      p_target_user_id: genTargetUser.value.id,
      p_duration_days:  genDuration.value,
      p_label:          label,
    })
    if (rpcErr) throw new Error(rpcErr.message)
    genResult.value = data as { key: string; expires_at: string; label: string }
    await fetchUsers()   // refresh table
  } catch (e: any) {
    genError.value = e?.message || "เกิดข้อผิดพลาด"
  } finally {
    genGenerating.value = false
  }
}

async function copyKey(key: string) {
  await navigator.clipboard.writeText(key)
}

// ── Revoke License ─────────────────────────────────────────────────────────
const showRevokeConfirm = ref(false)
const revokeTarget      = ref<AdminUser | null>(null)
const revoking          = ref(false)
const revokeError       = ref("")

function openRevokeConfirm(user: AdminUser) {
  revokeTarget.value  = user
  revokeError.value   = ""
  showRevokeConfirm.value = true
}

function closeRevokeConfirm() {
  showRevokeConfirm.value = false
  revokeTarget.value = null
  revokeError.value  = ""
}

async function revokeLicense() {
  if (!revokeTarget.value) return
  revoking.value    = true
  revokeError.value = ""
  try {
    const { error: rpcErr } = await $supabase.rpc("admin_revoke_license", {
      p_target_user_id: revokeTarget.value.id,
    })
    if (rpcErr) throw new Error(rpcErr.message)
    closeRevokeConfirm()
    await fetchUsers()
  } catch (e: any) {
    revokeError.value = e?.message || "เกิดข้อผิดพลาด"
  } finally {
    revoking.value = false
  }
}

// ── Guard: ต้องเป็น super user ─────────────────────────────────────────────
onMounted(async () => {
  const isSuper = await superUser.checkSuperUser()
  if (!isSuper) {
    await navigateTo("/")
    return
  }
  await fetchUsers()
})

// ── Fetch: เรียก RPC โดยตรง ไม่ต้องการ SERVICE_KEY ──────────────────────────
async function fetchUsers() {
  loading.value = true
  error.value   = ""
  try {
    const { data, error: rpcError } = await $supabase.rpc("admin_get_all_users")
    if (rpcError) throw new Error(rpcError.message)
    users.value = data as AdminUser[]
  } catch (e: any) {
    error.value = e?.message || "เกิดข้อผิดพลาดในการดึงข้อมูล"
  } finally {
    loading.value = false
  }
}

// ── Computed: filtered + sorted ────────────────────────────────────────────
const now = new Date()

function licenseStatus(u: AdminUser): "active" | "expired" | "none" {
  if (!u.expires_at) return "none"
  return new Date(u.expires_at) > now ? "active" : "expired"
}

const filtered = computed(() => {
  let list = users.value

  // filter by search
  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter(u =>
      u.email.toLowerCase().includes(q) ||
      u.full_name.toLowerCase().includes(q) ||
      (u.license_key ?? "").toLowerCase().includes(q)
    )
  }

  // filter by license status
  if (filterStatus.value !== "all") {
    list = list.filter(u => licenseStatus(u) === filterStatus.value)
  }

  // sort
  list = [...list].sort((a, b) => {
    const av = a[sortKey.value] ?? ""
    const bv = b[sortKey.value] ?? ""
    const cmp = String(av).localeCompare(String(bv), "th")
    return sortDir.value === "asc" ? cmp : -cmp
  })

  return list
})

function toggleSort(key: keyof AdminUser) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc"
  } else {
    sortKey.value = key
    sortDir.value = "asc"
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────
const stats = computed(() => {
  const total   = users.value.length
  const active  = users.value.filter(u => licenseStatus(u) === "active").length
  const expired = users.value.filter(u => licenseStatus(u) === "expired").length
  const noLic   = users.value.filter(u => licenseStatus(u) === "none").length
  const totalProjects = users.value.reduce((s, u) => s + u.project_count, 0)
  return { total, active, expired, noLic, totalProjects }
})

// ── Format helpers ─────────────────────────────────────────────────────────
function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("th-TH", {
    year:  "numeric",
    month: "short",
    day:   "numeric",
  })
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null
  const diff = new Date(iso).getTime() - now.getTime()
  return diff > 0 ? Math.ceil(diff / 86_400_000) : 0
}

async function logout() {
  await auth.signOut()
  superUser.resetSuperUser()
  await navigateTo("/login")
}
</script>

<template>
  <div class="mgmt-app">
    <!-- ══ HEADER ═══════════════════════════════════════════════════════════ -->
    <header class="mgmt-header">
      <div class="mgmt-header-left">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="#4a9eff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="mgmt-brand">BIM Viewer</span>
        <span class="mgmt-divider">/</span>
        <span class="mgmt-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          จัดการผู้ใช้งาน
        </span>
        <span class="mgmt-super-badge">Super User</span>
      </div>
      <div class="mgmt-header-right">
        <NuxtLink to="/" class="mgmt-back-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          กลับ BIM Viewer
        </NuxtLink>
        <button class="mgmt-logout-btn" @click="logout">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          ออกจากระบบ
        </button>
      </div>
    </header>

    <!-- ══ BODY ══════════════════════════════════════════════════════════════ -->
    <main class="mgmt-main">

      <!-- ── Loading ──────────────────────────────────────────────────────── -->
      <div v-if="loading" class="mgmt-loading">
        <span class="mgmt-spinner"></span>
        <span>กำลังโหลดข้อมูล…</span>
      </div>

      <!-- ── Error ───────────────────────────────────────────────────────── -->
      <div v-else-if="error" class="mgmt-error">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        {{ error }}
        <button class="mgmt-retry-btn" @click="fetchUsers">ลองใหม่</button>
      </div>

      <!-- ── Content ─────────────────────────────────────────────────────── -->
      <template v-else>

        <!-- Summary bar -->
        <div class="mgmt-summary-bar">
          <div class="summary-title">ภาพรวมระบบ</div>
          <div class="summary-items">
            <div class="summary-item">
              <span class="summary-num">{{ stats.total }}</span>
              <span class="summary-sep-label">ผู้ใช้ลงทะเบียน</span>
            </div>
            <div class="summary-divider"></div>
            <div class="summary-item">
              <span class="summary-num active">{{ stats.active }}</span>
              <span class="summary-sep-label">License ใช้งานอยู่</span>
            </div>
            <div class="summary-divider"></div>
            <div class="summary-item">
              <span class="summary-num expired">{{ stats.expired }}</span>
              <span class="summary-sep-label">License หมดอายุ</span>
            </div>
            <div class="summary-divider"></div>
            <div class="summary-item">
              <span class="summary-num nolic">{{ stats.noLic }}</span>
              <span class="summary-sep-label">ไม่มี License</span>
            </div>
            <div class="summary-divider"></div>
            <div class="summary-item">
              <span class="summary-num project">{{ stats.totalProjects }}</span>
              <span class="summary-sep-label">โปรเจครวม</span>
            </div>
          </div>
          <!-- license ratio bar -->
          <div class="summary-ratio-wrap" :title="`ใช้งานได้ ${stats.active} / ${stats.total} คน`">
            <div
              class="summary-ratio-fill"
              :style="{ width: stats.total > 0 ? (stats.active / stats.total * 100) + '%' : '0%' }"
            ></div>
          </div>
        </div>

        <!-- Toolbar: search + filter + refresh -->
        <div class="mgmt-toolbar">
          <div class="mgmt-search-wrap">
            <svg class="mgmt-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              v-model="search"
              class="mgmt-search"
              placeholder="ค้นหา ชื่อ / อีเมล / License Key…"
              type="text"
            />
            <button v-if="search" class="mgmt-search-clear" @click="search = ''">×</button>
          </div>

          <div class="mgmt-filter-group">
            <button
              v-for="opt in [
                { val: 'all',     label: 'ทั้งหมด' },
                { val: 'active',  label: 'ใช้งานได้' },
                { val: 'expired', label: 'หมดอายุ' },
                { val: 'none',    label: 'ไม่มี License' },
              ]"
              :key="opt.val"
              class="mgmt-filter-btn"
              :class="{ active: filterStatus === opt.val }"
              @click="filterStatus = opt.val as any"
            >
              {{ opt.label }}
            </button>
          </div>

          <button class="mgmt-refresh-btn" :disabled="loading" @click="fetchUsers">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            รีเฟรช
          </button>
        </div>

        <!-- ── TABLE ─────────────────────────────────────────────────────── -->
        <div class="mgmt-table-wrap">
          <table class="mgmt-table">
            <thead>
              <tr>
                <th class="mgmt-th col-num">#</th>
                <th class="mgmt-th col-date sortable" @click="toggleSort('created_at')">
                  วันที่ลงทะเบียน
                  <span class="sort-arrow" :class="{ active: sortKey === 'created_at' }">
                    {{ sortKey === 'created_at' ? (sortDir === 'asc' ? '↑' : '↓') : '↕' }}
                  </span>
                </th>
                <th class="mgmt-th col-name sortable" @click="toggleSort('full_name')">
                  ชื่อ
                  <span class="sort-arrow" :class="{ active: sortKey === 'full_name' }">
                    {{ sortKey === 'full_name' ? (sortDir === 'asc' ? '↑' : '↓') : '↕' }}
                  </span>
                </th>
                <th class="mgmt-th col-email sortable" @click="toggleSort('email')">
                  อีเมล
                  <span class="sort-arrow" :class="{ active: sortKey === 'email' }">
                    {{ sortKey === 'email' ? (sortDir === 'asc' ? '↑' : '↓') : '↕' }}
                  </span>
                </th>
                <th class="mgmt-th col-proj sortable" @click="toggleSort('project_count')">
                  โปรเจค
                  <span class="sort-arrow" :class="{ active: sortKey === 'project_count' }">
                    {{ sortKey === 'project_count' ? (sortDir === 'asc' ? '↑' : '↓') : '↕' }}
                  </span>
                </th>
                <th class="mgmt-th col-key">License Key</th>
                <th class="mgmt-th col-label">ประเภท</th>
                <th class="mgmt-th col-expire sortable" @click="toggleSort('expires_at')">
                  วันหมดอายุ
                  <span class="sort-arrow" :class="{ active: sortKey === 'expires_at' }">
                    {{ sortKey === 'expires_at' ? (sortDir === 'asc' ? '↑' : '↓') : '↕' }}
                  </span>
                </th>
                <th class="mgmt-th col-status">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="filtered.length === 0">
                <td colspan="9" class="mgmt-empty">ไม่พบข้อมูลที่ตรงกับการค้นหา</td>
              </tr>
              <tr
                v-for="(u, idx) in filtered"
                :key="u.id"
                class="mgmt-row"
                :class="{ 'row-super': u.is_super_user }"
              >
                <!-- # -->
                <td class="mgmt-td col-num">
                  <span class="row-num">{{ idx + 1 }}</span>
                  <span v-if="u.is_super_user" class="super-dot" title="Super User">★</span>
                </td>

                <!-- วันที่ลงทะเบียน -->
                <td class="mgmt-td col-date">{{ fmtDate(u.created_at) }}</td>

                <!-- ชื่อ -->
                <td class="mgmt-td col-name">
                  <span class="user-name">{{ u.full_name || '—' }}</span>
                </td>

                <!-- อีเมล -->
                <td class="mgmt-td col-email">
                  <span class="user-email">{{ u.email }}</span>
                </td>

                <!-- โปรเจค -->
                <td class="mgmt-td col-proj">
                  <span class="proj-count" :class="{ 'proj-zero': u.project_count === 0 }">
                    {{ u.project_count }}
                  </span>
                </td>

                <!-- License Key -->
                <td class="mgmt-td col-key">
                  <code v-if="u.license_key" class="lic-key">{{ u.license_key }}</code>
                  <span v-else class="text-muted">—</span>
                </td>

                <!-- ประเภท License -->
                <td class="mgmt-td col-label">
                  <span v-if="u.license_label" class="lic-label">{{ u.license_label }}</span>
                  <span v-else class="text-muted">—</span>
                </td>

                <!-- วันหมดอายุ -->
                <td class="mgmt-td col-expire">
                  <template v-if="u.expires_at">
                    <div class="expire-date">{{ fmtDate(u.expires_at) }}</div>
                    <div
                      class="days-left"
                      :class="{
                        'days-ok':      (daysLeft(u.expires_at) ?? 0) > 30,
                        'days-warn':    (daysLeft(u.expires_at) ?? 0) > 0 && (daysLeft(u.expires_at) ?? 0) <= 30,
                        'days-expired': (daysLeft(u.expires_at) ?? 0) === 0,
                      }"
                    >
                      <template v-if="(daysLeft(u.expires_at) ?? 0) > 0">
                        เหลือ {{ daysLeft(u.expires_at) }} วัน
                      </template>
                      <template v-else>หมดอายุแล้ว</template>
                    </div>
                  </template>
                  <span v-else class="text-muted">—</span>
                </td>

                <!-- สถานะ + Gen License -->
                <td class="mgmt-td col-status">
                  <div class="status-cell">
                    <span
                      class="status-badge"
                      :class="{
                        'badge-active':  licenseStatus(u) === 'active',
                        'badge-expired': licenseStatus(u) === 'expired',
                        'badge-none':    licenseStatus(u) === 'none',
                      }"
                    >
                      <span class="badge-dot"></span>
                      {{
                        licenseStatus(u) === 'active'  ? 'ใช้งานได้' :
                        licenseStatus(u) === 'expired' ? 'หมดอายุ'   : 'ไม่มี License'
                      }}
                    </span>
                    <div class="lic-action-row">
                      <button
                        class="gen-lic-btn"
                        :class="{
                          'gen-lic-renew':  licenseStatus(u) === 'active',
                          'gen-lic-extend': licenseStatus(u) === 'expired',
                        }"
                        :title="licenseStatus(u) === 'active' ? 'ต่ออายุ / ออก License ใหม่' : licenseStatus(u) === 'expired' ? 'ต่ออายุ License' : 'สร้าง License ใหม่'"
                        @click="openGenModal(u)"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        {{
                          licenseStatus(u) === 'active'  ? 'ต่ออายุ' :
                          licenseStatus(u) === 'expired' ? 'ต่ออายุ' : 'Gen License'
                        }}
                      </button>
                      <button
                        v-if="licenseStatus(u) !== 'none'"
                        class="revoke-lic-btn"
                        title="ยกเลิก License"
                        @click="openRevokeConfirm(u)"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Footer info -->
        <div class="mgmt-footer">
          แสดง {{ filtered.length }} / {{ users.length }} ผู้ใช้
        </div>

      </template>
    </main>

    <!-- ══ REVOKE CONFIRM MODAL ══════════════════════════════════════════════ -->
    <Teleport to="body">
      <div v-if="showRevokeConfirm" class="modal-backdrop" @click.self="closeRevokeConfirm">
        <div class="modal-box revoke-box">
          <div class="revoke-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
          </div>
          <div class="revoke-title">ยืนยันยกเลิก License</div>
          <div class="revoke-desc">
            ต้องการยกเลิก License ของ<br>
            <strong>{{ revokeTarget?.full_name || revokeTarget?.email }}</strong> ใช่หรือไม่?<br>
            <span class="revoke-warn">ผู้ใช้จะไม่สามารถเข้าใช้งานได้ทันที</span>
          </div>
          <div v-if="revokeError" class="modal-error">{{ revokeError }}</div>
          <div class="revoke-footer">
            <button class="modal-cancel-btn" :disabled="revoking" @click="closeRevokeConfirm">ยกเลิก</button>
            <button class="revoke-confirm-btn" :disabled="revoking" @click="revokeLicense">
              <span v-if="revoking" class="modal-spinner" style="border-top-color:#fff"></span>
              <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              {{ revoking ? 'กำลังยกเลิก…' : 'ยืนยันยกเลิก' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ══ GEN LICENSE MODAL ══════════════════════════════════════════════════ -->
    <Teleport to="body">
      <div v-if="showGenModal" class="modal-backdrop" @click.self="closeGenModal">
        <div class="modal-box">

          <!-- Header -->
          <div class="modal-header">
            <div class="modal-header-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div>
              <div class="modal-title">
                {{ genTargetUser?.license_key ? 'ต่ออายุ License' : 'สร้าง License ใหม่' }}
              </div>
              <div class="modal-subtitle">{{ genTargetUser?.full_name || genTargetUser?.email }}</div>
            </div>
            <button class="modal-close" @click="closeGenModal">×</button>
          </div>

          <!-- Body: เลือกระยะเวลา -->
          <div v-if="!genResult" class="modal-body">
            <div class="modal-field-label">ระยะเวลา License</div>
            <div class="duration-grid">
              <button
                v-for="p in DURATION_PRESETS"
                :key="p.days"
                class="duration-btn"
                :class="{ selected: genDuration === p.days }"
                @click="genDuration = p.days"
              >
                {{ p.label }}
              </button>
            </div>

            <div class="custom-duration-wrap">
              <label class="modal-field-label">หรือกำหนดเอง (วัน)</label>
              <input
                v-model.number="genDuration"
                type="number"
                min="1"
                max="3650"
                class="custom-duration-input"
                placeholder="จำนวนวัน"
              />
            </div>

            <div class="modal-user-info">
              <span class="info-row">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
                {{ genTargetUser?.email }}
              </span>
              <span class="info-row">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                หมดอายุ {{ fmtDate(new Date(Date.now() + genDuration * 86400000).toISOString()) }}
              </span>
            </div>

            <div v-if="genError" class="modal-error">{{ genError }}</div>

            <div class="modal-footer-btns">
              <button class="modal-cancel-btn" @click="closeGenModal">ยกเลิก</button>
              <button
                class="modal-confirm-btn"
                :disabled="genGenerating || genDuration < 1"
                @click="generateLicense"
              >
                <span v-if="genGenerating" class="modal-spinner"></span>
                <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                {{ genGenerating ? 'กำลังสร้าง…' : 'สร้าง License' }}
              </button>
            </div>
          </div>

          <!-- Body: ผลลัพธ์ -->
          <div v-else class="modal-body modal-result">
            <div class="result-check">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <div class="result-title">สร้าง License สำเร็จ</div>
            <div class="result-subtitle">{{ genResult.label }} · หมดอายุ {{ fmtDate(genResult.expires_at) }}</div>

            <div class="result-key-wrap">
              <code class="result-key">{{ genResult.key }}</code>
              <button class="copy-btn" title="คัดลอก" @click="copyKey(genResult.key)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </button>
            </div>

            <button class="modal-done-btn" @click="closeGenModal">เสร็จสิ้น</button>
          </div>

        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ══ Layout ══════════════════════════════════════════════════════════════════ */
.mgmt-app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: #f0f4f8;
  color: #1a202c;
  font-family: "Noto Sans Thai", system-ui, sans-serif;
  font-size: 13px;
}

/* ══ Header ══════════════════════════════════════════════════════════════════ */
.mgmt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  height: 48px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
  user-select: none;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}

.mgmt-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mgmt-brand {
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
}

.mgmt-divider {
  color: #cbd5e1;
  font-size: 16px;
}

.mgmt-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
}

.mgmt-super-badge {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 10px;
  letter-spacing: 0.05em;
}

.mgmt-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mgmt-back-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #475569;
  font-size: 12px;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s;
}
.mgmt-back-btn:hover {
  background: #eff6ff;
  color: #2563eb;
  border-color: #93c5fd;
}

.mgmt-logout-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  background: #fff5f5;
  border: 1px solid #fecaca;
  border-radius: 6px;
  color: #dc2626;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.mgmt-logout-btn:hover {
  background: #fee2e2;
  color: #991b1b;
}

/* ══ Main ════════════════════════════════════════════════════════════════════ */
.mgmt-main {
  flex: 1;
  padding: 24px 28px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ══ Loading / Error ══════════════════════════════════════════════════════════ */
.mgmt-loading,
.mgmt-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 80px;
  color: #94a3b8;
  font-size: 14px;
}

.mgmt-error {
  color: #ef4444;
  flex-direction: column;
}

.mgmt-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #e2e8f0;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.mgmt-retry-btn {
  margin-top: 8px;
  padding: 6px 16px;
  background: #eff6ff;
  border: 1px solid #3b82f6;
  border-radius: 6px;
  color: #2563eb;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}
.mgmt-retry-btn:hover { background: #dbeafe; }

/* ══ Summary Bar ══════════════════════════════════════════════════════════════ */
.mgmt-summary-bar {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 14px 20px 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.summary-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #94a3b8;
}

.summary-items {
  display: flex;
  align-items: center;
  gap: 0;
  flex-wrap: wrap;
}

.summary-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 0 24px 0 0;
  gap: 1px;
}

.summary-num {
  font-size: 32px;
  font-weight: 800;
  line-height: 1;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.summary-num.active  { color: #16a34a; }
.summary-num.expired { color: #dc2626; }
.summary-num.nolic   { color: #94a3b8; }
.summary-num.project { color: #2563eb; }

.summary-sep-label {
  font-size: 11px;
  color: #94a3b8;
  white-space: nowrap;
}

.summary-divider {
  width: 1px;
  height: 36px;
  background: #e2e8f0;
  margin: 0 24px 0 0;
  flex-shrink: 0;
}

/* License ratio bar */
.summary-ratio-wrap {
  height: 3px;
  background: #f1f5f9;
  border-radius: 2px;
  overflow: hidden;
  cursor: default;
}

.summary-ratio-fill {
  height: 100%;
  background: linear-gradient(90deg, #16a34a, #4ade80);
  border-radius: 2px;
  transition: width 0.6s ease;
}

/* ══ Toolbar ══════════════════════════════════════════════════════════════════ */
.mgmt-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.mgmt-search-wrap {
  position: relative;
  flex: 1;
  min-width: 200px;
  max-width: 360px;
}

.mgmt-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: #94a3b8;
  pointer-events: none;
}

.mgmt-search {
  width: 100%;
  padding: 7px 28px 7px 32px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #1e293b;
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.mgmt-search:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
}
.mgmt-search::placeholder { color: #94a3b8; }

.mgmt-search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0;
}
.mgmt-search-clear:hover { color: #475569; }

.mgmt-filter-group {
  display: flex;
  gap: 4px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 3px;
}

.mgmt-filter-btn {
  padding: 4px 12px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #64748b;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.mgmt-filter-btn:hover { color: #1e293b; background: #f1f5f9; }
.mgmt-filter-btn.active { background: #eff6ff; color: #2563eb; font-weight: 600; }

.mgmt-refresh-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #475569;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.mgmt-refresh-btn:hover:not(:disabled) {
  background: #f8fafc;
  color: #1e293b;
  border-color: #3b82f6;
}
.mgmt-refresh-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ══ Table ════════════════════════════════════════════════════════════════════ */
.mgmt-table-wrap {
  overflow-x: auto;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}

.mgmt-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 900px;
}

.mgmt-th {
  padding: 11px 14px;
  background: #f8fafc;
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
  text-align: left;
}

.mgmt-th.sortable {
  cursor: pointer;
  user-select: none;
  transition: color 0.15s;
}
.mgmt-th.sortable:hover { color: #1e293b; }

.sort-arrow {
  margin-left: 4px;
  opacity: 0.35;
  font-size: 11px;
}
.sort-arrow.active { opacity: 1; color: #2563eb; }

/* Column widths */
.col-num    { width: 48px; text-align: center; }
.col-date   { width: 130px; }
.col-name   { width: 140px; }
.col-email  { min-width: 180px; }
.col-proj   { width: 80px; text-align: center; }
.col-key    { width: 190px; }
.col-label  { width: 100px; }
.col-expire { width: 150px; }
.col-status { width: 120px; }

.mgmt-td {
  padding: 11px 14px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}

.mgmt-row:hover .mgmt-td { background: #f8fafc; }
.mgmt-row:last-child .mgmt-td { border-bottom: none; }

.mgmt-row.row-super .mgmt-td:first-child {
  border-left: 3px solid #f59e0b;
}

.mgmt-empty {
  text-align: center;
  padding: 48px;
  color: #94a3b8;
  font-size: 13px;
}

/* ── Cell content ──────────────────────────────────────────────────────────── */
.row-num {
  color: #94a3b8;
  font-size: 11px;
  display: block;
  text-align: center;
}

.super-dot {
  color: #f59e0b;
  font-size: 10px;
  display: block;
  text-align: center;
  line-height: 1;
}

.user-name {
  font-weight: 600;
  color: #0f172a;
}

.user-email {
  color: #64748b;
  font-size: 12px;
}

.proj-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  background: #eff6ff;
  border-radius: 13px;
  font-size: 12px;
  font-weight: 700;
  color: #2563eb;
}
.proj-count.proj-zero {
  background: #f1f5f9;
  color: #94a3b8;
}

.lic-key {
  display: block;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 11px;
  color: #1d4ed8;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 4px;
  padding: 3px 7px;
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.lic-label {
  display: inline-block;
  background: #f0fdf4;
  color: #15803d;
  border: 1px solid #bbf7d0;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
}

.expire-date {
  font-size: 12px;
  color: #334155;
}

.days-left {
  font-size: 11px;
  margin-top: 2px;
}
.days-ok      { color: #16a34a; }
.days-warn    { color: #d97706; }
.days-expired { color: #dc2626; }

.text-muted { color: #94a3b8; }

/* Status badge */
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.badge-active  { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
.badge-active  .badge-dot { background: #16a34a; }

.badge-expired { background: #fff5f5; color: #dc2626; border: 1px solid #fecaca; }
.badge-expired .badge-dot { background: #ef4444; animation: pulse-dot 1.5s ease-in-out infinite; }

.badge-none    { background: #f8fafc; color: #64748b; border: 1px solid #e2e8f0; }
.badge-none    .badge-dot { background: #94a3b8; }

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}

/* ══ Footer ══════════════════════════════════════════════════════════════════ */
.mgmt-footer {
  font-size: 11px;
  color: #94a3b8;
  text-align: right;
  padding: 4px 0;
}

/* ══ Status cell + Gen button ════════════════════════════════════════════════ */
.status-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
}

.gen-lic-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid #bfdbfe;
  background: #eff6ff;
  color: #2563eb;
  white-space: nowrap;
}
.gen-lic-btn:hover { background: #dbeafe; border-color: #93c5fd; }

/* ใช้งานอยู่ → สีเขียวอ่อน */
.gen-lic-btn.gen-lic-renew {
  background: #f0fdf4;
  border-color: #bbf7d0;
  color: #16a34a;
}
.gen-lic-btn.gen-lic-renew:hover { background: #dcfce7; border-color: #86efac; }

/* หมดอายุ → สีแดงอ่อน */
.gen-lic-btn.gen-lic-extend {
  background: #fff5f5;
  border-color: #fecaca;
  color: #dc2626;
}
.gen-lic-btn.gen-lic-extend:hover { background: #fee2e2; border-color: #fca5a5; }

/* ── License action row ───────────────────────────────────────────────────── */
.lic-action-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.revoke-lic-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid #fecaca;
  background: #fff5f5;
  color: #dc2626;
  white-space: nowrap;
}
.revoke-lic-btn:hover { background: #fee2e2; border-color: #fca5a5; }

/* ══ Revoke Modal ════════════════════════════════════════════════════════════ */
.revoke-box {
  width: 360px;
  padding: 0;
}

.revoke-icon {
  margin: 28px auto 12px;
  width: 52px;
  height: 52px;
  background: #fff5f5;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #dc2626;
}

.revoke-title {
  text-align: center;
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 8px;
}

.revoke-desc {
  text-align: center;
  font-size: 13px;
  color: #475569;
  line-height: 1.7;
  padding: 0 24px;
}

.revoke-warn {
  font-size: 11px;
  color: #dc2626;
}

.revoke-footer {
  display: flex;
  gap: 8px;
  justify-content: center;
  padding: 20px 24px 24px;
}

.revoke-confirm-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  background: #dc2626;
  border: none;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
  cursor: pointer;
  transition: background 0.15s;
}
.revoke-confirm-btn:hover:not(:disabled) { background: #b91c1c; }
.revoke-confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ══ Modal ═══════════════════════════════════════════════════════════════════ */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.modal-box {
  background: #ffffff;
  border-radius: 14px;
  width: 420px;
  max-width: 95vw;
  box-shadow: 0 20px 60px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.08);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid #f1f5f9;
}

.modal-header-icon {
  width: 36px;
  height: 36px;
  background: #eff6ff;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #2563eb;
  flex-shrink: 0;
}

.modal-title {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
}

.modal-subtitle {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 1px;
}

.modal-close {
  margin-left: auto;
  background: none;
  border: none;
  font-size: 20px;
  color: #94a3b8;
  cursor: pointer;
  line-height: 1;
  padding: 0 2px;
  transition: color 0.15s;
}
.modal-close:hover { color: #475569; }

.modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.modal-field-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #64748b;
  margin-bottom: 6px;
}

.duration-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}

.duration-btn {
  padding: 7px 4px;
  background: #f8fafc;
  border: 1.5px solid #e2e8f0;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
}
.duration-btn:hover {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #2563eb;
}
.duration-btn.selected {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
}

.custom-duration-wrap {
  display: flex;
  flex-direction: column;
}

.custom-duration-input {
  padding: 7px 10px;
  border: 1.5px solid #e2e8f0;
  border-radius: 7px;
  font-size: 13px;
  color: #0f172a;
  outline: none;
  transition: border-color 0.15s;
  width: 120px;
}
.custom-duration-input:focus { border-color: #3b82f6; }

.modal-user-info {
  background: #f8fafc;
  border-radius: 8px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #475569;
}

.modal-error {
  background: #fff5f5;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
  color: #dc2626;
}

.modal-footer-btns {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding-top: 4px;
}

.modal-cancel-btn {
  padding: 8px 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  font-size: 13px;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s;
}
.modal-cancel-btn:hover { background: #f1f5f9; }

.modal-confirm-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  background: #2563eb;
  border: none;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
  cursor: pointer;
  transition: all 0.15s;
}
.modal-confirm-btn:hover:not(:disabled) { background: #1d4ed8; }
.modal-confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.modal-spinner {
  width: 13px;
  height: 13px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

/* Result */
.modal-result {
  align-items: center;
  text-align: center;
  padding: 28px 24px;
}

.result-check {
  width: 52px;
  height: 52px;
  background: #f0fdf4;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #16a34a;
}

.result-title {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}

.result-subtitle {
  font-size: 12px;
  color: #64748b;
  margin-top: -8px;
}

.result-key-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #f0fdf4;
  border: 1.5px solid #bbf7d0;
  border-radius: 8px;
  padding: 10px 14px;
  width: 100%;
}

.result-key {
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 14px;
  font-weight: 700;
  color: #15803d;
  letter-spacing: 0.05em;
  flex: 1;
}

.copy-btn {
  background: #dcfce7;
  border: 1px solid #86efac;
  border-radius: 5px;
  padding: 4px 7px;
  color: #16a34a;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
}
.copy-btn:hover { background: #bbf7d0; }

.modal-done-btn {
  padding: 9px 28px;
  background: #16a34a;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
  cursor: pointer;
  transition: background 0.15s;
  margin-top: 4px;
}
.modal-done-btn:hover { background: #15803d; }
</style>
