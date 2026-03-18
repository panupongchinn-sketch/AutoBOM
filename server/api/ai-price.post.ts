// server/api/ai-price.post.ts
//
// 1. ดึงราคาวัสดุก่อสร้างจริงจาก TPSO API (index-api.tpso.go.th)
// 2. ส่งข้อมูลราคาจริงเป็น context ให้ Gemini ประเมินราคาแม่นยำขึ้น

interface AiPriceRequest {
  category: string
  unit: string
  name: string
  dims: { w: number; h: number; d: number }
  area?: number
  volume?: number
  matName?: string
}

export interface AiPriceResponse {
  suggestedPrice: number
  priceMin: number
  priceMax: number
  unit: string
  confidence: "high" | "medium" | "low"
  reasoning: string
  marketNotes: string
  warnings: string[]
}

interface TPSOItem {
  commodityCode?: string
  commodityNameTH?: string
  unitName?: string
  priceCur?: number
  priceVAT?: number
}

const GEMINI_MODEL = "gemini-2.0-flash"
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`
const TPSO_BASE    = "https://index-api.tpso.go.th"

// คำค้นหาสินค้าตามหมวดงาน
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "งานสถาปัตย์":   ["ปูน", "กระเบื้อง", "อิฐ", "กระจก", "ไม้", "หลังคา", "สี", "ฝ้า", "วัสดุมุง"],
  "งานโครงสร้าง":  ["เหล็ก", "ปูน", "ทราย", "หิน", "คอนกรีต", "เสา", "ตะแกรง"],
  "งานระบบ":       ["ท่อ", "สายไฟ", "PVC", "ทองแดง", "อุปกรณ์ไฟฟ้า"],
  "งานตกแต่ง":     ["ไม้", "สี", "กระเบื้อง", "หินอ่อน", "วอลล์เปเปอร์"],
  "งานดิน":        ["ทราย", "หิน", "ดิน", "หินคลุก"],
}

// ── ดึงราคาจริงจาก TPSO ─────────────────────────────────────────────────────
async function fetchTPSOPrices(category: string): Promise<string> {
  try {
    const now       = new Date()
    const thaiYear  = now.getFullYear() + 543
    // ลองเดือนนี้ก่อน ถ้าไม่มีข้อมูลจะ fallback เดือนที่แล้ว
    const month     = now.getMonth() + 1
    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear  = month === 1 ? thaiYear - 1 : thaiYear

    let items: TPSOItem[] = []

    for (const [yr, mo] of [[thaiYear, month], [prevYear, prevMonth]]) {
      try {
        const res = await fetch(`${TPSO_BASE}/OpenApi/CmiPrice/Month`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year: yr, month: mo }),
          // @ts-ignore
          signal: AbortSignal.timeout(6000),
        })
        if (!res.ok) continue
        const data = await res.json()
        if (Array.isArray(data) && data.length > 0) { items = data; break }
      } catch { continue }
    }

    if (items.length === 0) return ""

    // กรองสินค้าที่เกี่ยวกับหมวดงาน
    const keywords = CATEGORY_KEYWORDS[category] ?? []
    const filtered = keywords.length > 0
      ? items.filter(i => keywords.some(k => i.commodityNameTH?.includes(k)))
      : items

    const top = (filtered.length > 0 ? filtered : items).slice(0, 12)
    if (top.length === 0) return ""

    return top.map(i =>
      `  • ${i.commodityNameTH ?? "—"} (${i.unitName ?? "—"}): ` +
      `${i.priceCur ?? "N/A"} บาท` +
      (i.priceVAT ? ` | รวม VAT ${i.priceVAT} บาท` : "")
    ).join("\n")

  } catch {
    return "" // ถ้า TPSO ไม่ตอบก็ข้ามไป ไม่ block AI
  }
}

// ── Main Handler ─────────────────────────────────────────────────────────────
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const apiKey = config.geminiApiKey as string | undefined

  if (!apiKey) {
    throw createError({
      statusCode: 500,
      message: "GEMINI_API_KEY ยังไม่ได้ตั้งค่าในไฟล์ .env",
    })
  }

  const body = await readBody<AiPriceRequest>(event)
  const { category, unit, name, dims, area, volume, matName } = body

  if (!category || !unit) {
    throw createError({ statusCode: 400, message: "category และ unit จำเป็นต้องระบุ" })
  }

  // ดึงราคา TPSO และสร้าง prompt พร้อมกัน
  const tpsoData = await fetchTPSOPrices(category)
  const prompt   = buildPrompt({ category, unit, name, dims, area, volume, matName }, tpsoData)

  let res: Response
  try {
    res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 800 },
      }),
    })
  } catch (err: any) {
    throw createError({ statusCode: 502, message: "ไม่สามารถเชื่อมต่อ AI ได้ — กรุณาลองใหม่" })
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as any
    const status  = res.status
    if (status === 403) throw createError({ statusCode: 403, message: "GEMINI_API_KEY ไม่ถูกต้อง" })
    if (status === 429) throw createError({ statusCode: 429, message: "ใช้งาน AI เกินโควตา — กรุณารอสักครู่แล้วลองใหม่" })
    throw createError({ statusCode: 502, message: errBody?.error?.message || "เซิร์ฟเวอร์ AI มีปัญหาชั่วคราว" })
  }

  const geminiData = await res.json() as any
  const rawText    = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
  if (!rawText) throw createError({ statusCode: 502, message: "AI ไม่ส่งข้อมูลกลับมา — กรุณาลองใหม่" })

  const parsed = extractJson(rawText) as unknown as AiPriceResponse

  return {
    suggestedPrice: Number(parsed.suggestedPrice) || 0,
    priceMin:       Number(parsed.priceMin)       || 0,
    priceMax:       Number(parsed.priceMax)       || 0,
    unit:           String(parsed.unit             || unit),
    confidence:     parsed.confidence             || "medium",
    reasoning:      String(parsed.reasoning       || ""),
    marketNotes:    String(parsed.marketNotes     || ""),
    warnings:       Array.isArray(parsed.warnings) ? parsed.warnings : [],
  } satisfies AiPriceResponse
})

// ── Prompt Builder ────────────────────────────────────────────────────────────
function buildPrompt(p: AiPriceRequest, tpsoData: string): string {
  const dimStr = `กว้าง ${p.dims.w.toFixed(2)} ม. × สูง ${p.dims.h.toFixed(2)} ม. × ลึก ${p.dims.d.toFixed(2)} ม.`
  const extras = [
    p.area   ? `พื้นที่ผิว ${p.area.toFixed(2)} ตร.ม.`  : "",
    p.volume ? `ปริมาตร ${p.volume.toFixed(4)} ลบ.ม.`    : "",
    p.matName && p.matName !== "—" ? `วัสดุ: ${p.matName}` : "",
  ].filter(Boolean).join(", ")

  const tpsoPart = tpsoData
    ? `\nข้อมูลราคาวัสดุก่อสร้างจริงจากสำนักงานนโยบายและยุทธศาสตร์การค้า (TPSO) ล่าสุด:\n${tpsoData}\n`
    : ""

  return `คุณเป็นผู้เชี่ยวชาญด้านการประมาณราคาก่อสร้างในประเทศไทย ปี 2025
