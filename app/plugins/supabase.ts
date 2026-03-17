// plugins/supabase.ts
//
// ใช้ sessionStorage แทน localStorage สำหรับเก็บ Supabase session
//  ✅ รีเฟรชหน้า  → session ยังอยู่ (sessionStorage ไม่ถูกล้างเมื่อ refresh)
//  ✅ ปิด tab/browser → session หาย → เปิดใหม่มาต้อง login ใหม่
//  ✅ ฝั่ง server  → ไม่มี sessionStorage → ส่ง null ให้ middleware ข้าม

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

// Custom storage adapter ที่ใช้ sessionStorage (browser-only)
const sessionStorageAdapter = {
  getItem(key: string): string | null {
    if (typeof window === "undefined") return null
    return window.sessionStorage.getItem(key)
  },
  setItem(key: string, value: string): void {
    if (typeof window === "undefined") return
    window.sessionStorage.setItem(key, value)
  },
  removeItem(key: string): void {
    if (typeof window === "undefined") return
    window.sessionStorage.removeItem(key)
  },
}

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()

  const supabase: SupabaseClient = createClient(
    config.public.SUPABASE_URL as string,
    config.public.SUPABASE_KEY as string,
    {
      auth: {
        storage:            sessionStorageAdapter,
        persistSession:     true,
        autoRefreshToken:   true,
        detectSessionInUrl: true,
      },
    }
  )

  return {
    provide: { supabase },
  }
})
