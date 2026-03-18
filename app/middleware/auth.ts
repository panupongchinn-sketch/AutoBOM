// middleware/auth.ts
//
// ✅ รันฝั่ง client เท่านั้น
//    ฝั่ง server ไม่มี sessionStorage → ข้ามไปก่อน แล้วให้ client re-check เอง
//    ป้องกัน redirect login ทุกครั้งที่รีเฟรชหน้า

export default defineNuxtRouteMiddleware(async (to) => {
  // ── ฝั่ง server: ข้ามไปทั้งหมด session อยู่ใน sessionStorage (client-only) ──
  if (import.meta.server) return

  // ── หน้าสาธารณะ: ไม่ต้อง check ──
  if (to.path === "/login" || to.path === "/activate") return

  // ── ตรวจ session ──
  const auth = useAuth()
  const { session } = await auth.getSession()
  if (!session) return navigateTo("/login")

  // ── ตรวจ license ──
  const { checkLicense } = useLicense()
  const lic = await checkLicense()
  if (!lic) return navigateTo("/login")

  if (!lic.isValid) {
    if (lic.reason === "email_mismatch") return navigateTo("/login?reason=email_mismatch")
    return navigateTo("/activate")
  }

  // ── หน้า /management: เฉพาะ super user เท่านั้น ──
  if (to.path === "/management") {
    const { checkSuperUser } = useSuperUser()
    const isSuper = await checkSuperUser()
    if (!isSuper) return navigateTo("/")
  }
})
