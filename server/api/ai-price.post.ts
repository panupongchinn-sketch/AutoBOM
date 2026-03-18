// server/api/ai-price.post.ts
//
// เรียก Google Gemini API (free tier) เพื่อประเมินราคาต้นทุนงานก่อสร้างไทย
// Key ถูกเก็บใน runtimeConfig.geminiApiKey (server-only, ไม่ถูก expose client)

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

const GEMINI_MODEL = "gemini-2.0-flash"
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`

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

  const prompt = buildPrompt({ category, unit, name, dims, area, volume, matName })

  let res: Response
  try {
    res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 800,
        },
      }),
    })
  } catch (err: any) {
    throw createError({ statusCode: 502, message: "ไม่สามารถเชื่อมต่อ AI ได้ — กรุณาลองใหม่" })
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as any
    const status  = res.status
    if (status === 400) throw createError({ statusCode: 400, message: "ข้อมูลที่ส่งไม่ถูกต้อง" })
    if (status === 403) throw createError({ statusCode: 403, message: "GEMINI_API_KEY ไม่ถูกต้องหรือไม่มีสิทธิ์" })
    if (status === 429) throw createError({ statusCode: 429, message: "ใช้งาน AI เกินโควตา — กรุณารอสักครู่แล้วลองใหม่" })
    throw createError({ statusCode: 502, message: errBody?.error?.message || "เซิร์ฟเวอร์ AI มีปัญหาชั่วคราว" })
  }

  const geminiData = await res.json() as any
  const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""

  if (!rawText) {
    throw createError({ statusCode: 502, message: "AI ไม่ส่งข้อมูลกลับมา — กรุณาลองใหม่" })
  }

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

// ── Prompt Builder ──────────────────────────────────────────────────────────
function buildPrompt(p: AiPriceRequest): string {
  const dimStr = `กว้าง ${p.dims.w.toFixed(2)} ม. × สูง ${p.dims.h.toFixed(2)} ม. × ลึก ${p.dims.d.toFixed(2)} ม.`
  const extras = [
    p.area   ? `พื้นที่ผิว ${p.area.toFixed(2)} ตร.ม.`   : "",
    p.volume ? `ปริมาตร ${p.volume.toFixed(4)} ลบ.ม.`     : "",
    p.matName && p.matName !== "—" ? `วัสดุ: ${p.matName}` : "",
  ].filter(Boolean).join(", ")

  return `คุณเป็นผู้เชี่ยวชาญด้านการประมาณราคาก่อสร้างในประเทศไทย ปี 2025

ข้อมูลรายการถอดแบบ:
- ชื่อ: ${p.name}
- หมวดหมู่: ${p.category}
- หน่วยคิดราคา: ${p.unit}
- ขนาด: ${dimStr}${extras ? `\n- ${extras}` : ""}

กรุณาวิเคราะห์และประเมินราคาต้นทุนตลาดปัจจุบัน (ปี 2025) สำหรับรายการนี้ในประเทศไทย โดยอ้างอิง:
1. ราคากลางกรมบัญชีกลาง
2. BOQ มาตรฐานสมาคมสถาปนิกสยาม (ASA) และวิศวกรรมสถาน (EIT)
3. ราคาตลาดจริงจากผู้รับเหมาและร้านวัสดุก่อสร้างทั่วไป

ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอกจาก JSON:
{
  "suggestedPrice": <ราคาแนะนำ ตัวเลขจำนวนเต็ม บาทต่อหน่วย>,
  "priceMin": <ราคาต่ำสุดในตลาด ตัวเลขจำนวนเต็ม>,
  "priceMax": <ราคาสูงสุดในตลาด ตัวเลขจำนวนเต็ม>,
  "unit": "${p.unit}",
  "confidence": <"high" หรือ "medium" หรือ "low">,
  "reasoning": <สรุปเหตุผล 1-2 ประโยค ภาษาไทย>,
  "marketNotes": <ข้อสังเกตตลาด เช่น แนวโน้มราคา หรือปัจจัยกระทบ ภาษาไทย>,
  "warnings": [<คำเตือนถ้ามี เช่น ราคาผันผวน หรือขาดแคลน ภาษาไทย>]
}`
}

// ── JSON Extractor ──────────────────────────────────────────────────────────
function extractJson(text: string): Record<string, unknown> {
  let cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()
  try { return JSON.parse(cleaned) } catch { /* fall through */ }
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]) } catch { /* fall through */ }
  }
  throw createError({ statusCode: 502, message: "AI ส่งข้อมูลกลับมาในรูปแบบที่ไม่รองรับ" })
}
