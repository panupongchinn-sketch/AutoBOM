// server/api/admin/users.get.ts
//
// Admin endpoint: ดึงข้อมูลผู้ใช้ทั้งหมดสำหรับหน้า Management
// เข้าถึงได้เฉพาะ super user เท่านั้น
// ใช้ SUPABASE_SERVICE_KEY (service_role) เพื่อ query auth.users

import { createClient } from "@supabase/supabase-js"

export interface AdminUser {
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

export default defineEventHandler(async (event): Promise<AdminUser[]> => {
  const config = useRuntimeConfig()

  if (!config.supabaseServiceKey) {
    throw createError({ statusCode: 500, message: "SUPABASE_SERVICE_KEY ยังไม่ได้ตั้งค่าในไฟล์ .env" })
  }

  // ── ตรวจ Authorization header ──────────────────────────────────────────────
  const authHeader = getHeader(event, "authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    throw createError({ statusCode: 401, message: "Unauthorized: ไม่พบ token" })
  }
  const userToken = authHeader.slice(7)

  // ── สร้าง admin client ด้วย service_role ──────────────────────────────────
  const adminClient = createClient(
    config.public.SUPABASE_URL as string,
    config.supabaseServiceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // ── ตรวจ token ของผู้เรียก ────────────────────────────────────────────────
  const { data: { user: requester }, error: authError } = await adminClient.auth.getUser(userToken)
  if (authError || !requester) {
    throw createError({ statusCode: 401, message: "Unauthorized: token ไม่ถูกต้อง" })
  }

  // ── ตรวจว่าผู้เรียกเป็น super user ────────────────────────────────────────
  const { data: superRecord } = await adminClient
    .from("super_users")
    .select("user_id")
    .eq("user_id", requester.id)
    .maybeSingle()

  if (!superRecord) {
    throw createError({ statusCode: 403, message: "Forbidden: ไม่มีสิทธิ์เข้าถึงข้อมูลนี้" })
  }

  // ── ดึงข้อมูลผู้ใช้ทั้งหมดจาก auth.users ─────────────────────────────────
  const { data: { users }, error: usersError } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
  if (usersError) {
    throw createError({ statusCode: 500, message: "ไม่สามารถดึงข้อมูลผู้ใช้ได้: " + usersError.message })
  }

  // ── ดึงจำนวน project แต่ละ user ──────────────────────────────────────────
  const { data: projects } = await adminClient
    .from("bim_projects")
    .select("user_id")

  const projectCountMap = new Map<string, number>()
  for (const p of (projects || [])) {
    projectCountMap.set(p.user_id, (projectCountMap.get(p.user_id) || 0) + 1)
  }

  // ── ดึง license ของแต่ละ user ─────────────────────────────────────────────
  const { data: licenses } = await adminClient
    .from("user_licenses")
    .select("user_id, expires_at, license_keys(key, label)")

  const licenseMap = new Map<string, { key: string; label: string; expires_at: string }>()
  for (const l of (licenses || [])) {
    licenseMap.set(l.user_id, {
      key:       (l.license_keys as any)?.key       ?? null,
      label:     (l.license_keys as any)?.label     ?? null,
      expires_at: l.expires_at ?? null,
    })
  }

  // ── ดึง super_users list ──────────────────────────────────────────────────
  const { data: superUsers } = await adminClient
    .from("super_users")
    .select("user_id")

  const superUserSet = new Set((superUsers || []).map((s: any) => s.user_id))

  // ── รวมข้อมูลและส่งกลับ ───────────────────────────────────────────────────
  return users.map((u): AdminUser => {
    const lic = licenseMap.get(u.id)
    return {
      id:            u.id,
      email:         u.email ?? "",
      full_name:     u.user_metadata?.full_name ?? "",
      created_at:    u.created_at,
      project_count: projectCountMap.get(u.id) ?? 0,
      license_key:   lic?.key   ?? null,
      license_label: lic?.label ?? null,
      expires_at:    lic?.expires_at ?? null,
      is_super_user: superUserSet.has(u.id),
    }
  })
})
