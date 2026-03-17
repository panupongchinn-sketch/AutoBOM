// composables/useAiPrice.ts
//
// AI-assisted construction cost estimation
// - fetchAiPrice()  → เรียก /api/ai-price (server-side Claude call)
// - checkAnomaly()  → เปรียบราคากับ static market table (ไม่ต้องเรียก AI)
// - STATIC_PRICE_TABLE → ราคาตลาดก่อสร้างไทย ปี 2025 อ้างอิงกรมบัญชีกลาง

// ── Static Market Price Table (Thai Construction 2025) ──────────────────────
export const STATIC_PRICE_TABLE: Record<string, { min: number; max: number; unit: string }> = {
  "งานผนัง":           { min: 450,   max: 1200,  unit: "ตร.ม." },
  "งานพื้น":           { min: 350,   max: 950,   unit: "ตร.ม." },
  "งานหลังคา":         { min: 500,   max: 1800,  unit: "ตร.ม." },
  "งานโครงสร้าง":      { min: 5500,  max: 18000, unit: "ลบ.ม." },
  "งานประตู-หน้าต่าง": { min: 6000,  max: 35000, unit: "ชุด"   },
  "งานไฟฟ้า":          { min: 1200,  max: 8000,  unit: "จุด"   },
  "งานสถาปัตย์":       { min: 300,   max: 1500,  unit: "ตร.ม." },
  "งานสุขาภิบาล":      { min: 800,   max: 6000,  unit: "จุด"   },
  "งานปรับอากาศ":      { min: 15000, max: 55000, unit: "ชุด"   },
}

export type AnomalyLevel = "ok" | "warning" | "danger" | "unknown"

/**
 * เปรียบราคากับตาราง static market
 *  "ok"      — อยู่ในช่วง [min, max]
 *  "warning" — อยู่นอกช่วงแต่ไม่เกิน ±60%  (ผิดปกติเล็กน้อย)
 *  "danger"  — ต่ำกว่า min×0.4 หรือสูงกว่า max×1.6  (ผิดปกติมาก)
 *  "unknown" — ไม่มีข้อมูลหมวดหมู่นี้ในตาราง
 */
export function checkAnomaly(category: string, unitPrice: number): AnomalyLevel {
  const ref = STATIC_PRICE_TABLE[category]
  if (!ref) return "unknown"
  if (unitPrice >= ref.min && unitPrice <= ref.max) return "ok"
  if (unitPrice >= ref.min * 0.4 && unitPrice <= ref.max * 1.6) return "warning"
  return "danger"
}

// ── AI Price Result Type ────────────────────────────────────────────────────
export interface AiPriceResult {
  suggestedPrice: number
  priceMin: number
  priceMax: number
  unit: string
  confidence: "high" | "medium" | "low"
  reasoning: string
  marketNotes: string
  warnings: string[]
}

// ── Composable ──────────────────────────────────────────────────────────────
export const useAiPrice = () => {
  const result   = ref<AiPriceResult | null>(null)
  const loading  = ref(false)
  const error    = ref<string | null>(null)
  // simple cooldown: ป้องกัน rate-limit — รอ 5 วิหลังได้ผลแล้ว
  let lastFetchAt = 0

  async function fetchAiPrice(payload: {
    category: string
    unit: string
    name: string
    dims: { w: number; h: number; d: number }
    area?: number
    volume?: number
    matName?: string
  }) {
    const now = Date.now()
    if (loading.value) return
    if (result.value && now - lastFetchAt < 5000) return   // cooldown

    loading.value = true
    error.value   = null

    try {
      const data = await $fetch<AiPriceResult>("/api/ai-price", {
        method: "POST",
        body: payload,
      })
      result.value = data
      lastFetchAt  = Date.now()
    } catch (e: any) {
      // ดึงเฉพาะข้อความที่เข้าใจได้ ไม่แสดง JSON ดิบ
      error.value =
        e?.data?.message ||
        e?.response?._data?.message ||
        (typeof e?.message === "string" && !e.message.startsWith("{")
          ? e.message
          : "ไม่สามารถเชื่อมต่อ AI ได้ — กรุณาลองใหม่")
    } finally {
      loading.value = false
    }
  }

  function reset() {
    result.value = null
    error.value  = null
    lastFetchAt  = 0
  }

  return {
    result,
    loading,
    error,
    fetchAiPrice,
    reset,
    // re-export statics so index.vue only needs one import
    checkAnomaly,
    STATIC_PRICE_TABLE,
  }
}
