<template>
  <div class="min-h-screen bg-white text-slate-900 flex flex-col">
    <header
      ref="headerEl"
      class="fixed top-0 left-0 right-0 z-50 bg-white border-b border-slate-200"
    >
      <div class="max-w-none mx-auto px-4 sm:px-6 lg:px-10">
        <div class="h-16 flex items-center gap-3 sm:gap-4">
          <NuxtLink to="/" class="flex items-center gap-3 shrink-0">
            <img src="/MBLogo.png" alt="M&B" class="h-9 w-auto object-contain" />
          </NuxtLink>

          <div class="flex-1 hidden md:flex">
            <div class="w-full max-w-2xl mx-auto flex">
              <input
                v-model="q"
                type="text"
                placeholder="Search (SKU / Name / Category)"
                class="w-full h-10 px-4 border border-slate-300 rounded-l-md focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300"
                @keydown.enter="onSearch"
              />
              <button
                class="h-10 px-4 bg-red-600 text-white rounded-r-md hover:bg-red-700 active:bg-red-800"
                @click="onSearch"
                aria-label="Search"
                type="button"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 104.5 4.5a7.5 7.5 0 0012.15 12.15z"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div class="ml-auto flex items-center gap-2 sm:gap-4">
            <button
              class="md:hidden h-9 w-9 inline-flex items-center justify-center rounded-md border border-slate-200 hover:bg-slate-50"
              @click="toggleMobileSearch"
              aria-label="Open search"
              type="button"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 104.5 4.5a7.5 7.5 0 0012.15 12.15z"
                />
              </svg>
            </button>

            <button class="hidden sm:flex items-center gap-2 text-sm text-slate-700 hover:text-red-700" type="button">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5h14v16H5V5z" />
              </svg>
              <span class="font-medium">Watch/inquiry list</span>
            </button>

            <button class="flex items-center gap-2 text-sm text-slate-700 hover:text-red-700" type="button">
              <span class="relative inline-flex">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5h6M9 19h6M4 9h16M4 15h16" />
                </svg>
                <span
                  class="absolute -top-2 -right-2 h-5 min-w-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-bold flex items-center justify-center"
                >
                  {{ compareCount }}
                </span>
              </span>
              <span class="hidden sm:inline font-medium">Comparison</span>
            </button>

            <div class="h-6 w-px bg-slate-200 hidden sm:block"></div>

            <div class="relative flex items-center gap-2">
              <button
                class="text-sm text-slate-600 hover:text-red-700 flex items-center gap-1"
                @click="langOpen = !langOpen"
                type="button"
              >
                <span class="font-medium">{{ langLabel }}</span>
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              <div
                v-if="langOpen"
                class="absolute top-10 right-0 bg-white border border-slate-200 rounded-md shadow-lg overflow-hidden min-w-[200px]"
              >
                <button
                  class="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50"
                  @click="setLang('International | en')"
                  type="button"
                >
                  International | en
                </button>
                <button
                  class="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50"
                  @click="setLang('Thailand | th')"
                  type="button"
                >
                  Thailand | th
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="showMobileSearch" class="pb-4 md:hidden">
          <div class="flex">
            <input
              v-model="q"
              type="text"
              placeholder="Search (SKU / Name / Category)"
              class="w-full h-10 px-4 border border-slate-300 rounded-l-md focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300"
              @keydown.enter="onSearch"
            />
            <button class="h-10 px-4 bg-red-600 text-white rounded-r-md" @click="onSearch" type="button">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 104.5 4.5a7.5 7.5 0 0012.15 12.15z"
                />
              </svg>
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between h-12">
          <nav class="flex items-center gap-4 text-sm overflow-x-auto whitespace-nowrap no-scrollbar">
            <NuxtLink
              v-for="item in nav"
              :key="item.to + item.label"
              :to="item.to"
              class="font-semibold text-slate-800 hover:text-red-700 shrink-0"
              :class="route.path === item.to ? 'text-red-600' : ''"
            >
              {{ item.label }}
            </NuxtLink>
          </nav>

          <div class="ml-4 shrink-0">
            <NuxtLink
              v-if="!isLoggedIn"
              to="/login"
              class="h-9 inline-flex items-center gap-2 rounded-full bg-red-600 px-4 text-sm font-semibold text-white shadow-sm
                     hover:bg-red-700 active:bg-red-800 transition-colors
                     focus:outline-none focus:ring-2 focus:ring-red-300"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M15.75 7.5a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a7.5 7.5 0 0115 0" />
              </svg>
              เข้าระบบ
            </NuxtLink>

            <div v-else class="flex items-center gap-2">
              <NuxtLink
                to="/my-courses"
                class="h-9 inline-flex items-center rounded-full bg-red-600 px-4 text-sm font-semibold text-white shadow-sm
                       hover:bg-red-700 active:bg-red-800 transition-colors"
              >
                คอร์สของฉัน
              </NuxtLink>

              <button
                type="button"
                class="h-9 inline-flex items-center rounded-full border border-slate-200 px-4 text-sm font-semibold text-slate-700
                       hover:bg-slate-50"
                @click="onLogout"
              >
                ออกจากระบบ
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <main class="flex-1 w-full max-w-none mx-auto px-4 sm:px-6 lg:px-10 pt-[112px] pb-10">
      <slot />
    </main>

    <footer class="bg-red-600 text-white mt-auto">
      <div class="max-w-none mx-auto px-4 sm:px-6 lg:px-10 py-6">
        <div class="flex flex-col sm:flex-row gap-3 sm:gap-6 text-xs text-white/85">
          <NuxtLink to="/contact" class="hover:underline">Data privacy</NuxtLink>
          <NuxtLink to="/contact" class="hover:underline">Cookie settings</NuxtLink>
          <NuxtLink to="/contact" class="hover:underline">Imprint</NuxtLink>
          <NuxtLink to="/contact" class="hover:underline">General terms and conditions</NuxtLink>
          <span class="sm:ml-auto text-white/70">&copy; {{ new Date().getFullYear() }} M&B</span>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { useRoute } from "vue-router"

const route = useRoute()

const nav = [
  { label: "ผลิตภัณฑ์", to: "/product" },
  { label: "คอร์สอบรม", to: "/training" },
  { label: "ใบเสนอราคา", to: "/invoice" },
  { label: "รับทำเว็บไซต์ธุรกิจ", to: "/web-service" },
  { label: "ติดต่อเรา", to: "/contact" },
]

const q = useState<string>("mb_search_q", () => "")
const showMobileSearch = ref(false)

const toggleMobileSearch = () => {
  showMobileSearch.value = !showMobileSearch.value
}

const compareCount = ref(0)

const langOpen = ref(false)
const langLabel = ref("International | en")
const setLang = (v: string) => {
  langLabel.value = v
  langOpen.value = false
}

const onSearch = () => {
  showMobileSearch.value = false
}

const auth = useAuth?.() as any
const session = auth?.session
const init = auth?.init
const signOut = auth?.signOut

onMounted(async () => {
  try {
    if (init) await init()
  } catch (e) {
    console.error("auth init error:", e)
  }
})

const isLoggedIn = computed(() => {
  return !!session?.value
})

const onLogout = async () => {
  try {
    if (signOut) await signOut()
  } finally {
    await navigateTo("/")
  }
}
</script>

<style scoped>
@import url("https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap");
* {
  font-family: "Kanit", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
