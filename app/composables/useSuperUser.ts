// composables/useSuperUser.ts
//
// ตรวจว่า user ปัจจุบันเป็น Super User หรือไม่
// ใช้ตาราง public.super_users (RLS: อ่านได้เฉพาะ record ของตัวเอง)

export const useSuperUser = () => {
  const { $supabase } = useNuxtApp() as any

  // useState ทำให้ cache ข้ามหน้าในระหว่าง session เดียว
  const isSuperUser = useState<boolean | null>("is_super_user", () => null)

  const checkSuperUser = async (): Promise<boolean> => {
    // ถ้าเคย check แล้วใช้ค่าเดิม
    if (isSuperUser.value !== null) return isSuperUser.value

    const { data: sessionData } = await $supabase.auth.getSession()
    if (!sessionData?.session?.user) {
      isSuperUser.value = false
      return false
    }

    const userId = sessionData.session.user.id
    const { data, error } = await $supabase
      .from("super_users")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle()

    isSuperUser.value = !error && data !== null
    return isSuperUser.value
  }

  // reset เมื่อ logout
  const resetSuperUser = () => {
    isSuperUser.value = null
  }

  return { isSuperUser, checkSuperUser, resetSuperUser }
}
