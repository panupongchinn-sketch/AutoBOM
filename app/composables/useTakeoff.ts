// composables/useTakeoff.ts
//
// ทุก DB operation ใส่ .eq("user_id", uid) ชัดเจน
// ซ้อนกับ RLS policy "Users manage own takeoff" (auth.uid() = user_id)

export interface TakeoffItem {
  id: string           // "local-N" ก่อนบันทึก, uuid หลังบันทึก
  projectId: string    // "" ก่อนบันทึก, uuid หลังบันทึก
  name: string
  category: string
  qty: number
  unit: string
  unitPrice: number
  dimsLabel: string
  createdAt: string
}

let localSeed = 1

export const useTakeoff = () => {
  const { $supabase } = useNuxtApp() as any
  const auth = useAuth()

  const items   = useState<TakeoffItem[]>("takeoff_items", () => [])
  const loading = ref(false)
  const error   = ref<string | null>(null)

  function requireUid(): string | null {
    return auth.user.value?.id ?? null
  }

  // ─── Local operations (ไม่แตะ DB) ──────────────────────────────────────────
  function addLocal(payload: Omit<TakeoffItem, "id" | "projectId" | "createdAt">) {
    items.value.push({
      id: `local-${localSeed++}`,
      projectId: "",
      createdAt: new Date().toISOString(),
      ...payload,
    })
  }

  function removeLocal(id: string) {
    items.value = items.value.filter(x => x.id !== id)
  }

  function clearLocal() {
    items.value = []
  }

  // ─── DB operations ──────────────────────────────────────────────────────────

  /** บันทึก items ทั้งหมดลง DB — ใส่ user_id ทุก row */
  async function saveAllToDB(projectId: string): Promise<boolean> {
    const uid = requireUid()
    if (!uid || items.value.length === 0) return true

    const rows = items.value.map(item => ({
      user_id:    uid,
      project_id: projectId,
      name:       item.name,
      category:   item.category,
      qty:        item.qty,
      unit:       item.unit,
      unit_price: item.unitPrice,
      dims_label: item.dimsLabel,
    }))

    const { data, error: err } = await $supabase
      .from("takeoff_items")
      .insert(rows)
      .select()

    if (err) { error.value = err.message; return false }

    items.value = (data ?? []).map(mapRow)
    return true
  }

  /** โหลด items จาก DB — กรอง user_id + project_id ทั้งคู่ */
  async function loadFromDB(projectId: string) {
    const uid = requireUid()
    if (!uid) return

    loading.value = true
    error.value = null

    const { data, error: err } = await $supabase
      .from("takeoff_items")
      .select("*")
      .eq("project_id", projectId)
      .eq("user_id", uid)                          // app-layer ownership check
      .order("created_at", { ascending: true })

    if (err) { error.value = err.message }
    else { items.value = (data ?? []).map(mapRow) }
    loading.value = false
  }

  /** ลบ item — ตรวจ user_id ชัดเจน */
  async function removeFromDB(id: string) {
    const uid = requireUid()
    if (!uid) return

    const { error: err } = await $supabase
      .from("takeoff_items")
      .delete()
      .eq("id", id)
      .eq("user_id", uid)                          // app-layer ownership check

    if (err) { error.value = err.message; return }
    items.value = items.value.filter(x => x.id !== id)
  }

  /** ลบทั้งหมดของ project — ตรวจ user_id ชัดเจน */
  async function clearFromDB(projectId: string) {
    const uid = requireUid()
    if (!uid) return

    const { error: err } = await $supabase
      .from("takeoff_items")
      .delete()
      .eq("project_id", projectId)
      .eq("user_id", uid)                          // app-layer ownership check

    if (err) { error.value = err.message; return }
    items.value = []
  }

  function mapRow(r: any): TakeoffItem {
    return {
      id:        r.id,
      projectId: r.project_id,
      name:      r.name,
      category:  r.category,
      qty:       Number(r.qty),
      unit:      r.unit,
      unitPrice: Number(r.unit_price),
      dimsLabel: r.dims_label,
      createdAt: r.created_at,
    }
  }

  const total = computed(() =>
    items.value.reduce((s, x) => s + x.qty * x.unitPrice, 0),
  )

  const byCategory = computed(() => {
    const map: Record<string, TakeoffItem[]> = {}
    for (const item of items.value) {
      if (!map[item.category]) map[item.category] = []
      map[item.category]!.push(item)
    }
    return map
  })

  const isSaved = computed(() =>
    items.value.length > 0 && items.value.every(x => !x.id.startsWith("local-")),
  )

  return {
    items, loading, error, total, byCategory, isSaved,
    addLocal, removeLocal, clearLocal,
    saveAllToDB, loadFromDB, removeFromDB, clearFromDB,
  }
}
