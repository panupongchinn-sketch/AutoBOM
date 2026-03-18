// server/api/ai-price.post.ts
//
// Rule-Based Construction Cost Estimator (ไม่ใช้ AI)
// 1. ดึงราคาวัสดุจริงจาก TPSO API (index-api.tpso.go.th)
// 2. จับคู่วัสดุตามชื่อ/หมวดหมู่
// 3. คำนวณราคาตามสูตร BOQ มาตรฐาน (วัสดุ + ค่าแรง + overhead)

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

const TPSO_BASE = "https://index-api.tpso.go.th"

// ── ราคา BOQ มาตรฐานต่อหน่วย (วัสดุ + ค่าแรง + overhead) ──────────────────
// อ้างอิง: กรมบัญชีกลาง 2025, ASA, EIT
const PRICE_RULES: Record<string, Record<string, { min: number; max: number; mid: number; notes: string }>> = {
  "งานโครงสร้าง": {
    "ลบ.ม.":  { min: 4500,  max: 9500,   mid: 6500,  notes: "คอนกรีตเสริมเหล็กรวมค่าแรงและแบบหล่อ" },
    "ตร.ม.":  { min: 1200,  max: 3800,   mid: 2000,  notes: "พื้นคอนกรีต/ผนังคอนกรีต" },
    "กก.":    { min: 28,    max: 58,     mid: 40,    notes: "เหล็กเสริมรวมตัด-ดัด-ผูก" },
    "ตัน":    { min: 27000, max: 55000,  mid: 38000, notes: "เหล็กโครงสร้างรวมค่าแรงติดตั้ง" },
    "ต้น":    { min: 12000, max: 85000,  mid: 35000, notes: "เสาเข็มรวมค่าตอก" },
    "เมตร":   { min: 800,   max: 4000,   mid: 1800,  notes: "คานคอนกรีตต่อเมตร" },
    "ชิ้น":   { min: 500,   max: 15000,  mid: 3000,  notes: "ชิ้นส่วนโครงสร้าง" },
  },
  "งานสถาปัตย์": {
    "ตร.ม.":  { min: 350,   max: 1800,   mid: 750,   notes: "งานก่อ/ฉาบ/สี รวมค่าแรง" },
    "ชุด":    { min: 5000,  max: 45000,  mid: 15000, notes: "ประตู-หน้าต่างพร้อมวงกบ" },
    "เมตร":   { min: 200,   max: 1500,   mid: 600,   notes: "งานขอบ/ลายปูน/บัว" },
    "ชิ้น":   { min: 300,   max: 8000,   mid: 1500,  notes: "ชิ้นส่วนสถาปัตย์" },
    "ลบ.ม.":  { min: 1800,  max: 5000,   mid: 2800,  notes: "งานก่อผนัง" },
  },
  "งานระบบ": {
    "จุด":    { min: 1200,  max: 8000,   mid: 2800,  notes: "จุดไฟฟ้า/สุขาภิบาล รวมค่าแรง" },
    "เมตร":   { min: 150,   max: 900,    mid: 380,   notes: "ท่อ/สายไฟต่อเมตร" },
    "ชุด":    { min: 5000,  max: 120000, mid: 25000, notes: "อุปกรณ์ระบบพร้อมติดตั้ง" },
    "ตร.ม.":  { min: 800,   max: 5000,   mid: 2000,  notes: "งานระบบต่อพื้นที่" },
    "ชิ้น":   { min: 500,   max: 20000,  mid: 4000,  notes: "อุปกรณ์ระบบ" },
  },
  "งานตกแต่ง": {
    "ตร.ม.":  { min: 400,   max: 2800,   mid: 1000,  notes: "วัสดุตกแต่งรวมค่าแรง" },
    "ชุด":    { min: 3000,  max: 90000,  mid: 18000, notes: "ชุดเฟอร์นิเจอร์/อุปกรณ์" },
    "เมตร":   { min: 300,   max: 2000,   mid: 800,   notes: "งานตกแต่งต่อเมตร" },
    "ชิ้น":   { min: 200,   max: 15000,  mid: 2000,  notes: "ชิ้นส่วนตกแต่ง" },
  },
  "งานดิน": {
    "ลบ.ม.":  { min: 180,   max: 650,    mid: 320,   notes: "ขุด/ถม/บดอัดรวมขนย้าย" },
    "ตร.ม.":  { min: 80,    max: 300,    mid: 150,   notes: "งานปรับระดับพื้นที่" },
    "เมตร":   { min: 120,   max: 500,    mid: 250,   notes: "งานดินต่อเมตร" },
  },
}

