// composables/useProject.ts
//
// ทุก operation ตรวจสอบ user_id 2 ชั้น:
//  ชั้น 1 — App layer : ใส่ .eq("user_id", uid) ในทุก query
//  ชั้น 2 — DB layer  : RLS policy "Users manage own projects" (auth.uid() = user_id)

export interface BimProject {
  id: string
  userId: string      // เก็บไว้ตรวจ ownership ฝั่ง app
  name: string
  modelName: string
  storagePath: string
  fileSize: number
  createdAt: string
}

export const useProject = () => {
  const { $supabase } = useNuxtApp() as any
  const auth = useAuth()

  const projects      = useState<BimProject[]>("bim_projects",  () => [])
  const currentProject = useState<BimProject | null>("current_project", () => null)
  const uploading     = ref(false)
  const uploadProgress = ref(0)
  const error         = ref<string | null>(null)

  // ── helper: ดึง uid ปัจจุบัน หรือ throw ──────────────────────────────────
  function requireUid(): string {
    const uid = auth.user.value?.id
    if (!uid) throw new Error("ไม่ได้เข้าสู่ระบบ")
    return uid
  }

  // ── โหลดรายการโปรเจกต์เฉพาะของ user ปัจจุบันเท่านั้น ────────────────────
  async function loadProjects() {
    const uid = auth.user.value?.id
    if (!uid) return

    const { data, error: err } = await $supabase
      .from("bim_projects")
      .select("*")
      .eq("user_id", uid)                          // app-layer filter
      .order("created_at", { ascending: false })

    if (err) { error.value = err.message; return }
    projects.value = (data ?? []).map(mapRow)
  }

  // ── อัปโหลดไฟล์โมเดล + สร้าง project record ──────────────────────────────
  async function uploadModel(file: File, customName?: string): Promise<BimProject | null> {
    const uid = requireUid()
    uploading.value = true
    uploadProgress.value = 0
    error.value = null

    try {
      // path ขึ้นต้นด้วย uid เสมอ — storage RLS บังคับด้วย
      const storagePath = `${uid}/${Date.now()}_${file.name}`

      const { error: upErr } = await $supabase.storage
        .from("bim-models")
        .upload(storagePath, file, { upsert: false })

      if (upErr) { error.value = upErr.message; return null }
      uploadProgress.value = 80

      const { data, error: dbErr } = await $supabase
        .from("bim_projects")
        .insert({
          user_id:      uid,
          name:         customName?.trim() || file.name.replace(/\.[^.]+$/, ""),
          model_name:   file.name,
          storage_path: storagePath,
          file_size:    file.size,
        })
        .select()
        .single()

      if (dbErr) { error.value = dbErr.message; return null }
      uploadProgress.value = 100

      const proj = mapRow(data)
      projects.value.unshift(proj)
      currentProject.value = proj
      return proj

    } finally {
      uploading.value = false
    }
  }

  // ── ดาวน์โหลดไฟล์โมเดล — ตรวจ ownership ก่อนเสมอ ───────────────────────
  async function downloadModel(proj: BimProject): Promise<ArrayBuffer | null> {
    const uid = requireUid()

    // ตรวจ ownership: storagePath ต้องขึ้นต้นด้วย uid ของตัวเอง
    if (!proj.storagePath.startsWith(`${uid}/`)) {
      error.value = "ไม่มีสิทธิ์เข้าถึงโปรเจกต์นี้"
      return null
    }
    // ตรวจ userId ใน record
    if (proj.userId && proj.userId !== uid) {
      error.value = "ไม่มีสิทธิ์เข้าถึงโปรเจกต์นี้"
      return null
    }

    // ── ดาวน์โหลดผ่าน server proxy (หลีกเลี่ยง CORS preflight) ───────────────
    const { data: sessionData } = await $supabase.auth.getSession()
    const jwt = sessionData?.session?.access_token
    if (!jwt) {
      error.value = "ไม่ได้เข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่"
      return null
    }

    let response: Response
    try {
      response = await fetch(
        `/api/storage/download?path=${encodeURIComponent(proj.storagePath)}`,
        { headers: { Authorization: `Bearer ${jwt}` } }
      )
    } catch (netErr: any) {
      error.value = `เชื่อมต่อ server ไม่ได้: ${netErr?.message || "Network error"}`
      throw netErr
    }

    if (!response.ok) {
      const text = await response.text().catch(() => `HTTP ${response.status}`)
      error.value = `ดาวน์โหลดไม่ได้: ${text}`
      return null
    }

    return await response.arrayBuffer()
  }

  // ── ลบโปรเจกต์ — ตรวจ ownership ชัดเจนทั้ง app + DB ────────────────────
  async function deleteProject(id: string) {
    const uid = requireUid()

    const proj = projects.value.find(p => p.id === id)

    // ตรวจ ownership ฝั่ง app ก่อนลบ
    if (proj) {
      if (proj.userId && proj.userId !== uid) {
        error.value = "ไม่มีสิทธิ์ลบโปรเจกต์นี้"
        return
      }
      // ลบไฟล์จาก storage (path ขึ้นต้นด้วย uid เสมอ)
      if (proj.storagePath.startsWith(`${uid}/`)) {
        await $supabase.storage.from("bim-models").remove([proj.storagePath])
      }
    }

    // ลบ record — DB RLS กรอง user_id อีกชั้น, app เพิ่ม .eq("user_id") ซ้อน
    await $supabase
      .from("bim_projects")
      .delete()
      .eq("id", id)
      .eq("user_id", uid)                          // app-layer lock

    projects.value = projects.value.filter(p => p.id !== id)
    if (currentProject.value?.id === id) currentProject.value = null
  }

  function mapRow(r: any): BimProject {
    return {
      id:          r.id,
      userId:      r.user_id,
      name:        r.name,
      modelName:   r.model_name,
      storagePath: r.storage_path,
      fileSize:    r.file_size,
      createdAt:   r.created_at,
    }
  }

  return {
    projects,
    currentProject,
    uploading,
    uploadProgress,
    error,
    loadProjects,
    uploadModel,
    downloadModel,
    deleteProject,
  }
}