${tpsoPart}
ข้อมูลรายการถอดแบบ:
- ชื่อ: ${p.name}
- หมวดหมู่: ${p.category}
- หน่วยคิดราคา: ${p.unit}
- ขนาด: ${dimStr}${extras ? `\n- ${extras}` : ""}

กรุณาวิเคราะห์และประเมินราคาต้นทุนตลาดปัจจุบัน (ปี 2025) สำหรับรายการนี้ในประเทศไทย${tpsoData ? " โดยอ้างอิงราคา TPSO ข้างต้นเป็นหลัก" : ""} โดยอ้างอิง:
1. ราคากลางกรมบัญชีกลาง
2. BOQ มาตรฐาน ASA และ EIT
3. ราคาตลาดจริงจากผู้รับเหมา

ตอบเป็น JSON เท่านั้น:
{
  "suggestedPrice": <ราคาแนะนำ ตัวเลขจำนวนเต็ม บาทต่อหน่วย>,
  "priceMin": <ราคาต่ำสุด ตัวเลขจำนวนเต็ม>,
  "priceMax": <ราคาสูงสุด ตัวเลขจำนวนเต็ม>,
  "unit": "${p.unit}",
  "confidence": <"high" หรือ "medium" หรือ "low">,
  "reasoning": <สรุปเหตุผล 1-2 ประโยค ภาษาไทย>,
  "marketNotes": <ข้อสังเกตตลาด ภาษาไทย>,
  "warnings": [<คำเตือนถ้ามี ภาษาไทย>]
}`
}

// ── JSON Extractor ────────────────────────────────────────────────────────────
function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()
  try { return JSON.parse(cleaned) } catch { /* fall through */ }
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) { try { return JSON.parse(match[0]) } catch { /* fall through */ } }
  throw createError({ statusCode: 502, message: "AI ส่งข้อมูลกลับมาในรูปแบบที่ไม่รองรับ" })
}