// ── คำค้นหาวัสดุตามชื่อ object / วัสดุ ──────────────────────────────────────
const MATERIAL_KEYWORDS: Array<{
  patterns: string[]
  tpsoSearch: string[]
  laborRatio: number   // ค่าแรง / ค่าวัสดุ
  coveragePerUnit: number | null  // หน่วย TPSO ต่อ 1 หน่วยงาน (null = ราคาต่อหน่วยตรงๆ)
  coverageUnit: string
}> = [
  {
    patterns: ["ผนัง", "wall", "กำแพง", "ก่อ", "brick", "อิฐ"],
    tpsoSearch: ["อิฐ", "ก้อนอิฐ"],
    laborRatio: 1.8,
    coveragePerUnit: 70,   // อิฐ ~70 ก้อน/ตร.ม.
    coverageUnit: "ก้อน",
  },
  {
    patterns: ["พื้น", "floor", "กระเบื้อง", "tile", "ปูพื้น"],
    tpsoSearch: ["กระเบื้อง", "เซรามิก", "หินขัด"],
    laborRatio: 1.5,
    coveragePerUnit: 1.1,  // กระเบื้อง + waste 10%
    coverageUnit: "ตร.ม.",
  },
  {
    patterns: ["หลังคา", "roof", "มุง", "กระเบื้องหลังคา"],
    tpsoSearch: ["กระเบื้องหลังคา", "วัสดุมุง", "หลังคา"],
    laborRatio: 1.6,
    coveragePerUnit: 1.15,
    coverageUnit: "ตร.ม.",
  },
  {
    patterns: ["ปูน", "ฉาบ", "plaster", "cement", "mortar"],
    tpsoSearch: ["ปูนซีเมนต์", "ปูนก่อ", "ปูนฉาบ"],
    laborRatio: 1.4,
    coveragePerUnit: 8,    // ปูน 1 ถุง ≈ 8 ตร.ม. ฉาบ 1cm
    coverageUnit: "ถุง",
  },
  {
    patterns: ["เหล็ก", "steel", "iron", "rebar", "โครงเหล็ก"],
    tpsoSearch: ["เหล็ก", "เหล็กเส้น", "เหล็กรูปพรรณ"],
    laborRatio: 1.3,
    coveragePerUnit: null, // ราคาต่อกก. ตรงๆ
    coverageUnit: "กก.",
  },
  {
    patterns: ["คอนกรีต", "concrete", "เทปูน", "slap", "slab", "beam", "column", "เสา", "คาน"],
    tpsoSearch: ["คอนกรีต", "ปูนคอนกรีต", "คอนกรีตผสม"],
    laborRatio: 1.9,
    coveragePerUnit: null,
    coverageUnit: "ลบ.ม.",
  },
  {
    patterns: ["ทราย", "sand"],
    tpsoSearch: ["ทราย", "ทรายหยาบ", "ทรายละเอียด"],
    laborRatio: 1.2,
    coveragePerUnit: null,
    coverageUnit: "ลบ.ม.",
  },
  {
    patterns: ["หิน", "gravel", "หินคลุก", "หินย่อย"],
    tpsoSearch: ["หินคลุก", "หินย่อย", "หินทราย"],
    laborRatio: 1.2,
    coveragePerUnit: null,
    coverageUnit: "ลบ.ม.",
  },
  {
    patterns: ["สี", "paint", "ทาสี"],
    tpsoSearch: ["สีทาผนัง", "สีอะครีลิก", "สีน้ำ"],
    laborRatio: 1.6,
    coveragePerUnit: 10,   // สี 1 แกลอน ≈ 10 ตร.ม.
    coverageUnit: "แกลอน",
  },
  {
    patterns: ["ไม้", "wood", "timber", "ฝ้า", "ceiling"],
    tpsoSearch: ["ไม้แปรรูป", "ไม้อัด", "ไม้ฝ้า"],
    laborRatio: 1.7,
    coveragePerUnit: 1.15,
    coverageUnit: "ตร.ม.",
  },
  {
    patterns: ["ท่อ", "pipe", "pvc"],
    tpsoSearch: ["ท่อ", "ท่อ PVC", "ท่อน้ำ"],
    laborRatio: 2.0,
    coveragePerUnit: null,
    coverageUnit: "เมตร",
  },
  {
    patterns: ["กระจก", "glass", "window"],
    tpsoSearch: ["กระจก", "กระจกสะท้อนแสง"],
    laborRatio: 1.8,
    coveragePerUnit: 1.0,
    coverageUnit: "ตร.ม.",
  },
]

