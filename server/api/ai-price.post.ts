// server/api/ai-price.post.ts
//
// เรียก Claude API เพื่อประเมินราคาต้นทุนงานก่อสร้างไทย
// Key ถูกเก็บใน runtimeConfig.anthropicApiKey (server-only, ไม่ถูก expose client)

import Anthropic from "@anthropic-ai/sdk"

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

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()

  if (!config.anthropicApiKey) {
    throw createError({
      statusCode: 500,
      message: "ANTHROPIC_API_KEY ยังไม่ได้ตั้งค่าในไฟล์ .env",
    })
  }

  const body = await readBody<AiPriceRequest>(event)
  const { category, unit, name, dims, area, volume, matName } = body

  if (!category || !unit) {
    throw createError({ statusCode: 400, message: "category และ unit จำเป็นต้องระบุ" })
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey })

  const prompt = buildPrompt({ category, unit, name, dims, area, volume, matName })

  try {
    const message = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    })

    const rawText = (message.content[0] as { type: string; text: string }).text
    const parsed = extractJson(rawText) as AiPriceResponse

    // Sanity-check: ensure numeric fields are numbers
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

  } catch (err: any) {
    if (err.statusCode) throw err   // re-throw createError objects

    // แปลง Anthropic HTTP error เป็นข้อความภาษาไทยที่เข้าใจง่าย
    const status = err.status ?? err.statusCode ?? 0
    if (status === 401) {
      throw createError({ statusCode: 401, message: "API Key ไม่ถูกต้อง — กรุณาตรวจสอบ ANTHROPIC_API_KEY ในไฟล์ .env" })
    }
    if (status === 429) {
      throw createError({ statusCode: 429, message: "ใช้งาน AI เกินโควตา — กรุณารอสักครู่แล้วลองใหม่" })
    }
    if (status >= 500) {
      throw createError({ statusCode: 502, message: "เซิร์ฟเวอร์ AI มีปัญหาชั่วคราว — กรุณาลองใหม่อีกครั้ง" })
    }
    throw createError({ statusCode: 502, message: "ไม่สามารถเชื่อมต่อ AI ได้ — กรุณาลองใหม่" })
  }
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
  // Strip markdown fences
  let cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()

  // Try direct parse first
  try { return JSON.parse(cleaned) } catch { /* fall through */ }

  // Fallback: extract first {...} block
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]) } catch { /* fall through */ }
  }

  throw createError({ statusCode: 502, message: "AI ส่งข้อมูลกลับมาในรูปแบบที่ไม่รองรับ" })
}
