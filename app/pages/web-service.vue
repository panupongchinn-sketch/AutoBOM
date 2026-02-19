<template>
  <div>
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-4xl sm:text-5xl font-bold text-slate-700 tracking-tight">
          รับทำเว็บไซต์ธุรกิจ
        </h1>
        <p class="mt-2 text-sm text-slate-500">
          ตัวอย่างผลงานเว็บไซต์จากทีมงาน พร้อมลิงก์เข้าชมจริง
        </p>
      </div>

      <button
        class="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-slate-200 hover:bg-slate-50 text-sm"
        @click="loadPortfolio"
        type="button"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        Refresh
      </button>
    </div>

    <div class="mt-6 bg-red-50 border border-red-100 rounded-lg p-5 sm:p-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div class="text-lg font-bold text-slate-800">แพ็กเกจเริ่มต้น 9,900 บาท</div>
          <div class="mt-1 text-sm text-slate-600">
            รองรับมือถือ เชื่อมโซเชียล ปรับแต่งข้อมูลสินค้าได้
          </div>
        </div>
        <NuxtLink
          to="/contact"
          class="inline-flex items-center justify-center h-10 px-4 rounded-md bg-red-600 text-white font-semibold hover:bg-red-700"
        >
          ขอใบเสนอราคา
        </NuxtLink>
      </div>
    </div>

    <div v-if="loading" class="mt-6 flex items-center gap-3 text-slate-500">
      <span class="loading loading-spinner loading-md"></span>
      <span class="font-medium">กำลังโหลดผลงานเว็บไซต์...</span>
    </div>

    <div v-else-if="error" class="mt-6 p-6 border border-red-200 bg-red-50 rounded-lg">
      <div class="font-bold text-red-700">โหลดข้อมูลไม่สำเร็จ</div>
      <div class="text-sm text-red-600 mt-1">{{ error }}</div>
      <div class="text-xs text-red-500 mt-2">
        ตรวจสอบว่ามีตาราง <code>website_portfolio</code> ใน Supabase และเปิดสิทธิ์อ่านแล้ว
      </div>
    </div>

    <div
      v-else-if="items.length === 0"
      class="mt-6 p-10 text-center text-slate-500 border border-dashed border-slate-300 rounded-lg"
    >
      ยังไม่มีผลงานในระบบ
      <div class="mt-2 text-xs text-slate-400">
        เพิ่มข้อมูลในตาราง <code>website_portfolio</code> แล้วกด Refresh
      </div>
    </div>

    <section v-else class="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      <div v-if="sourceTable" class="col-span-full text-xs text-slate-400">
       
      </div>
      <article
        v-for="item in items"
        :key="item.id"
        class="group bg-white border border-slate-200 hover:border-slate-300 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-all"
      >
        <div class="bg-white border-b border-slate-100">
          <div class="w-full aspect-[16/9] sm:aspect-[4/3] p-4 flex items-center justify-center overflow-hidden">
            <img
              :src="item.imageUrl || fallbackImg"
              :alt="item.title"
              class="w-full h-full object-contain drop-shadow-sm transition-transform duration-300 group-hover:scale-[1.03]"
              loading="lazy"
              @error="onImgError"
            />
          </div>
        </div>

        <div class="p-5">
          <h3 class="text-lg font-bold text-slate-800 group-hover:text-slate-900 line-clamp-2">{{ item.title }}</h3>
          <p class="mt-2 text-sm text-slate-600 line-clamp-2">{{ item.description || "-" }}</p>

          <div class="mt-4 flex flex-wrap gap-2">
            <span
              v-for="tag in item.tags"
              :key="`${item.id}-${tag}`"
              class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700"
            >
              {{ tag }}
            </span>
          </div>

          <a
            v-if="item.linkUrl"
            :href="item.linkUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-red-600 hover:text-red-700"
          >
            ดูเว็บไซต์จริง
            <span>↗</span>
          </a>
        </div>
      </article>
    </section>
  </div>
</template>

<script setup lang="ts">
type PortfolioItem = {
  id: string
  title: string
  description: string
  imageUrl: string
  linkUrl: string
  tags: string[]
}

const { $supabase } = useNuxtApp()

useState<string>("mb_search_q", () => "")

const fallbackImg = "https://picsum.photos/seed/web-service/1200/800"
const items = ref<PortfolioItem[]>([])
const loading = ref(true)
const error = ref("")
const sourceTable = ref("")

const pickString = (obj: Record<string, any>, keys: string[]) => {
  for (const key of keys) {
    const value = obj?.[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

const parseTags = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean)
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
  }
  return []
}

const normalizeUrl = (raw: string) => {
  if (!raw) return ""
  if (/^https?:\/\//i.test(raw)) return raw
  return `https://${raw}`
}

const loadPortfolio = async () => {
  loading.value = true
  error.value = ""
  sourceTable.value = ""
  try {
    const candidateTables = ["website_portfolio", "web_portfolio", "portfolio_websites"]
    let rows: Record<string, any>[] = []
    let lastError: any = null

    for (const table of candidateTables) {
      const { data, error: e } = await ($supabase as any)
        .from(table)
        .select("*")

      if (!e) {
        rows = Array.isArray(data) ? data : []
        sourceTable.value = table
        break
      }
      lastError = e
    }

    if (!sourceTable.value) throw lastError || new Error("No portfolio table found")

    items.value = rows.map((row: Record<string, any>, idx: number) => {
      const title = pickString(row, ["title", "name", "project_name"]) || `ผลงาน #${idx + 1}`
      const description = pickString(row, ["description", "detail", "summary"])
      const imageUrl = pickString(row, ["image_url", "thumbnail_url", "cover_url"])
      const linkUrl = normalizeUrl(pickString(row, ["link_url", "url", "website_url", "demo_url"]))
      const tags = parseTags(row.tags ?? row.stack)
      const idValue = row.id ?? row.uuid ?? `${title}-${idx}`

      return {
        id: String(idValue),
        title,
        description,
        imageUrl,
        linkUrl,
        tags,
      }
    })
  } catch (err: any) {
    error.value = err?.message || "Failed to load website_portfolio"
    items.value = []
  } finally {
    loading.value = false
  }
}

const onImgError = (e: Event) => {
  const el = e.target as HTMLImageElement | null
  if (el) el.src = fallbackImg
}

onMounted(loadPortfolio)
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.line-clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>