// ── ดึงราคา TPSO ทั้งหมด ──────────────────────────────────────────────────────
async function fetchAllTPSOItems(): Promise<TPSOItem[]> {
  const now       = new Date()
  const thaiYear  = now.getFullYear() + 543
  const month     = now.getMonth() + 1
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear  = month === 1 ? thaiYear - 1 : thaiYear

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
      if (Array.isArray(data) && data.length > 0) return data
    } catch { continue }
  }
  return []
}

// ── หา TPSO items ที่ตรงกับ keywords ────────────────────────────────────────
function searchTPSOItems(items: TPSOItem[], keywords: string[]): TPSOItem[] {
  return items.filter(item =>
    keywords.some(kw => item.commodityNameTH?.includes(kw))
  )
}

// ── จับคู่วัสดุจากชื่อ/วัสดุของ 3D object ──────────────────────────────────
function detectMaterialType(name: string, matName?: string) {
  const text = `${name} ${matName ?? ""}`.toLowerCase()
  for (const mat of MATERIAL_KEYWORDS) {
    if (mat.patterns.some(p => text.includes(p.toLowerCase()))) {
      return mat
    }
  }
  return null
}

// ── คำนวณราคาจากข้อมูล TPSO ─────────────────────────────────────────────────
function calcFromTPSO(
  tpsoItems: TPSOItem[],
  matType: (typeof MATERIAL_KEYWORDS)[0],
): { price: number; min: number; max: number; notes: string } | null {
  const matched = searchTPSOItems(tpsoItems, matType.tpsoSearch)
  if (matched.length === 0) return null

  // เลือก median ของราคา
  const prices = matched
    .map(i => i.priceCur ?? 0)
    .filter(p => p > 0)
    .sort((a, b) => a - b)

  if (prices.length === 0) return null

  const medIdx   = Math.floor(prices.length / 2)
  const matPrice = prices[medIdx]   // ราคาวัสดุต่อหน่วย TPSO
  const minMat   = prices[0]
  const maxMat   = prices[prices.length - 1]

  // คำนวณราคาต่อหน่วยงาน
  let unitPrice: number
  let unitMin: number
  let unitMax: number

  if (matType.coveragePerUnit && matType.coveragePerUnit > 0) {
    // ต้องแปลงหน่วย เช่น ปูน 1 ถุง → 8 ตร.ม.
    unitPrice = (matPrice / matType.coveragePerUnit) * matType.laborRatio
    unitMin   = (minMat  / matType.coveragePerUnit) * matType.laborRatio * 0.85
    unitMax   = (maxMat  / matType.coveragePerUnit) * matType.laborRatio * 1.20
  } else {
    // ราคาต่อหน่วยตรงๆ (เช่น เหล็ก/กก., คอนกรีต/ลบ.ม.)
    unitPrice = matPrice * matType.laborRatio
    unitMin   = minMat  * matType.laborRatio * 0.85
    unitMax   = maxMat  * matType.laborRatio * 1.20
  }

  const itemName = matched[0].commodityNameTH ?? ""
  return {
    price: Math.round(unitPrice),
    min:   Math.round(unitMin),
    max:   Math.round(unitMax),
    notes: `อ้างอิงราคา TPSO: ${itemName} ${matPrice.toFixed(0)} บาท/${matched[0].unitName ?? ""} × ค่าแรง ${matType.laborRatio}x`,
  }
}

// ── ราคา fallback จาก static rules ─────────────────────────────────────────
function calcFromRules(req: AiPriceRequest): { price: number; min: number; max: number; notes: string } {
  const catRules = PRICE_RULES[req.category]
  if (catRules) {
    const rule = catRules[req.unit] ?? catRules[Object.keys(catRules)[0]]
    return {
      price: rule.mid,
      min:   rule.min,
      max:   rule.max,
      notes: rule.notes + " (ราคากลาง BOQ 2025)",
    }
  }
  // default กรณีไม่มีข้อมูล
  return { price: 1000, min: 500, max: 3000, notes: "ราคาประมาณการทั่วไป" }
}

