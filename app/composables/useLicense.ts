// composables/useLicense.ts
//
// ระบบตรวจสอบ License แบบ 3 ชั้น — เข้มงวด 1 Key = 1 User เท่านั้น
//
//  ชั้น 1 — DB constraint : UNIQUE (license_key_id) ใน user_licenses
//  ชั้น 2 — Server (app)  : ตรวจ bound_user_id + bound_email ใน license_keys
//  ชั้น 3 — Browser       : ตรวจ localStorage ว่า email ตรงกับที่ activate ไว้

const STORAGE_KEY = "bimv_bound_email"

export const useLicense = () => {
  const { $supabase } = useNuxtApp() as any

  const license = useState<{
    isValid: boolean
    expiresAt: string | null
    label: string | null
    daysLeft: number | null
    reason?: "expired" | "not_found" | "email_mismatch"
  } | null>("user_license", () => null)

  // ─── Browser helpers ──────────────────────────────────────────────────────
  function getBoundEmail(): string | null {
    if (!import.meta.client) return null
    return localStorage.getItem(STORAGE_KEY)
  }
  function setBoundEmail(email: string) {
    if (!import.meta.client) return
    localStorage.setItem(STORAGE_KEY, email)
  }
  function clearBoundEmail() {
    if (!import.meta.client) return
    localStorage.removeItem(STORAGE_KEY)
  }

  // ─── checkLicense ─────────────────────────────────────────────────────────
  const checkLicense = async (): Promise<{
    isValid: boolean
    expiresAt: string | null
    label: string | null
    daysLeft: number | null
    reason?: "expired" | "not_found" | "email_mismatch"
  } | null> => {
    const { data: sessionData } = await $supabase.auth.getSession()
    if (!sessionData?.session?.user) return null

    const currentEmail = sessionData.session.user.email as string
    const userId       = sessionData.session.user.id

    // ── ชั้น 3: Browser check ─────────────────────────────────────────────
    const storedEmail = getBoundEmail()
    if (storedEmail && storedEmail.toLowerCase() !== currentEmail.toLowerCase()) {
      clearBoundEmail()
      await $supabase.auth.signOut()
      license.value = { isValid: false, expiresAt: null, label: null, daysLeft: null, reason: "email_mismatch" }
      return license.value
    }

    // ── ชั้น 1+2: Server check ────────────────────────────────────────────
    const { data, error } = await $supabase
      .from("user_licenses")
      .select("expires_at, activated_at, license_keys(label, bound_user_id, bound_email)")
      .eq("user_id", userId)
      .maybeSingle()

    if (error || !data) {
      license.value = { isValid: false, expiresAt: null, label: null, daysLeft: null, reason: "not_found" }
      return license.value
    }

    // ตรวจ bound_user_id และ bound_email ว่าตรงกับ session ปัจจุบัน
    const dbBoundUserId: string | null = data.license_keys?.bound_user_id ?? null
    const dbBoundEmail:  string | null = data.license_keys?.bound_email  ?? null

    const userMismatch  = dbBoundUserId && dbBoundUserId !== userId
    const emailMismatch = dbBoundEmail  && dbBoundEmail.toLowerCase() !== currentEmail.toLowerCase()

    if (userMismatch || emailMismatch) {
      clearBoundEmail()
      await $supabase.auth.signOut()
      license.value = { isValid: false, expiresAt: null, label: null, daysLeft: null, reason: "email_mismatch" }
      return license.value
    }

    const now       = new Date()
    const expiresAt = new Date(data.expires_at)
    const isValid   = expiresAt > now
    const daysLeft  = isValid
      ? Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : 0

    if (isValid) setBoundEmail(currentEmail)

    license.value = {
      isValid,
      expiresAt: data.expires_at,
      label:     data.license_keys?.label ?? null,
      daysLeft,
      reason:    isValid ? undefined : "expired",
    }
    return license.value
  }

  // ─── activateLicense ──────────────────────────────────────────────────────
  //
  // กฎ 1 Key = 1 User:
  //  - ถ้า bound_user_id ≠ null และ ≠ userId ปัจจุบัน → ปฏิเสธทันที
  //  - ถ้า bound_email ≠ null และ ≠ email ปัจจุบัน → ปฏิเสธทันที
  //  - ถ้าผ่านทั้งคู่ → activate และ lock key ด้วย userId + email นี้
  //
  const activateLicense = async (key: string): Promise<{
    success: boolean
    message: string
    expiresAt?: string
    label?: string
  }> => {
    const { data: sessionData } = await $supabase.auth.getSession()
    if (!sessionData?.session?.user) {
      return { success: false, message: "กรุณาเข้าสู่ระบบก่อน" }
    }
    const userId       = sessionData.session.user.id
    const currentEmail = (sessionData.session.user.email as string).toLowerCase()
    const rawEmail     = sessionData.session.user.email as string

    // ค้นหา key
    const { data: keyRow, error: keyErr } = await $supabase
      .from("license_keys")
      .select("id, label, duration_days, is_active, bound_user_id, bound_email")
      .eq("key", key.trim().toUpperCase())
      .maybeSingle()

    if (keyErr || !keyRow) {
      return { success: false, message: "ไม่พบ License Key นี้ในระบบ" }
    }
    if (!keyRow.is_active) {
      return { success: false, message: "License Key นี้ถูกปิดใช้งานแล้ว" }
    }

    // ── ตรวจ 1 Key = 1 User (ชั้น 2) ─────────────────────────────────────
    if (keyRow.bound_user_id && keyRow.bound_user_id !== userId) {
      return {
        success: false,
        message: "License Key นี้ถูกใช้งานโดยบัญชีอื่นแล้ว ไม่สามารถใช้ร่วมกันได้",
      }
    }
    if (keyRow.bound_email && keyRow.bound_email.toLowerCase() !== currentEmail) {
      return {
        success: false,
        message: "License Key นี้ถูกผูกกับอีเมลอื่นแล้ว ไม่สามารถใช้กับอีเมลนี้ได้",
      }
    }

    // คำนวณวันหมดอายุ
    const now       = new Date()
    const expiresAt = new Date(now.getTime() + keyRow.duration_days * 24 * 60 * 60 * 1000)

    // upsert user_licenses — onConflict user_id (re-activate ได้เฉพาะ user เดิม)
    const { error: upsertErr } = await $supabase
      .from("user_licenses")
      .upsert(
        {
          user_id:        userId,
          license_key_id: keyRow.id,
          activated_at:   now.toISOString(),
          expires_at:     expiresAt.toISOString(),
        },
        { onConflict: "user_id" }
      )

    if (upsertErr) {
      // กรณี DB UNIQUE constraint บน license_key_id ถูก violated (ชั้น 1)
      if (upsertErr.code === "23505") {
        return { success: false, message: "License Key นี้ถูกใช้งานโดยบัญชีอื่นแล้ว ไม่สามารถใช้ร่วมกันได้" }
      }
      return { success: false, message: "เกิดข้อผิดพลาดในการบันทึก: " + upsertErr.message }
    }

    // Lock key: บันทึก bound_user_id + bound_email ถาวร (เฉพาะครั้งแรก)
    if (!keyRow.bound_user_id) {
      await $supabase
        .from("license_keys")
        .update({ bound_user_id: userId, bound_email: rawEmail })
        .eq("id", keyRow.id)
    }

    // บันทึก email ลง localStorage (ชั้น 3)
    setBoundEmail(currentEmail)

    const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    license.value = {
      isValid:   true,
      expiresAt: expiresAt.toISOString(),
      label:     keyRow.label,
      daysLeft,
    }

    return {
      success:   true,
      message:   "เปิดใช้งาน License สำเร็จ",
      expiresAt: expiresAt.toISOString(),
      label:     keyRow.label,
    }
  }

  return { license, checkLicense, activateLicense }
}