// ── สร้าง reasoning ──────────────────────────────────────────────────────────
function buildReasoning(
  req: AiPriceRequest,
  result: { price: number; min: number; max: number; notes: string },
  usedTPSO: boolean,
): { reasoning: string; marketNotes: string; warnings: string[] } {
  const warnings: string[] = []

  const qty = req.unit === "ลบ.ม." ? req.volume
            : req.unit === "ตร.ม." ? req.area
            : 1

  const total = qty ? result.price * qty : null

  const reasoning = [
    `ประมาณราคา${req.category} หน่วย ${req.unit}`,
    `ราคาแนะนำ: ${result.price.toLocaleString()} บาท/${req.unit}`,
    total ? `(รวม ${qty?.toFixed(2)} ${req.unit} ≈ ${total.toLocaleString()} บาท)` : "",
  ].filter(Boolean).join(" • ")

  const marketNotes = result.notes

  if (req.dims.w > 20 || req.dims.h > 20 || req.dims.d > 20) {
    warnings.push("ขนาดชิ้นงานใหญ่มาก — กรุณาตรวจสอบหน่วยก่อนใช้ราคา")
  }
  if (!usedTPSO) {
    warnings.push("ไม่พบข้อมูลราคา TPSO — ใช้ราคากลาง BOQ 2025 แทน")
  }
  if (!req.category || !PRICE_RULES[req.category]) {
    warnings.push("หมวดหมู่ไม่ตรงกับตาราง BOQ — ราคาอาจคลาดเคลื่อน")
  }

  return { reasoning, marketNotes, warnings }
}

// ── Main Handler ─────────────────────────────────────────────────────────────
export default defineEventHandler(async (event) => {
  const body = await readBody<AiPriceRequest>(event)
  const { category, unit, name, matName } = body

  if (!category || !unit) {
    throw createError({ statusCode: 400, message: "category และ unit จำเป็นต้องระบุ" })
  }

  // 1. ดึงข้อมูล TPSO และตรวจจับประเภทวัสดุพร้อมกัน
  const [tpsoItems] = await Promise.all([fetchAllTPSOItems()])
  const matType = detectMaterialType(name, matName)

  // 2. คำนวณราคา
  let priceResult: { price: number; min: number; max: number; notes: string }
  let usedTPSO = false
  let confidence: "high" | "medium" | "low" = "medium"

  if (matType && tpsoItems.length > 0) {
    const tpsoResult = calcFromTPSO(tpsoItems, matType)
    if (tpsoResult) {
      priceResult = tpsoResult
      usedTPSO    = true
      confidence  = "high"
    } else {
      priceResult = calcFromRules(body)
      confidence  = "medium"
    }
  } else if (tpsoItems.length > 0) {
    // มีข้อมูล TPSO แต่จับคู่วัสดุไม่ได้ → ใช้ rule แต่ระบุว่า medium
    priceResult = calcFromRules(body)
    confidence  = "medium"
  } else {
    // TPSO ไม่ตอบ → ใช้ static rules
    priceResult = calcFromRules(body)
    confidence  = "low"
  }

  // 3. Clamp ให้อยู่ในช่วงสมเหตุสมผล
  const catRules  = PRICE_RULES[category]
  const unitRule  = catRules?.[unit]
  if (unitRule) {
    priceResult.min = Math.max(priceResult.min, unitRule.min * 0.5)
    priceResult.max = Math.min(priceResult.max, unitRule.max * 2.0)
    if (priceResult.price < priceResult.min) priceResult.price = priceResult.min
    if (priceResult.price > priceResult.max) priceResult.price = priceResult.max
  }

  // 4. สร้าง reasoning
  const { reasoning, marketNotes, warnings } = buildReasoning(body, priceResult, usedTPSO)

  return {
    suggestedPrice: priceResult.price,
    priceMin:       priceResult.min,
    priceMax:       priceResult.max,
    unit,
    confidence,
    reasoning,
    marketNotes,
    warnings,
  } satisfies AiPriceResponse
})
