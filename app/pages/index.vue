<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"

definePageMeta({ layout: false, middleware: "auth" })

// ── Auth ──
const auth = useAuth()
const currentUser = computed(() => auth.user.value)
const userLabel = computed(() => {
  const u = currentUser.value
  if (!u) return ""
  return u.user_metadata?.full_name || u.email?.split("@")[0] || "User"
})
async function logout() {
  await auth.signOut()
  superUser.resetSuperUser()
  await navigateTo("/login")
}

// ── Super User ──
const superUser = useSuperUser()
const isSuperUser = superUser.isSuperUser

const viewport = ref<HTMLDivElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const selectedFileName = ref("")
const statusText = ref("Ready")
const errorText = ref("")
const loadedAssetCount = ref(0)
const viewerReady = ref(false)
const wallTransparentOn = ref(false)
const hasModel = ref(false)
const isLoading = ref(false)
const loadingStep = ref("")
const loadingProgress = ref(0)
const lightDevices = ref<{ id: number; name: string; on: boolean }[]>([])
const dragLightActive = ref(false)
const dragLightHint = ref("ลากไอคอนหลอดไฟไปวางบนโมเดล")

// UI state
const activeTool = ref("select")
const leftTab = ref<"outliner" | "layers">("outliner")
const rightTab = ref<"entity" | "lights" | "styles" | "takeoff">("entity")

// Selection state
const selectedMesh = ref<any>(null)
const selectedInfo = ref<{
  name: string
  dims: { w: number; h: number; d: number }
  area: number
  volume: number
  matName: string
} | null>(null)

// Takeoff form
const tfName = ref("")
const tfCategory = ref("งานสถาปัตย์")
const tfQty = ref(1)
const tfUnit = ref("ตร.ม.")
const tfUnitPrice = ref(500)

// Project + Model storage
const project = useProject()
const showProjectPanel = ref(false)
const showAbout = ref(false)
const showSaveModal = ref(false)
const pendingProjectName = ref("")
let pendingModelFile: File | null = null     // ไฟล์ที่เปิดอยู่ (ยังไม่บันทึก)
const isSavingProject = ref(false)
const saveSuccess = ref(false)

// Takeoff list
const takeoff = useTakeoff()
const takeoffItems = takeoff.items
const takeoffTotal = takeoff.total
const takeoffByCategory = takeoff.byCategory
const showCostReport = ref(false)
const takeoffSaving = ref(false)
const deletingId = ref<string | null>(null)

// AI Price estimation
const aiPrice = useAiPrice()
const aiResult  = aiPrice.result
const aiLoading = aiPrice.loading
const aiError   = aiPrice.error

// Live anomaly level for the current form input (static table, no AI needed)
const currentAnomaly = computed(() => aiPrice.checkAnomaly(tfCategory.value, tfUnitPrice.value))

// Per-item anomaly for the takeoff list
function itemAnomaly(item: { category: string; unitPrice: number }) {
  return aiPrice.checkAnomaly(item.category, item.unitPrice)
}

// Price range bar: maps [priceMin, priceMax] onto a track [min*0.5 → max*1.5]
const priceRangeStyle = computed(() => {
  if (!aiResult.value) return {}
  const { priceMin, priceMax } = aiResult.value
  const trackMin = priceMin * 0.5
  const trackMax = priceMax * 1.5
  const span = Math.max(trackMax - trackMin, 1)
  const left  = ((priceMin - trackMin) / span) * 100
  const right = ((trackMax - priceMax) / span) * 100
  return { left: `${left.toFixed(1)}%`, right: `${right.toFixed(1)}%` }
})

// Suggested price thumb position on the track
const priceThumbStyle = computed(() => {
  if (!aiResult.value) return {}
  const { priceMin, priceMax, suggestedPrice } = aiResult.value
  const trackMin = priceMin * 0.5
  const trackMax = priceMax * 1.5
  const span = Math.max(trackMax - trackMin, 1)
  const pos = ((suggestedPrice - trackMin) / span) * 100
  return { left: `${Math.max(0, Math.min(100, pos)).toFixed(1)}%` }
})

// User's current price thumb on the track (shown when AI result exists)
const userPriceThumbStyle = computed(() => {
  if (!aiResult.value) return {}
  const { priceMin, priceMax } = aiResult.value
  const trackMin = priceMin * 0.5
  const trackMax = priceMax * 1.5
  const span = Math.max(trackMax - trackMin, 1)
  const pos = ((tfUnitPrice.value - trackMin) / span) * 100
  return { left: `${Math.max(0, Math.min(100, pos)).toFixed(1)}%` }
})

async function requestAiPrice() {
  if (!selectedInfo.value) return
  await aiPrice.fetchAiPrice({
    category: tfCategory.value,
    unit:     tfUnit.value,
    name:     selectedInfo.value.name,
    dims:     selectedInfo.value.dims,
    area:     selectedInfo.value.area,
    volume:   selectedInfo.value.volume,
    matName:  selectedInfo.value.matName,
  })
}

// ผู้ใช้กดยืนยันเอง ไม่ auto-fill
function applyAiPrice() {
  if (aiResult.value) tfUnitPrice.value = aiResult.value.suggestedPrice
}

// Highlight tracking
const origEmissiveMap = new Map<any, { r: number; g: number; b: number; i: number }>()

function fmt(n: number, d = 2) { return n.toFixed(d) }
function fmtPrice(n: number) { return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
const activeMenu = ref<string | null>(null)
const sceneTab = ref("Scene 1")
const mouseCoords = ref({ x: "0.000", y: "0.000", z: "0.000" })
const outlinerOpen = ref(true)
const showSkpGuide = ref(false)
const isDragOverFiles = ref(false)
const skpFileName = ref("")

// ── View / Camera toggles ──────────────────────────────────────────────────
const wireframeOn   = ref(false)
const shadowsOn     = ref(true)
const fogOn         = ref(false)
const cameraIsOrtho = ref(false)

// ── Right-panel resize ──────────────────────────────────────────────────────
const rightPanelWidth = ref(260)
let _rpResizing = false
let _rpStartX = 0
let _rpStartW = 0
function onRpResizeStart(e: MouseEvent) {
  _rpResizing = true; _rpStartX = e.clientX; _rpStartW = rightPanelWidth.value
  document.addEventListener("mousemove", onRpResizeMove)
  document.addEventListener("mouseup",   onRpResizeEnd)
  e.preventDefault()
}
function onRpResizeMove(e: MouseEvent) {
  if (!_rpResizing) return
  rightPanelWidth.value = Math.min(480, Math.max(180, _rpStartW + (_rpStartX - e.clientX)))
}
function onRpResizeEnd() {
  _rpResizing = false
  document.removeEventListener("mousemove", onRpResizeMove)
  document.removeEventListener("mouseup",   onRpResizeEnd)
}

let THREE: any
let renderer: any
let scene: any
let camera: any
let controls: any
let pmrem: any
let loader: any
let loadingManager: any
let currentModel: any = null
let groundMesh: any = null
let rafId = 0
let resizeObserver: ResizeObserver | null = null
let initPromise: Promise<void> | null = null
let pointerDownMoved = false
let pointerDownX = 0
let pointerDownY = 0
let lightIdSeed = 1
const lightDeviceMap = new Map<number, any>()

let defaultCamPos: [number, number, number] = [5, 3, 7]
let defaultTarget: [number, number, number] = [0, 1.2, 0]
let modelRadius = 1
let lastWallSig = ""
let cameraPersp: any = null     // เก็บ PerspectiveCamera เมื่อสลับไป Ortho
let cameraOrtho: any = null     // OrthographicCamera (สร้างเมื่อ switch)
const objectUrlPool: string[] = []
const localFileMap = new Map<string, string>()

const tools = [
  { id: "select", icon: "M3 3l7 18 3-7 7-3z", label: "Select", title: "Select (Space)" },
  { id: "eraser", icon: "M20 20H7L3 16l10-10 7 7-2.5 2.5M6.5 17.5l10-10", label: "Eraser", title: "Eraser (E)" },
  { id: "move", icon: "M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M12 3v18M3 12h18", label: "Move", title: "Move (M)" },
  { id: "rotate", icon: "M12 2a10 10 0 0 1 10 10M12 22a10 10 0 0 1-10-10M2 12h4M18 12h4", label: "Rotate", title: "Rotate (R)" },
  { id: "scale", icon: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z", label: "Scale", title: "Scale (S)" },
  { id: "pushpull", icon: "M12 2v12M12 14l-4-4M12 14l4-4M5 20h14", label: "Push/Pull", title: "Push/Pull (P)" },
]

const viewTools = [
  { id: "orbit", icon: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20", label: "Orbit", title: "Orbit (O)" },
  { id: "pan", icon: "M5 9V5h4M5 15v4h4M19 9V5h-4M19 15v4h-4M12 12m-1 0a1 1 0 1 0 2 0 1 1 0 0 0-2 0", label: "Pan", title: "Pan (H)" },
  { id: "zoom", icon: "M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM11 8v6M8 11h6", label: "Zoom", title: "Zoom (Z)" },
]

const menuItems = [
  { id: "file", label: "File", items: ["New", "Open...", "Save", "Save As...", "---", "Import...", "Export...", "---", "Print", "---", "Exit"] },
  { id: "edit", label: "Edit", items: ["Undo", "Redo", "---", "Cut", "Copy", "Paste", "Delete", "---", "Select All", "Deselect All"] },
  { id: "view", label: "View", items: ["Toolbars", "Scene Tabs", "---", "Face Style", "Edge Style", "---", "Component Edit", "---", "Shadows", "Fog", "---", "Animation"] },
  { id: "camera", label: "Camera", items: ["Previous", "Next", "---", "Standard Views", "---", "Parallel Projection", "Perspective", "Two-Point Perspective", "---", "Field of View"] },
  { id: "draw", label: "Draw", items: ["Line", "Arc", "Freehand", "---", "Rectangle", "Rotated Rectangle", "---", "Circle", "Polygon"] },
  { id: "tools", label: "Tools", items: ["Select", "Eraser", "---", "Move", "Rotate", "Scale", "Push/Pull", "Follow Me", "Offset", "---", "Tape Measure", "Protractor", "---", "Paint Bucket"] },
  { id: "window", label: "Window", items: ["Model Info", "Entity Info", "---", "Components", "Materials", "Styles", "Layers", "Outliner", "Scenes", "---", "Preferences"] },
  { id: "help", label: "Help", items: ["Welcome to SketchUp", "Knowledge Center", "---", "Check for Update", "---", "About SketchUp"] },
]

function toggleMenu(id: string) {
  activeMenu.value = activeMenu.value === id ? null : id
}

function menuItemChecked(item: string): boolean {
  if (item === "Face Style")          return wireframeOn.value
  if (item === "Shadows")             return shadowsOn.value
  if (item === "Fog")                 return fogOn.value
  if (item === "Parallel Projection") return cameraIsOrtho.value
  if (item === "Perspective")         return !cameraIsOrtho.value
  if (item === "X-Ray")               return wallTransparentOn.value
  return false
}

function closeMenus() {
  activeMenu.value = null
}

// ── License info for About modal ──
const { license, checkLicense } = useLicense()
onMounted(async () => {
  await checkLicense()
  await superUser.checkSuperUser()
})

// ─── View toggles ──────────────────────────────────────────────────────────
function toggleWireframe() {
  if (!scene) return
  wireframeOn.value = !wireframeOn.value
  scene.traverse((obj: any) => {
    if (!obj.isMesh || obj === groundMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    mats.forEach((m: any) => { if (m) m.wireframe = wireframeOn.value })
  })
}

function toggleShadows() {
  if (!renderer) return
  shadowsOn.value = !shadowsOn.value
  renderer.shadowMap.enabled = shadowsOn.value
  scene?.traverse((obj: any) => {
    if (obj.isMesh) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      mats.forEach((m: any) => { if (m) m.needsUpdate = true })
    }
  })
}

function toggleFog() {
  if (!scene || !THREE) return
  fogOn.value = !fogOn.value
  scene.fog = fogOn.value ? new THREE.FogExp2(0xb0c8d8, 0.015) : null
}

function setCameraOrtho() {
  if (!camera || !controls || !renderer || !THREE) return
  if (cameraIsOrtho.value) return
  cameraPersp = camera
  const w = renderer.domElement.clientWidth
  const h = renderer.domElement.clientHeight
  const aspect = w / h
  const d = modelRadius * 3.5
  const ortho = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.01, 2000)
  ortho.position.copy(camera.position)
  ortho.up.copy(camera.up)
  ortho.lookAt(controls.target)
  ortho.updateProjectionMatrix()
  controls.object = ortho
  camera = ortho
  cameraOrtho = ortho
  controls.update()
  cameraIsOrtho.value = true
}

function setCameraPersp() {
  if (!cameraIsOrtho.value || !cameraPersp) return
  cameraPersp.position.copy(camera.position)
  cameraPersp.up.copy(camera.up)
  cameraPersp.near = Math.max(0.01, modelRadius / 500)
  cameraPersp.far  = Math.max(2000, modelRadius * 200)
  cameraPersp.aspect = renderer.domElement.clientWidth / renderer.domElement.clientHeight
  cameraPersp.updateProjectionMatrix()
  controls.object = cameraPersp
  camera = cameraPersp
  cameraOrtho = null
  controls.update()
  cameraIsOrtho.value = false
}

// ─── Edit actions ──────────────────────────────────────────────────────────
function deleteSelected() {
  if (!selectedMesh.value || !scene) return
  const obj = selectedMesh.value
  clearHighlight()
  if (obj.parent) obj.parent.remove(obj)
  obj.geometry?.dispose?.()
  const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
  mats.forEach((m: any) => m?.dispose?.())
}

function selectAllMeshes() {
  if (!scene || !currentModel) return
  clearHighlight()
  currentModel.traverse((obj: any) => {
    if (!obj.isMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    mats.forEach((m: any) => {
      if (!m) return
      origEmissiveMap.set(m, { r: m.emissive?.r ?? 0, g: m.emissive?.g ?? 0, b: m.emissive?.b ?? 0, i: m.emissiveIntensity ?? 1 })
      if (m.emissive) m.emissive.setHex(0x2266ee)
      m.emissiveIntensity = 0.25
      m.needsUpdate = true
    })
  })
}

function exportCurrentModel() {
  if (!pendingModelFile) { statusText.value = "ไม่มีโมเดลที่เปิดอยู่"; return }
  const url = URL.createObjectURL(pendingModelFile)
  const a   = document.createElement("a")
  a.href     = url
  a.download = pendingModelFile.name
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Menu dispatcher ───────────────────────────────────────────────────────
function menuAction(action: string) {
  closeMenus()

  // ── File ──
  if (action === "New") {
    clearCurrentModel(); clearLocalFileMap()
    statusText.value = "Ready"; selectedFileName.value = ""
  }
  if (action === "Open..." || action === "Import...") openFilePicker()
  if (action === "Save")      saveCurrentProject()
  if (action === "Save As...") showProjectPanel.value = true
  if (action === "Export...") exportCurrentModel()
  if (action === "Print")     window.print()
  if (action === "Exit")      window.close()

  // ── Edit ──
  if (action === "Undo")        document.execCommand("undo")
  if (action === "Redo")        document.execCommand("redo")
  if (action === "Delete")      deleteSelected()
  if (action === "Select All")  selectAllMeshes()
  if (action === "Deselect All") { clearHighlight(); selectedMesh.value = null; selectedInfo.value = null }

  // ── View ──
  if (action === "Face Style")  toggleWireframe()
  if (action === "Shadows")     toggleShadows()
  if (action === "Fog")         toggleFog()

  // ── Camera ──
  if (action === "Standard Views")      setStandardView("iso")
  if (action === "Parallel Projection") setCameraOrtho()
  if (action === "Perspective")         setCameraPersp()
  if (action === "Previous")            resetView()

  // ── Tools ──
  if (action === "Select")    activeTool.value = "select"
  if (action === "Eraser")    activeTool.value = "eraser"
  if (action === "Move")      activeTool.value = "move"
  if (action === "Rotate")    activeTool.value = "rotate"
  if (action === "Scale")     activeTool.value = "scale"
  if (action === "Push/Pull") activeTool.value = "pushpull"

  // ── Window ──
  if (action === "Outliner")   leftTab.value = "outliner"
  if (action === "Layers")     leftTab.value = "layers"
  if (action === "Entity Info") rightTab.value = "entity"
  if (action === "Styles")     rightTab.value = "styles"
  if (action === "Model Info") showAbout.value = true

  // ── Help ──
  if (action === "About SketchUp")   showAbout.value = true
}

async function importWithFallback(paths: string[]) {
  let lastErr: any
  for (const p of paths) {
    try {
      return await import(/* @vite-ignore */ p)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error("CDN import failed")
}

async function initThree() {
  if (viewerReady.value) return

  THREE = await importWithFallback([
    "https://esm.sh/three@0.160.0",
    "https://unpkg.com/three@0.160.0/build/three.module.js?module",
  ])
  const { OrbitControls } = await importWithFallback([
    "https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js",
    "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js?module",
  ])
  const { GLTFLoader } = await importWithFallback([
    "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js",
    "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js?module",
  ])
  const { DRACOLoader } = await importWithFallback([
    "https://esm.sh/three@0.160.0/examples/jsm/loaders/DRACOLoader.js",
    "https://unpkg.com/three@0.160.0/examples/jsm/loaders/DRACOLoader.js?module",
  ])
  const { KTX2Loader } = await importWithFallback([
    "https://esm.sh/three@0.160.0/examples/jsm/loaders/KTX2Loader.js",
    "https://unpkg.com/three@0.160.0/examples/jsm/loaders/KTX2Loader.js?module",
  ])
  const { MeshoptDecoder } = await importWithFallback([
    "https://esm.sh/three@0.160.0/examples/jsm/libs/meshopt_decoder.module.js",
    "https://unpkg.com/three@0.160.0/examples/jsm/libs/meshopt_decoder.module.js?module",
  ])
  const { RoomEnvironment } = await importWithFallback([
    "https://esm.sh/three@0.160.0/examples/jsm/environments/RoomEnvironment.js",
    "https://unpkg.com/three@0.160.0/examples/jsm/environments/RoomEnvironment.js?module",
  ])

  if (!viewport.value) return

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xdce8f2)

  camera = new THREE.PerspectiveCamera(45, 1, 0.01, 2000)
  camera.position.set(...defaultCamPos)
  cameraPersp = camera   // เก็บ reference perspective ไว้ใช้ตอน switch กลับ

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  viewport.value.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.target.set(...defaultTarget)
  controls.minDistance = 1
  controls.maxDistance = 400

  const hemi = new THREE.HemisphereLight(0xffffff, 0x6f7f8f, 1.15)
  scene.add(hemi)

  const dir = new THREE.DirectionalLight(0xffffff, 1.25)
  dir.position.set(6, 12, 8)
  dir.castShadow = true
  dir.shadow.mapSize.set(2048, 2048)
  scene.add(dir)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshStandardMaterial({ color: 0xc8d8e4, roughness: 0.94, metalness: 0.0 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.01
  ground.receiveShadow = true
  scene.add(ground)
  groundMesh = ground

  // Grid helper
  const gridHelper = new THREE.GridHelper(200, 40, 0x9ab0c0, 0xb8ccd8)
  gridHelper.position.y = 0
  scene.add(gridHelper)

  // Axes helper
  const axesHelper = new THREE.AxesHelper(3)
  scene.add(axesHelper)

  pmrem = new THREE.PMREMGenerator(renderer)
  const env = new RoomEnvironment(renderer)
  scene.environment = pmrem.fromScene(env).texture

  loadingManager = new THREE.LoadingManager()
  loadingManager.setURLModifier((url: string) => {
    const clean = decodeURIComponent(url).replace(/^(\.\/|\/)+/, "")
    const byFull = localFileMap.get(clean)
    if (byFull) return byFull

    const tail = clean.split("/").pop() || clean
    const byName = localFileMap.get(tail)
    if (byName) return byName
    return url
  })

  loader = new GLTFLoader(loadingManager)

  const draco = new DRACOLoader()
  draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/")
  loader.setDRACOLoader(draco)

  const ktx2 = new KTX2Loader()
  ktx2.setTranscoderPath("https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/basis/")
  ktx2.detectSupport(renderer)
  loader.setKTX2Loader(ktx2)

  loader.setMeshoptDecoder(MeshoptDecoder)

  fitRenderer()

  resizeObserver = new ResizeObserver(() => fitRenderer())
  resizeObserver.observe(viewport.value)
  renderer.domElement.addEventListener("pointerdown", onViewportPointerDown)
  renderer.domElement.addEventListener("pointermove", onViewportPointerMove)
  renderer.domElement.addEventListener("pointerup", onViewportPointerUp)

  const animate = () => {
    rafId = requestAnimationFrame(animate)
    controls.update()
    updateWallTransparencyByCamera()
    renderer.render(scene, camera)
    // Update mouse-track coords from camera target
    if (controls) {
      const t = controls.target
      mouseCoords.value = {
        x: t.x.toFixed(3),
        y: t.y.toFixed(3),
        z: t.z.toFixed(3),
      }
    }
  }
  animate()
  viewerReady.value = true
}

function getRaycastHit(clientX: number, clientY: number) {
  if (!renderer || !camera || !THREE) return null
  const rect = renderer.domElement.getBoundingClientRect()
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null

  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )

  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(ndc, camera)

  const targets: any[] = []
  if (currentModel) targets.push(currentModel)
  if (groundMesh) targets.push(groundMesh)
  if (targets.length === 0) return null

  const hits = raycaster.intersectObjects(targets, true)
  for (const hit of hits) {
    const obj = hit.object
    if (obj?.userData?.__isLightMarker) continue
    return hit
  }
  return null
}

function createLightDevice(clientX: number, clientY: number) {
  if (!scene || !THREE) return
  const hit = getRaycastHit(clientX, clientY)
  if (!hit) {
    statusText.value = "วางไฟไม่สำเร็จ: ไม่พบพื้นผิว"
    return
  }

  const deviceId = lightIdSeed++
  const markerSize = Math.max(modelRadius * 0.035, 0.07)
  const lift = markerSize * 0.45

  const normal = new THREE.Vector3(0, 1, 0)
  if (hit.face) {
    normal.copy(hit.face.normal)
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)
    normal.applyMatrix3(normalMatrix).normalize()
  }

  const basePosition = hit.point.clone().add(normal.multiplyScalar(lift))
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(markerSize, 20, 20),
    new THREE.MeshStandardMaterial({
      color: 0xffd773,
      emissive: 0xffd773,
      emissiveIntensity: 0.9,
      roughness: 0.35,
      metalness: 0.1,
    }),
  )
  marker.castShadow = true
  marker.receiveShadow = false

  const pointLightOnIntensity = 2.8
  const pointLightOffIntensity = 0
  const pointLight = new THREE.PointLight(0xfff2bf, pointLightOnIntensity, Math.max(modelRadius * 2.8, 6), 2)
  pointLight.position.set(0, markerSize * 1.8, 0)
  pointLight.castShadow = true
  pointLight.shadow.mapSize.set(1024, 1024)

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(markerSize * 0.12, markerSize * 0.12, markerSize * 1.15, 14),
    new THREE.MeshStandardMaterial({ color: 0x8b8b8b, roughness: 0.8, metalness: 0.25 }),
  )
  pole.position.y = -markerSize * 0.6

  const aura = new THREE.Mesh(
    new THREE.SphereGeometry(markerSize * 5.6, 28, 28),
    new THREE.MeshBasicMaterial({
      color: 0xfff4c2,
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  aura.position.y = markerSize * 1.6

  const roomFill = new THREE.AmbientLight(0xfff1c1, 0.18)
  const roomFillOnIntensity = 0.18
  const roomFillOffIntensity = 0

  const root = new THREE.Group()
  root.position.copy(basePosition)
  root.add(marker)
  root.add(pole)
  root.add(aura)
  root.add(pointLight)
  root.add(roomFill)
  root.userData.__isLightRoot = true
  root.userData.__deviceId = deviceId
  marker.userData.__isLightMarker = true
  marker.userData.__deviceId = deviceId
  pole.userData.__isLightMarker = true
  pole.userData.__deviceId = deviceId
  aura.userData.__isLightMarker = true
  aura.userData.__deviceId = deviceId
  aura.userData.__skipLightPick = true
  scene.add(root)

  lightDeviceMap.set(deviceId, {
    id: deviceId,
    root,
    marker,
    aura,
    pointLight,
    pointLightOnIntensity,
    pointLightOffIntensity,
    roomFill,
    roomFillOnIntensity,
    roomFillOffIntensity,
    on: true,
  })
  lightDevices.value = [...lightDevices.value, { id: deviceId, name: `Light ${deviceId}`, on: true }]
  statusText.value = `Placed Light ${deviceId}`
}

function setLightState(deviceId: number, on: boolean) {
  const device = lightDeviceMap.get(deviceId)
  if (!device) return
  device.on = on
  device.pointLight.intensity = on ? device.pointLightOnIntensity : device.pointLightOffIntensity
  device.roomFill.intensity = on ? device.roomFillOnIntensity : device.roomFillOffIntensity
  device.aura.material.opacity = on ? 0.26 : 0
  device.aura.scale.setScalar(on ? 1 : 0.55)
  device.marker.material.emissiveIntensity = on ? 0.9 : 0.08
  device.marker.material.color.setHex(on ? 0xffd773 : 0x7d7d7d)
  lightDevices.value = lightDevices.value.map((x) => (x.id === deviceId ? { ...x, on } : x))
}

function toggleLightState(deviceId: number) {
  const device = lightDeviceMap.get(deviceId)
  if (!device) return
  setLightState(deviceId, !device.on)
}

function removeLightDevice(deviceId: number) {
  const device = lightDeviceMap.get(deviceId)
  if (!device) return

  scene?.remove(device.root)
  device.root.traverse((obj: any) => {
    if (obj.geometry) obj.geometry.dispose?.()
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose?.())
      else obj.material.dispose?.()
    }
    if (obj.isLight) obj.dispose?.()
  })
  if (device.pointLight?.shadow?.map) device.pointLight.shadow.map.dispose?.()

  lightDeviceMap.delete(deviceId)
  lightDevices.value = lightDevices.value.filter((x) => x.id !== deviceId)
  statusText.value = `Removed Light ${deviceId}`
}

function pickLightFromPoint(clientX: number, clientY: number) {
  if (!renderer || !camera || !THREE) return null
  const rect = renderer.domElement.getBoundingClientRect()
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null

  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(ndc, camera)

  const roots = Array.from(lightDeviceMap.values()).map((x) => x.root)
  if (roots.length === 0) return null
  const hits = raycaster.intersectObjects(roots, true)
  for (const hit of hits) {
    if (hit.object?.userData?.__skipLightPick) continue
    const id = hit.object?.userData?.__deviceId ?? hit.object?.parent?.userData?.__deviceId
    if (typeof id === "number") return id
  }
  return null
}

function onViewportPointerDown(e: PointerEvent) {
  pointerDownMoved = false
  pointerDownX = e.clientX
  pointerDownY = e.clientY
}

function onViewportPointerMove(e: PointerEvent) {
  const dx = e.clientX - pointerDownX
  const dy = e.clientY - pointerDownY
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) pointerDownMoved = true
}

function onViewportPointerUp(e: PointerEvent) {
  if (pointerDownMoved) return
  // Light click first
  const id = pickLightFromPoint(e.clientX, e.clientY)
  if (id != null) { toggleLightState(id); return }
  // Mesh selection for takeoff
  if (hasModel.value) pickAndSelect(e.clientX, e.clientY)
}

function onLightDragStart(e: DragEvent) {
  e.dataTransfer?.setData("text/plain", "smart-light")
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy"
  dragLightActive.value = true
  dragLightHint.value = "ปล่อยเมาส์บนโมเดลเพื่อวางหลอดไฟ"
}

function onLightDragEnd() {
  dragLightActive.value = false
  dragLightHint.value = "ลากไอคอนหลอดไฟไปวางบนโมเดล"
}

function onViewportDragOver(e: DragEvent) {
  e.preventDefault()
  if (dragLightActive.value) return
  if (e.dataTransfer?.types.includes("Files")) isDragOverFiles.value = true
}

function onViewportDragLeave() {
  isDragOverFiles.value = false
}

function onViewportDrop(e: DragEvent) {
  e.preventDefault()
  isDragOverFiles.value = false

  if (dragLightActive.value) {
    createLightDevice(e.clientX, e.clientY)
    dragLightActive.value = false
    dragLightHint.value = "ลากไอคอนหลอดไฟไปวางบนโมเดล"
    return
  }

  if (e.dataTransfer?.files.length) {
    handleFileList(Array.from(e.dataTransfer.files))
  }
}

function fitRenderer() {
  if (!viewport.value || !renderer || !camera) return
  const w = viewport.value.clientWidth
  const h = viewport.value.clientHeight
  renderer.setSize(w, h)
  if (camera.isPerspectiveCamera || !camera.isOrthographicCamera) {
    camera.aspect = w / h
  } else {
    // Ortho: ปรับ left/right/top/bottom ตาม aspect ใหม่
    const d = modelRadius * 3.5
    const aspect = w / h
    camera.left   = -d * aspect
    camera.right  =  d * aspect
    camera.top    =  d
    camera.bottom = -d
  }
  camera.updateProjectionMatrix()
}

function openFilePicker() {
  fileInput.value?.click()
}

async function onPickFile(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  input.value = "" // allow re-picking same file
  if (files.length === 0) return
  await handleFileList(files)
}

async function handleFileList(files: File[]) {
  errorText.value = ""

  // Detect .SKP — not supported natively, show conversion guide
  const skp = files.find((f) => f.name.toLowerCase().endsWith(".skp"))
  if (skp) {
    skpFileName.value = skp.name
    showSkpGuide.value = true
    return
  }

  // Detect other unsupported formats
  const modelFile =
    files.find((f) => f.name.toLowerCase().endsWith(".glb")) ||
    files.find((f) => f.name.toLowerCase().endsWith(".gltf"))

  if (!modelFile) {
    const ext = files[0]?.name.split(".").pop()?.toLowerCase() || "?"
    const knownConvertible = ["skp", "fbx", "obj", "dae", "3ds", "stl", "ply"]
    if (knownConvertible.includes(ext)) {
      errorText.value = `.${ext} ต้องแปลงเป็น .glb ก่อน — ดูวิธีแปลงในเมนู Help`
    } else {
      errorText.value = `ไม่รองรับ .${ext} · รองรับ: .glb, .gltf (+ texture files)`
    }
    statusText.value = "Failed"
    return
  }

  statusText.value = "Loading..."
  if (!viewerReady.value) {
    try {
      initPromise ||= initThree()
      await initPromise
    } catch (err: any) {
      errorText.value = `Viewer init failed: ${err?.message || err}`
      statusText.value = "Failed"
      return
    }
  }

  clearLocalFileMap()
  for (const f of files) {
    const url = URL.createObjectURL(f)
    objectUrlPool.push(url)
    const rel = (f as any).webkitRelativePath
      ? String((f as any).webkitRelativePath).replace(/\\/g, "/")
      : f.name
    localFileMap.set(rel, url)
    localFileMap.set(rel.replace(/^.*\//, ""), url)
  }

  selectedFileName.value = modelFile.name
  loadedAssetCount.value = files.length
  pendingModelFile = modelFile
  saveSuccess.value = false

  isLoading.value = true
  loadingProgress.value = 0
  errorText.value = ""

  try {
    // ── Step 1: อ่านไฟล์ ──
    loadingStep.value = "กำลังอ่านไฟล์…"
    loadingProgress.value = 10
    const ab = await modelFile.arrayBuffer()
    loadingProgress.value = 30

    // ── Step 2: โหลด Three.js ──
    loadingStep.value = "กำลังประมวลผลโมเดล 3D…"
    await loadModelFromArrayBuffer(ab, modelFile.name)
    loadingProgress.value = 70
    statusText.value = "Loaded"

    // ── Step 3: สรุปรายการถอดแบบ (local memory เท่านั้น) ──
    loadingStep.value = "สรุปรายการถอดแบบ…"
    takeoff.clearLocal()
    autoExtractLocalTakeoff()
    loadingProgress.value = 100

  } catch (err: any) {
    errorText.value = err?.message || "Load failed"
    statusText.value = "Failed"
  } finally {
    isLoading.value = false
    loadingStep.value = ""
  }
}

function clearCurrentModel() {
  if (currentModel) {
    scene.remove(currentModel)
    currentModel.traverse((obj: any) => {
      if (obj.geometry) obj.geometry.dispose?.()
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose?.())
        else obj.material.dispose?.()
      }
    })
    currentModel = null
    hasModel.value = false
  }
  for (const deviceId of Array.from(lightDeviceMap.keys())) removeLightDevice(deviceId)
  origEmissiveMap.clear()
  selectedMesh.value = null
  selectedInfo.value = null
}

function clearLocalFileMap() {
  localFileMap.clear()
  for (const url of objectUrlPool) URL.revokeObjectURL(url)
  objectUrlPool.length = 0
}

async function loadModelFromArrayBuffer(ab: ArrayBuffer, fileName: string) {
  if (!loader) throw new Error("Viewer is not ready")

  clearCurrentModel()

  const path = fileName.toLowerCase().endsWith(".gltf") ? "./" : ""

  const gltf = await new Promise<any>((resolve, reject) => {
    loader.parse(
      ab,
      path,
      (data: any) => resolve(data),
      (err: any) => reject(err),
    )
  })

  currentModel = gltf.scene || gltf.scenes?.[0]
  if (!currentModel) throw new Error("No scene in model")

  currentModel.traverse((obj: any) => {
    if (!obj.isMesh) return
    obj.castShadow = true
    obj.receiveShadow = true
    if (!obj.geometry.attributes?.normal) obj.geometry.computeVertexNormals?.()

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    mats.forEach((m: any) => {
      if (!m) return
      m.side = THREE.DoubleSide
      m.needsUpdate = true
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace
      if (m.emissiveMap) m.emissiveMap.colorSpace = THREE.SRGBColorSpace
      if (typeof m.metalness === "number" && m.metalness > 0.9) m.metalness = 0.65
      if (typeof m.roughness === "number" && m.roughness < 0.05) m.roughness = 0.18
      if (!m.userData) m.userData = {}
      if (!m.userData.__orig) {
        m.userData.__orig = {
          transparent: !!m.transparent,
          opacity: typeof m.opacity === "number" ? m.opacity : 1,
          depthWrite: m.depthWrite !== false,
          depthTest: m.depthTest !== false,
          color: m.color ? [m.color.r, m.color.g, m.color.b] : null,
          emissive: m.emissive ? [m.emissive.r, m.emissive.g, m.emissive.b] : null,
          metalness: typeof m.metalness === "number" ? m.metalness : null,
          roughness: typeof m.roughness === "number" ? m.roughness : null,
        }
      }
    })
  })
  scene.add(currentModel)
  hasModel.value = true
  frameModel(currentModel)
  applyWallTransparency()
}

function isWallLikeMaterial(m: any) {
  if (!m) return false
  const name = String(m.name || "").toLowerCase()
  if (name.includes("glass") || name.includes("window") || name.includes("metal") || name.includes("chrome")) return false
  if (name.includes("wood") || name.includes("fabric") || name.includes("sofa") || name.includes("chair") || name.includes("table")) return false
  if (m.transparent && typeof m.opacity === "number" && m.opacity < 0.9) return false
  if (!m.color) return false

  const hasTexture = !!(m.map || m.normalMap || m.roughnessMap || m.metalnessMap || m.emissiveMap || m.aoMap)
  if (hasTexture) return false
  const r = m.color.r ?? 1
  const g = m.color.g ?? 1
  const b = m.color.b ?? 1
  const spread = Math.max(r, g, b) - Math.min(r, g, b)
  const brightness = (r + g + b) / 3

  return spread < 0.12 && brightness > 0.2
}

function isLikelyWallMesh(obj: any, m: any) {
  const n = String(obj?.name || "").toLowerCase()
  if (n.includes("wall") || n.includes("partition") || n.includes("facade") || n.includes("exterior")) return true
  if (n.includes("chair") || n.includes("table") || n.includes("sofa") || n.includes("bed") || n.includes("plant")) return false

  if (!obj?.geometry) return false
  if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox?.()
  const bb = obj.geometry.boundingBox
  if (!bb) return false

  const s = new THREE.Vector3()
  bb.getSize(s)
  const dims = [Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)].sort((a, b) => a - b) as [number, number, number]
  const [shortest, mid, longest] = dims
  const thinRatio = shortest / Math.max(longest, 0.0001)
  const largeEnough = longest > modelRadius * 0.45 || mid > modelRadius * 0.25

  if (largeEnough && thinRatio < 0.11 && isWallLikeMaterial(m)) return true
  return false
}

function applyWallTransparency() {
  if (!currentModel) return
  const occluders = wallTransparentOn.value ? collectCameraOccluderMeshes() : new Set<any>()

  currentModel.traverse((obj: any) => {
    if (!obj.isMesh || !obj.material || !obj.geometry) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]

    mats.forEach((m: any) => {
      if (!m?.userData?.__orig) return
      const orig = m.userData.__orig
      const wallLike = isLikelyWallMesh(obj, m)
      const occludingCamera = occluders.has(obj)

      if (!(wallTransparentOn.value && (wallLike || occludingCamera))) {
        m.transparent = orig.transparent
        m.opacity = orig.opacity
        m.depthWrite = orig.depthWrite
        m.depthTest = orig.depthTest
        if (orig.color && m.color) m.color.setRGB(orig.color[0], orig.color[1], orig.color[2])
        if (orig.emissive && m.emissive) m.emissive.setRGB(orig.emissive[0], orig.emissive[1], orig.emissive[2])
        if (typeof orig.metalness === "number") m.metalness = orig.metalness
        if (typeof orig.roughness === "number") m.roughness = orig.roughness
        m.needsUpdate = true
        return
      }

      m.transparent = true
      m.opacity = 0.17
      m.depthWrite = false
      m.depthTest = true
      if (m.color) m.color.setRGB(0.86, 0.92, 0.98)
      if (m.emissive) m.emissive.setRGB(0.0, 0.0, 0.0)
      if (typeof m.metalness === "number") m.metalness = 0.02
      if (typeof m.roughness === "number") m.roughness = 0.04
      if (typeof m.ior === "number") m.ior = 1.5
      if (typeof m.transmission === "number") m.transmission = 0.65
      if (typeof m.thickness === "number") m.thickness = 0.02
      m.needsUpdate = true
    })
  })
}

function collectCameraOccluderMeshes() {
  const result = new Set<any>()
  if (!currentModel || !camera || !controls || !THREE) return result

  const target = controls.target.clone()
  const camToTarget = target.clone().sub(camera.position)
  const focusDistance = camToTarget.length()
  if (focusDistance < 0.001) return result

  const raycaster = new THREE.Raycaster()
  const samples = [-0.42, -0.22, 0, 0.22, 0.42]
  const maxHitDistance = focusDistance * 0.95

  for (const sx of samples) {
    for (const sy of samples) {
      const ndc = new THREE.Vector2(sx, sy)
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObject(currentModel, true)
      let taken = 0
      for (const hit of hits) {
        if (hit.distance > maxHitDistance) break
        if (hit.object?.isMesh) {
          result.add(hit.object)
          taken += 1
          if (taken >= 2) break
        }
      }
    }
  }

  return result
}

function updateWallTransparencyByCamera(force = false) {
  if (!wallTransparentOn.value || !camera || !controls || !currentModel) return
  const sig = `${camera.position.x.toFixed(2)}|${camera.position.y.toFixed(2)}|${camera.position.z.toFixed(2)}|${controls.target.x.toFixed(2)}|${controls.target.y.toFixed(2)}|${controls.target.z.toFixed(2)}`
  if (!force && sig === lastWallSig) return
  lastWallSig = sig
  applyWallTransparency()
}

function toggleWallTransparency() {
  wallTransparentOn.value = !wallTransparentOn.value
  lastWallSig = ""
  applyWallTransparency()
}

function frameModel(root: any) {
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  modelRadius = Math.max(sphere.radius, 0.5)

  const outsideDir = new THREE.Vector3(1, 0.55, 1).normalize()
  const dist = modelRadius * 3.2
  const targetY = center.y + size.y * 0.1

  camera.position.copy(center.clone().add(outsideDir.multiplyScalar(dist)))
  controls.target.set(center.x, targetY, center.z)
  controls.minDistance = modelRadius * 1.15
  controls.maxDistance = modelRadius * 18
  camera.near = Math.max(0.01, modelRadius / 500)
  camera.far = Math.max(2000, modelRadius * 200)
  camera.updateProjectionMatrix()
  controls.update()

  defaultCamPos = [camera.position.x, camera.position.y, camera.position.z]
  defaultTarget = [center.x, targetY, center.z]
}

function resetView() {
  if (!camera || !controls) return
  camera.position.set(...defaultCamPos)
  controls.target.set(...defaultTarget)
  controls.update()
}

function setStandardView(view: 'top' | 'front' | 'back' | 'right' | 'left' | 'iso') {
  if (!camera || !controls || !THREE) return
  const t = controls.target.clone()
  const d = modelRadius * 3.5
  let px = t.x, py = t.y, pz = t.z
  let ux = 0, uy = 1, uz = 0
  switch (view) {
    case 'top':   px = t.x; py = t.y + d; pz = t.z;       ux = 0; uy = 0; uz = -1; break
    case 'front': px = t.x; py = t.y + d * 0.08; pz = t.z + d; break
    case 'back':  px = t.x; py = t.y + d * 0.08; pz = t.z - d; break
    case 'right': px = t.x + d; py = t.y + d * 0.08; pz = t.z; break
    case 'left':  px = t.x - d; py = t.y + d * 0.08; pz = t.z; break
    case 'iso':   px = t.x + d * 0.7; py = t.y + d * 0.55; pz = t.z + d * 0.7; break
  }
  camera.position.set(px, py, pz)
  camera.up.set(ux, uy, uz)
  controls.update()
}

// ─── Selection & Highlight ───────────────────────────────────────────────────
function highlightMesh(obj: any) {
  const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
  mats.forEach((m: any) => {
    if (!m) return
    origEmissiveMap.set(m, {
      r: m.emissive?.r ?? 0,
      g: m.emissive?.g ?? 0,
      b: m.emissive?.b ?? 0,
      i: m.emissiveIntensity ?? 1,
    })
    if (m.emissive) m.emissive.setHex(0x2266ee)
    m.emissiveIntensity = 0.4
    m.needsUpdate = true
  })
}

function clearHighlight() {
  if (!selectedMesh.value) return
  const mats = Array.isArray(selectedMesh.value.material)
    ? selectedMesh.value.material
    : [selectedMesh.value.material]
  mats.forEach((m: any) => {
    const orig = origEmissiveMap.get(m)
    if (!orig || !m) return
    if (m.emissive) m.emissive.setRGB(orig.r, orig.g, orig.b)
    m.emissiveIntensity = orig.i
    m.needsUpdate = true
  })
  origEmissiveMap.clear()
  selectedMesh.value = null
  selectedInfo.value = null
}

function pickAndSelect(clientX: number, clientY: number) {
  if (!THREE || !renderer || !camera) return
  clearHighlight()
  aiPrice.reset()   // ล้างผล AI ของชิ้นก่อนหน้า
  const hit = getRaycastHit(clientX, clientY)
  if (!hit || hit.object === groundMesh || hit.object?.userData?.__isLightMarker) return

  const obj = hit.object
  selectedMesh.value = obj
  highlightMesh(obj)

  // Compute bounding box in world space
  if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox()
  const bbLocal = obj.geometry.boundingBox!
  const ws = new THREE.Vector3()
  obj.getWorldScale(ws)
  const w = Math.abs((bbLocal.max.x - bbLocal.min.x) * ws.x)
  const h = Math.abs((bbLocal.max.y - bbLocal.min.y) * ws.y)
  const d = Math.abs((bbLocal.max.z - bbLocal.min.z) * ws.z)
  const area = parseFloat((w * d + 2 * (w * h + d * h)).toFixed(3))
  const volume = parseFloat((w * h * d).toFixed(4))
  const matName = Array.isArray(obj.material) ? obj.material[0]?.name : obj.material?.name
  const rawName: string = obj.name || obj.parent?.name || "Component"

  selectedInfo.value = { name: rawName, dims: { w, h, d }, area, volume, matName: matName || "—" }

  // Auto-fill form
  const n = rawName.toLowerCase()
  const shortest = Math.min(w, h, d)
  const longest = Math.max(w, h, d)
  const thinRatio = shortest / (longest || 1)

  if (n.includes("wall") || n.includes("ผนัง") || (thinRatio < 0.15 && longest > 0.5)) {
    tfCategory.value = "งานผนัง"; tfUnit.value = "ตร.ม."; tfUnitPrice.value = 650
    tfQty.value = parseFloat(((w || d) * h || area).toFixed(2))
  } else if (n.includes("floor") || n.includes("slab") || n.includes("พื้น")) {
    tfCategory.value = "งานพื้น"; tfUnit.value = "ตร.ม."; tfUnitPrice.value = 480
    tfQty.value = parseFloat((w * d).toFixed(2))
  } else if (n.includes("roof") || n.includes("ceiling") || n.includes("หลังคา")) {
    tfCategory.value = "งานหลังคา"; tfUnit.value = "ตร.ม."; tfUnitPrice.value = 750
    tfQty.value = parseFloat((w * d).toFixed(2))
  } else if (n.includes("column") || n.includes("beam") || n.includes("คาน") || n.includes("เสา")) {
    tfCategory.value = "งานโครงสร้าง"; tfUnit.value = "ลบ.ม."; tfUnitPrice.value = 8500
    tfQty.value = parseFloat(volume.toFixed(3))
  } else if (n.includes("window") || n.includes("door") || n.includes("ประตู") || n.includes("หน้าต่าง")) {
    tfCategory.value = "งานประตู-หน้าต่าง"; tfUnit.value = "ชุด"; tfUnitPrice.value = 12000
    tfQty.value = 1
  } else if (n.includes("light") || n.includes("lamp") || n.includes("ไฟ")) {
    tfCategory.value = "งานไฟฟ้า"; tfUnit.value = "จุด"; tfUnitPrice.value = 2500
    tfQty.value = 1
  } else {
    tfCategory.value = "งานสถาปัตย์"; tfUnit.value = "ตร.ม."; tfUnitPrice.value = 500
    tfQty.value = parseFloat(area.toFixed(2))
  }
  tfName.value = rawName
  rightTab.value = "takeoff"
}

// ─── Takeoff CRUD ─────────────────────────────────────────────────────────────
const currentProjectId = computed(() => project.currentProject.value?.id ?? "")

function addToTakeoff() {
  if (!selectedInfo.value) return
  const d = selectedInfo.value.dims
  takeoff.addLocal({
    name: tfName.value || selectedInfo.value.name,
    category: tfCategory.value,
    qty: tfQty.value,
    unit: tfUnit.value,
    unitPrice: tfUnitPrice.value,
    dimsLabel: `${fmt(d.w)}×${fmt(d.h)}×${fmt(d.d)} ม.`,
  })
  saveSuccess.value = false
}

async function removeTakeoffItem(id: string) {
  deletingId.value = id
  if (id.startsWith("local-")) {
    takeoff.removeLocal(id)
  } else {
    await takeoff.removeFromDB(id)
  }
  deletingId.value = null
  saveSuccess.value = false
}

function clearTakeoff() {
  takeoff.clearLocal()
  saveSuccess.value = false
}

// ── บันทึกโปรเจกต์ (upload ไฟล์ + save DB) ──────────────────────────────────
function saveCurrentProject() {
  if (!pendingModelFile && !project.currentProject.value) return

  // ถ้ายังไม่มี project record → เปิด modal ให้ตั้งชื่อก่อน
  if (!project.currentProject.value) {
    pendingProjectName.value = pendingModelFile
      ? pendingModelFile.name.replace(/\.[^.]+$/, "")
      : ""
    showSaveModal.value = true
    return
  }

  // มี project อยู่แล้ว → บันทึกทันที (ไม่ต้องตั้งชื่อใหม่)
  doSave("")
}

async function doSave(customName: string) {
  if (!pendingModelFile && !project.currentProject.value) return
  isSavingProject.value = true
  saveSuccess.value = false
  statusText.value = "Saving…"

  try {
    let proj = project.currentProject.value

    // ถ้ายังไม่มี project record → upload + create
    if (!proj) {
      if (!pendingModelFile) return
      loadingStep.value = "กำลัง upload โมเดล…"
      proj = await project.uploadModel(pendingModelFile, customName)
      if (!proj) {
        statusText.value = "Upload failed"
        return
      }
    }

    // บันทึก takeoff items ทั้งหมดลง DB
    loadingStep.value = "กำลังบันทึกรายการ…"
    const ok = await takeoff.saveAllToDB(proj.id)
    if (!ok) {
      statusText.value = "Save failed"
      return
    }

    statusText.value = "Saved"
    saveSuccess.value = true
    pendingModelFile = null
  } finally {
    isSavingProject.value = false
    loadingStep.value = ""
  }
}

async function confirmSaveModal() {
  showSaveModal.value = false
  await doSave(pendingProjectName.value)
}

// ── Auto-extract ALL meshes from loaded model ─────────────────────────────────
function getMeshInfo(obj: any) {
  if (!THREE || !obj?.isMesh || !obj.geometry) return null
  if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox()
  const bb = obj.geometry.boundingBox
  if (!bb) return null

  const ws = new THREE.Vector3()
  obj.getWorldScale(ws)
  const w = Math.abs((bb.max.x - bb.min.x) * ws.x)
  const h = Math.abs((bb.max.y - bb.min.y) * ws.y)
  const d = Math.abs((bb.max.z - bb.min.z) * ws.z)
  if (w < 0.001 && h < 0.001 && d < 0.001) return null

  const area   = parseFloat((w * d + 2 * (w * h + d * h)).toFixed(3))
  const volume = parseFloat((w * h * d).toFixed(4))
  const name   = String(obj.name || obj.parent?.name || "Component")
  const n      = name.toLowerCase()
  const shortest = Math.min(w, h, d)
  const longest  = Math.max(w, h, d)
  const thinRatio = shortest / (longest || 1)

  let category = "งานสถาปัตย์", unit = "ตร.ม.", unitPrice = 500
  let qty = parseFloat(area.toFixed(2))

  if (n.includes("wall") || n.includes("ผนัง") || (thinRatio < 0.15 && longest > 0.5)) {
    category = "งานผนัง"; unit = "ตร.ม."; unitPrice = 650
    qty = parseFloat(((w || d) * h || area).toFixed(2))
  } else if (n.includes("floor") || n.includes("slab") || n.includes("พื้น")) {
    category = "งานพื้น"; unit = "ตร.ม."; unitPrice = 480
    qty = parseFloat((w * d).toFixed(2))
  } else if (n.includes("roof") || n.includes("ceiling") || n.includes("หลังคา")) {
    category = "งานหลังคา"; unit = "ตร.ม."; unitPrice = 750
    qty = parseFloat((w * d).toFixed(2))
  } else if (n.includes("column") || n.includes("beam") || n.includes("คาน") || n.includes("เสา")) {
    category = "งานโครงสร้าง"; unit = "ลบ.ม."; unitPrice = 8500
    qty = parseFloat(volume.toFixed(3))
  } else if (n.includes("window") || n.includes("door") || n.includes("ประตู") || n.includes("หน้าต่าง")) {
    category = "งานประตู-หน้าต่าง"; unit = "ชุด"; unitPrice = 12000; qty = 1
  } else if (n.includes("light") || n.includes("lamp") || n.includes("ไฟ")) {
    category = "งานไฟฟ้า"; unit = "จุด"; unitPrice = 2500; qty = 1
  }

  return { name, category, qty, unit, unitPrice, dimsLabel: `${fmt(w)}×${fmt(h)}×${fmt(d)} ม.` }
}

function autoExtractLocalTakeoff() {
  if (!currentModel) return
  currentModel.traverse((obj: any) => {
    const info = getMeshInfo(obj)
    if (!info) return
    takeoff.addLocal(info)
  })
}

function printReport() {
  window.print()
}

// ── โหลดโปรเจกต์ที่บันทึกไว้ ──────────────────────────────────────────────────
async function loadSavedProject(proj: import("~/composables/useProject").BimProject) {
  // ── ตรวจ ownership ก่อนโหลด ──────────────────────────────────────────────
  const uid = currentUser.value?.id
  if (!uid || (proj.userId && proj.userId !== uid)) {
    errorText.value = "ไม่มีสิทธิ์เข้าถึงโปรเจกต์นี้"
    return
  }

  showProjectPanel.value = false
  isLoading.value = true
  loadingProgress.value = 0
  errorText.value = ""
  saveSuccess.value = false

  try {
    // ── Step 1: ดาวน์โหลดไฟล์โมเดล ──
    loadingStep.value = "กำลังดาวน์โหลดโมเดล…"
    loadingProgress.value = 10

    let ab: ArrayBuffer | null = null
    try {
      ab = await project.downloadModel(proj)
    } catch (fetchErr: any) {
      // project.error.value จะมีข้อความที่ละเอียดกว่า (set ใน downloadModel แล้ว)
      errorText.value = project.error.value || `ดาวน์โหลดโมเดลไม่ได้: ${fetchErr?.message || fetchErr}`
      statusText.value = "Failed"
      return
    }

    if (!ab) {
      errorText.value = project.error.value || "ดาวน์โหลดโมเดลไม่ได้ — กรุณาตรวจสอบ Supabase Storage"
      statusText.value = "Failed"
      return
    }
    loadingProgress.value = 50

    // ── Step 2: โหลด Three.js ──
    loadingStep.value = "กำลังประมวลผลโมเดล 3D…"
    selectedFileName.value = proj.modelName
    loadedAssetCount.value = 1
    pendingModelFile = null
    project.currentProject.value = proj

    try {
      await loadModelFromArrayBuffer(ab, proj.modelName)
    } catch (threeErr: any) {
      errorText.value = `โหลดโมเดลไม่ได้: ${threeErr?.message || threeErr}`
      statusText.value = "Failed"
      return
    }
    loadingProgress.value = 80
    statusText.value = "Loaded"
    saveSuccess.value = true

    // ── Step 3: โหลด takeoff จาก DB ──
    loadingStep.value = "โหลดรายการถอดแบบ…"
    await takeoff.loadFromDB(proj.id)
    loadingProgress.value = 100

  } catch (err: any) {
    errorText.value = err?.message || "Load failed"
    statusText.value = "Failed"
  } finally {
    isLoading.value = false
    loadingStep.value = ""
  }
}

onMounted(async () => {
  // ── init Three.js ──
  try {
    initPromise ||= initThree()
    await initPromise
    statusText.value = "Ready"
  } catch (err: any) {
    errorText.value = `Three.js init failed: ${err?.message || err}`
    statusText.value = "Failed"
    return
  }

  // ── โหลดรายการโปรเจกต์ (แยก error ออกจาก Three.js) ──
  try {
    await project.loadProjects()
  } catch {
    // ไม่ block การทำงาน — แค่ log
    console.warn("loadProjects failed:", project.error.value)
  }
})

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  resizeObserver?.disconnect()
  renderer?.domElement?.removeEventListener("pointerdown", onViewportPointerDown)
  renderer?.domElement?.removeEventListener("pointermove", onViewportPointerMove)
  renderer?.domElement?.removeEventListener("pointerup", onViewportPointerUp)
  clearCurrentModel()
  clearLocalFileMap()
  pmrem?.dispose?.()
  renderer?.dispose?.()
})
</script>

<template>
  <div class="skp-app" @click="closeMenus">
    <!-- ═══════════════════════════════════════ MENU BAR ═══════════════════════════════════════ -->
    <div class="skp-menubar" @click.stop>
      <div class="skp-brand">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#4a9eff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>BIM Viewer</span>
      </div>
      <div class="skp-menus">
        <div
          v-for="menu in menuItems"
          :key="menu.id"
          class="skp-menu-item"
          :class="{ active: activeMenu === menu.id }"
          @click="toggleMenu(menu.id)"
        >
          {{ menu.label }}
          <div v-if="activeMenu === menu.id" class="skp-dropdown" @click.stop>
            <template v-for="item in menu.items" :key="item">
              <div v-if="item === '---'" class="skp-dropdown-sep"></div>
              <button v-else class="skp-dropdown-item" :class="{ 'item-checked': menuItemChecked(item) }" @click="menuAction(item)">
                <span class="mi-check">{{ menuItemChecked(item) ? '✓' : '' }}</span>
                {{ item }}
              </button>
            </template>
          </div>
        </div>
      </div>
      <div class="skp-menubar-right">
        <span class="skp-status-badge" :class="statusText === 'Loaded' ? 'ok' : statusText === 'Failed' ? 'err' : 'idle'">
          {{ statusText }}
        </span>
        <div class="skp-user-chip">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          <span>{{ userLabel }}</span>
        </div>
        <!-- Management button — เฉพาะ super user เท่านั้น -->
        <NuxtLink
          v-if="isSuperUser"
          to="/management"
          class="skp-mgmt-btn"
          title="จัดการผู้ใช้งาน"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <span>Management</span>
        </NuxtLink>
        <button class="skp-logout-btn" title="ออกจากระบบ" @click="logout">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span>ออกจากระบบ</span>
        </button>
      </div>
    </div>

    <!-- ═══════════════════════════════════════ TOOLBAR ═══════════════════════════════════════ -->
    <div class="skp-toolbar">
      <div class="skp-toolbar-group">
        <button
          v-for="t in tools"
          :key="t.id"
          class="skp-tool-btn"
          :class="{ active: activeTool === t.id }"
          :title="t.title"
          @click="activeTool = t.id"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path :d="t.icon"/>
          </svg>
        </button>
      </div>

      <div class="skp-toolbar-sep"></div>

      <div class="skp-toolbar-group">
        <button
          v-for="t in viewTools"
          :key="t.id"
          class="skp-tool-btn"
          :class="{ active: activeTool === t.id }"
          :title="t.title"
          @click="activeTool = t.id"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path :d="t.icon"/>
          </svg>
        </button>
      </div>

      <div class="skp-toolbar-sep"></div>

      <div class="skp-toolbar-group">
        <button class="skp-tool-btn skp-tool-action" title="Open File (Ctrl+O)" @click="openFilePicker">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <span>Open</span>
        </button>
        <button
          class="skp-tool-btn skp-tool-action"
          :class="{ active: wallTransparentOn }"
          :disabled="!viewerReady || !hasModel"
          title="Toggle Wall Transparency (X)"
          @click="toggleWallTransparency"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" opacity="0.4"/>
          </svg>
          <span>X-Ray</span>
        </button>
        <button class="skp-tool-btn skp-tool-action" :disabled="!viewerReady" title="Reset View (V)" @click="resetView">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
          <span>Reset</span>
        </button>
      </div>

      <div class="skp-toolbar-sep"></div>

      <div class="skp-toolbar-group skp-toolbar-file-info">
        <span v-if="selectedFileName" class="skp-file-chip">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          {{ selectedFileName }}
        </span>
        <span v-if="loadedAssetCount" class="skp-file-chip skp-chip-dim">{{ loadedAssetCount }} assets</span>
      </div>
    </div>

    <!-- ═══════════════════════════════════════ MAIN AREA ══════════════════════════════════════ -->
    <div class="skp-main">

      <!-- LEFT PANEL -->
      <aside class="skp-left-panel">
        <div class="skp-panel-tabs">
          <button class="skp-panel-tab" :class="{ active: leftTab === 'outliner' }" @click="leftTab = 'outliner'">Outliner</button>
          <button class="skp-panel-tab" :class="{ active: leftTab === 'layers' }" @click="leftTab = 'layers'">Layers</button>
        </div>

        <!-- Outliner -->
        <div v-if="leftTab === 'outliner'" class="skp-panel-body">
          <div class="skp-outliner-search">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input type="text" placeholder="Filter..." class="skp-search-input" />
          </div>

          <div class="skp-tree">
            <div class="skp-tree-item skp-tree-root" @click="outlinerOpen = !outlinerOpen">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" class="skp-arrow" :class="{ open: outlinerOpen }">
                <path d="M9 18l6-6-6-6"/>
              </svg>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
              <span>{{ selectedFileName || 'Untitled Model' }}</span>
            </div>

            <template v-if="outlinerOpen">
              <div v-if="hasModel" class="skp-tree-children">
                <div class="skp-tree-item">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" class="skp-arrow open">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4a9eff" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                  </svg>
                  <span>Scene Root</span>
                </div>
                <div class="skp-tree-children skp-tree-l2">
                  <div class="skp-tree-item skp-tree-mesh">
                    <div class="skp-tree-dot" style="background:#4a9eff"></div>
                    <span>Geometry</span>
                  </div>
                </div>
              </div>
              <div v-else class="skp-tree-empty">No model loaded</div>
            </template>
          </div>
        </div>

        <!-- Layers -->
        <div v-if="leftTab === 'layers'" class="skp-panel-body">
          <div class="skp-layers-toolbar">
            <button class="skp-icon-btn" title="Add Layer">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
            </button>
            <button class="skp-icon-btn" title="Delete Layer">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"/></svg>
            </button>
          </div>
          <table class="skp-layers-table">
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>Color</th>
              </tr>
            </thead>
            <tbody>
              <tr class="skp-layer-row active">
                <td><div class="skp-layer-vis on"></div></td>
                <td>Layer0</td>
                <td><div class="skp-layer-color" style="background:#4a9eff"></div></td>
              </tr>
              <tr class="skp-layer-row">
                <td><div class="skp-layer-vis"></div></td>
                <td>Architecture</td>
                <td><div class="skp-layer-color" style="background:#ff8c42"></div></td>
              </tr>
              <tr class="skp-layer-row">
                <td><div class="skp-layer-vis on"></div></td>
                <td>Structure</td>
                <td><div class="skp-layer-color" style="background:#a0e080"></div></td>
              </tr>
              <tr class="skp-layer-row">
                <td><div class="skp-layer-vis on"></div></td>
                <td>MEP</td>
                <td><div class="skp-layer-color" style="background:#e06060"></div></td>
              </tr>
            </tbody>
          </table>
        </div>
      </aside>

      <!-- CENTER: VIEWPORT AREA -->
      <div class="skp-viewport-area">
        <!-- Scene Tabs -->
        <div class="skp-scene-tabs">
          <button
            class="skp-scene-tab"
            :class="{ active: sceneTab === 'Scene 1' }"
            @click="sceneTab = 'Scene 1'"
          >Scene 1</button>
          <button
            class="skp-scene-tab"
            :class="{ active: sceneTab === 'Floor Plan' }"
            @click="sceneTab = 'Floor Plan'"
          >Floor Plan</button>
          <button
            class="skp-scene-tab"
            :class="{ active: sceneTab === 'Section' }"
            @click="sceneTab = 'Section'"
          >Section Cut</button>
          <button class="skp-scene-add" title="Add Scene">+</button>

        </div>

        <!-- 3D Viewport -->
        <!-- ══ Loading Overlay ══ -->
        <div v-if="isLoading" class="skp-loading-overlay">
          <div class="skp-loading-card">
            <!-- Animated 3D cube icon -->
            <div class="skp-loading-icon">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" class="skp-spin-slow">
                <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="#3a80e8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M2 17l10 5 10-5" stroke="#3a80e8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>
                <path d="M2 12l10 5 10-5" stroke="#3a80e8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
              </svg>
              <div class="skp-loading-pulse"></div>
            </div>

            <!-- File name -->
            <div class="skp-loading-filename">{{ selectedFileName }}</div>

            <!-- Step text -->
            <div class="skp-loading-step">{{ loadingStep }}</div>

            <!-- Progress bar -->
            <div class="skp-loading-track">
              <div class="skp-loading-fill" :style="{ width: loadingProgress + '%' }"></div>
            </div>
            <div class="skp-loading-pct">{{ loadingProgress }}%</div>
          </div>
        </div>

        <!-- Empty-state drop zone (shown before model loaded) -->
        <div
          v-if="!hasModel && !isLoading"
          class="skp-dropzone"
          :class="{ 'dz-hover': isDragOverFiles }"
          @click="openFilePicker"
          @dragover="onViewportDragOver"
          @dragleave="onViewportDragLeave"
          @drop="onViewportDrop"
        >
          <!-- dot-grid background -->
          <div class="dz-bg-dots" aria-hidden="true"></div>

          <!-- center card -->
          <div class="dz-panel">

            <!-- icon ring -->
            <div class="dz-ring">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>
                <path d="M12 12v9"/><path d="m8 17 4-4 4 4"/>
              </svg>
            </div>

            <!-- text -->
            <div class="dz-text-block">
              <h3 class="dz-heading">Open a 3D Model</h3>
              <p class="dz-caption">ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์</p>
            </div>

            <!-- format table -->
            <div class="dz-fmt-table">
              <div class="dz-fmt-row supported">
                <div class="dz-fmt-left">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <strong>.GLB</strong>
                </div>
                <span class="dz-fmt-desc">รองรับเต็มรูปแบบ · ลากวางได้เลย</span>
                <span class="dz-fmt-badge green">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                  Ready
                </span>
              </div>
              <div class="dz-fmt-row supported">
                <div class="dz-fmt-left">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <strong>.GLTF</strong>
                </div>
                <span class="dz-fmt-desc">เลือกโมเดล + texture พร้อมกันหลายไฟล์</span>
                <span class="dz-fmt-badge green">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                  Ready
                </span>
              </div>
              <div class="dz-fmt-row convert" @click.stop="showSkpGuide = true">
                <div class="dz-fmt-left">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <strong>.SKP</strong>
                </div>
                <span class="dz-fmt-desc">ต้องแปลงก่อนใช้งาน · ดูวิธีแปลง →</span>
                <span class="dz-fmt-badge amber">Convert</span>
              </div>
              <div class="dz-fmt-row convert">
                <div class="dz-fmt-left">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <strong>.FBX / .OBJ</strong>
                </div>
                <span class="dz-fmt-desc">ต้องแปลงก่อน · ใช้ Blender / online</span>
                <span class="dz-fmt-badge amber">Convert</span>
              </div>
            </div>

            <!-- CTA -->
            <div class="dz-cta">
              <div class="dz-open-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                Open File
              </div>
              <div class="dz-shortcut">
                or <kbd>Ctrl</kbd> + <kbd>O</kbd>
              </div>
            </div>

            <div v-if="errorText" class="dz-error">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              {{ errorText }}
            </div>

          </div>
        </div>

        <!-- 3D Viewport (always rendered, hidden before model) -->
        <div
          ref="viewport"
          class="skp-viewport"
          :class="{ 'vp-hidden': !hasModel && !isLoading }"
          @dragover="onViewportDragOver"
          @dragleave="onViewportDragLeave"
          @drop="onViewportDrop"
        ></div>

        <!-- File-drag overlay on top of active viewport -->
        <div v-if="isDragOverFiles && hasModel" class="skp-file-drop-overlay">
          <div class="skp-drop-msg">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#60e8a0" stroke-width="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span>วางไฟล์เพื่อเปิดโมเดล</span>
            <small>.glb · .gltf</small>
          </div>
        </div>

        <!-- Navigation Cube Overlay -->
        <div class="skp-nav-cube" :class="{ 'nc-active': viewerReady }">
          <!-- Cube: each polygon face is clickable -->
          <div class="nc-cube-wrap">
            <svg width="72" height="72" viewBox="0 0 80 80">
              <!-- Top face -->
              <polygon class="nc-face nc-top"   points="40,8 72,24 40,40 8,24"   @click="setStandardView('top')"   title="Top View"/>
              <!-- Right face -->
              <polygon class="nc-face nc-right" points="40,40 72,24 72,56 40,72" @click="setStandardView('right')" title="Right View"/>
              <!-- Front face -->
              <polygon class="nc-face nc-front" points="40,40 8,24 8,56 40,72"   @click="setStandardView('front')" title="Front View"/>
              <!-- Labels (non-interactive) -->
              <text x="40" y="28" text-anchor="middle" fill="#4a9eff" font-size="8.5" font-family="monospace" font-weight="bold" pointer-events="none">TOP</text>
              <text x="59" y="52" text-anchor="middle" fill="#ff8c42" font-size="7"   font-family="monospace" pointer-events="none">RIGHT</text>
              <text x="22" y="52" text-anchor="middle" fill="#a0e080" font-size="7"   font-family="monospace" pointer-events="none">FRONT</text>
            </svg>
          </div>
          <!-- Quick-view buttons -->
          <div class="nc-btns">
            <button class="nc-btn" title="Top View"         @click="setStandardView('top')">T</button>
            <button class="nc-btn" title="Front View"       @click="setStandardView('front')">F</button>
            <button class="nc-btn" title="Right View"       @click="setStandardView('right')">R</button>
            <button class="nc-btn" title="Left View"        @click="setStandardView('left')">L</button>
            <button class="nc-btn" title="Back View"        @click="setStandardView('back')">Bk</button>
            <button class="nc-btn nc-btn-iso" title="Isometric" @click="setStandardView('iso')">ISO</button>
          </div>
          <!-- Axes -->
          <div class="skp-axes">
            <span class="axis x">X</span>
            <span class="axis y">Y</span>
            <span class="axis z">Z</span>
          </div>
        </div>
      </div>

      <!-- RIGHT PANEL -->
      <aside class="skp-right-panel" :style="{ width: rightPanelWidth + 'px' }">
        <!-- resize handle -->
        <div class="rp-resize-handle" @mousedown.prevent="onRpResizeStart"></div>
        <div class="skp-panel-tabs">
          <button class="skp-panel-tab" :class="{ active: rightTab === 'entity' }" @click="rightTab = 'entity'">Entity</button>
<button class="skp-panel-tab" :class="{ active: rightTab === 'styles' }" @click="rightTab = 'styles'">Styles</button>
          <button class="skp-panel-tab tf-tab" :class="{ active: rightTab === 'takeoff' }" @click="rightTab = 'takeoff'">
            ถอดแบบ
            <span v-if="takeoffItems.length" class="tf-badge">{{ takeoffItems.length }}</span>
          </button>
        </div>

        <!-- Entity Info -->
        <div v-if="rightTab === 'entity'" class="skp-panel-body">
          <div class="skp-section-label">Entity Info</div>
          <div class="skp-prop-group">
            <div class="skp-prop-row">
              <span class="skp-prop-key">Name</span>
              <span class="skp-prop-val">{{ selectedFileName || '—' }}</span>
            </div>
            <div class="skp-prop-row">
              <span class="skp-prop-key">Type</span>
              <span class="skp-prop-val">{{ hasModel ? 'GLB/GLTF Model' : '—' }}</span>
            </div>
            <div class="skp-prop-row">
              <span class="skp-prop-key">Assets</span>
              <span class="skp-prop-val">{{ loadedAssetCount || '—' }}</span>
            </div>
            <div class="skp-prop-row">
              <span class="skp-prop-key">Status</span>
              <span class="skp-prop-val" :class="statusText === 'Failed' ? 'err-text' : statusText === 'Loaded' ? 'ok-text' : ''">{{ statusText }}</span>
            </div>
            <div class="skp-prop-row">
              <span class="skp-prop-key">X-Ray</span>
              <span class="skp-prop-val">{{ wallTransparentOn ? 'ON' : 'OFF' }}</span>
            </div>
          </div>

          <div class="skp-section-label" style="margin-top:12px">Camera Target</div>
          <div class="skp-prop-group">
            <div class="skp-prop-row">
              <span class="skp-prop-key">X</span>
              <span class="skp-prop-val mono">{{ mouseCoords.x }}</span>
            </div>
            <div class="skp-prop-row">
              <span class="skp-prop-key">Y</span>
              <span class="skp-prop-val mono">{{ mouseCoords.y }}</span>
            </div>
            <div class="skp-prop-row">
              <span class="skp-prop-key">Z</span>
              <span class="skp-prop-val mono">{{ mouseCoords.z }}</span>
            </div>
          </div>

          <div v-if="errorText" class="skp-error-box">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            {{ errorText }}
          </div>

          <div class="skp-section-label" style="margin-top:12px">Quick Actions</div>
          <div class="skp-action-grid">
            <button class="skp-action-btn" @click="openFilePicker">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              Open File
            </button>
            <button class="skp-action-btn" @click="showProjectPanel = true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              โปรเจกต์ที่บันทึก
            </button>
            <button class="skp-action-btn" :disabled="!viewerReady || !hasModel" @click="toggleWallTransparency">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18" opacity="0.5"/></svg>
              X-Ray {{ wallTransparentOn ? 'OFF' : 'ON' }}
            </button>
            <button class="skp-action-btn" :disabled="!viewerReady" @click="resetView">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              Reset View
            </button>
          </div>
        </div>


        <!-- Styles -->
        <div v-if="rightTab === 'styles'" class="skp-panel-body">
          <div class="skp-section-label">Face Styles</div>
          <div class="skp-style-grid">
            <div class="skp-style-item active" title="Shaded with Textures">
              <div class="skp-style-preview textured"></div>
              <span>Textured</span>
            </div>
            <div class="skp-style-item" title="Shaded">
              <div class="skp-style-preview shaded"></div>
              <span>Shaded</span>
            </div>
            <div class="skp-style-item" title="Wireframe">
              <div class="skp-style-preview wireframe"></div>
              <span>Wireframe</span>
            </div>
            <div class="skp-style-item" title="Hidden Line">
              <div class="skp-style-preview hidden-line"></div>
              <span>Hidden Line</span>
            </div>
            <div class="skp-style-item" title="Monochrome">
              <div class="skp-style-preview mono-style"></div>
              <span>Mono</span>
            </div>
            <div class="skp-style-item" title="X-Ray" :class="{ active: wallTransparentOn }" @click="toggleWallTransparency">
              <div class="skp-style-preview xray"></div>
              <span>X-Ray</span>
            </div>
          </div>

          <div class="skp-section-label" style="margin-top:14px">Edge Styles</div>
          <div class="skp-edge-opts">
            <label class="skp-checkbox-row">
              <input type="checkbox" checked class="skp-cb" /> Edges
            </label>
            <label class="skp-checkbox-row">
              <input type="checkbox" class="skp-cb" /> Back Edges
            </label>
            <label class="skp-checkbox-row">
              <input type="checkbox" checked class="skp-cb" /> Profiles
            </label>
            <label class="skp-checkbox-row">
              <input type="checkbox" class="skp-cb" /> Depth Cue
            </label>
          </div>

          <div class="skp-section-label" style="margin-top:14px">Shadows</div>
          <div class="skp-edge-opts">
            <label class="skp-checkbox-row">
              <input type="checkbox" checked class="skp-cb" /> Shadow Display
            </label>
            <label class="skp-checkbox-row">
              <input type="checkbox" class="skp-cb" /> Fog
            </label>
          </div>
        </div>

        <!-- ── Takeoff / ถอดแบบ ── -->
        <div v-if="rightTab === 'takeoff'" class="skp-panel-body">

          <!-- Selected object card -->
          <div class="skp-section-label">วัตถุที่เลือก
            <span v-if="selectedInfo" class="tf-sel-badge">เลือกแล้ว</span>
          </div>
          <div v-if="!selectedInfo" class="skp-empty-msg">คลิกวัตถุในโมเดลเพื่อเลือก</div>
          <div v-else class="tf-sel-card">
            <div class="tf-sel-name">{{ selectedInfo.name }}</div>
            <div class="tf-sel-dims">
              <span>W {{ fmt(selectedInfo.dims.w) }} m</span>
              <span>H {{ fmt(selectedInfo.dims.h) }} m</span>
              <span>D {{ fmt(selectedInfo.dims.d) }} m</span>
            </div>
            <div class="tf-sel-metrics">
              <div class="tf-metric"><span>พื้นที่ผิว</span><b>{{ fmt(selectedInfo.area) }} ตร.ม.</b></div>
              <div class="tf-metric"><span>ปริมาตร</span><b>{{ fmt(selectedInfo.volume, 4) }} ลบ.ม.</b></div>
              <div class="tf-metric"><span>วัสดุ</span><b>{{ selectedInfo.matName }}</b></div>
            </div>
          </div>

          <!-- Add form -->
          <div class="skp-section-label" style="margin-top:10px">เพิ่มรายการถอดแบบ</div>
          <div class="tf-form">
            <label class="tf-label">ชื่อรายการ
              <input v-model="tfName" class="tf-input" placeholder="ชื่อรายการ..." />
            </label>
            <label class="tf-label">หมวดหมู่
              <select v-model="tfCategory" class="tf-input tf-select">
                <option>งานโครงสร้าง</option>
                <option>งานสถาปัตย์</option>
                <option>งานผนัง</option>
                <option>งานพื้น</option>
                <option>งานหลังคา</option>
                <option>งานประตู-หน้าต่าง</option>
                <option>งานไฟฟ้า</option>
                <option>งานสุขาภิบาล</option>
                <option>งานปรับอากาศ</option>
                <option>อื่นๆ</option>
              </select>
            </label>
            <div class="tf-row2">
              <label class="tf-label">ปริมาณ
                <input v-model.number="tfQty" type="number" min="0" step="0.01" class="tf-input" />
              </label>
              <label class="tf-label">หน่วย
                <select v-model="tfUnit" class="tf-input tf-select">
                  <option>ตร.ม.</option>
                  <option>ลบ.ม.</option>
                  <option>เมตร</option>
                  <option>ชิ้น</option>
                  <option>ชุด</option>
                  <option>จุด</option>
                  <option>กก.</option>
                </select>
              </label>
            </div>
            <label class="tf-label">ราคาต่อหน่วย (บาท)
              <input v-model.number="tfUnitPrice" type="number" min="0" step="1" class="tf-input" />
            </label>

            <div class="tf-add-row">
              <span class="tf-preview-price">
                {{ fmtPrice(tfQty * tfUnitPrice) }} บาท
              </span>
              <button class="tf-add-btn" :disabled="!selectedInfo || takeoffSaving" @click="addToTakeoff">
                {{ takeoffSaving ? 'กำลังบันทึก…' : '+ เพิ่ม' }}
              </button>
            </div>
          </div>

          <!-- ══ AI ราคาตลาด Card ══ -->
          <div class="tf-ai-card" :class="{ 'tf-ai-card--active': aiResult || aiLoading || aiError }">
            <!-- Header row -->
            <div class="tf-ai-card-header">
              <div class="tf-ai-card-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                AI ประเมินราคาตลาด
              </div>
              <button
                class="tf-ai-ask-btn"
                :disabled="!selectedInfo || aiLoading"
                @click="requestAiPrice"
              >
                <svg v-if="aiLoading" class="tf-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
                <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.08-6.59"/></svg>
                {{ aiLoading ? 'กำลังวิเคราะห์…' : (aiResult ? 'ถามใหม่' : 'ขอราคา') }}
              </button>
            </div>

            <!-- Loading state -->
            <div v-if="aiLoading" class="tf-ai-loading">
              <svg class="tf-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6a3de8" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
              กำลังวิเคราะห์ราคาตลาดก่อสร้าง ปี 2025…
            </div>

            <!-- Error state -->
            <div v-else-if="aiError" class="tf-ai-err-box">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              <span>{{ aiError }}</span>
            </div>

            <!-- Result state -->
            <template v-else-if="aiResult">
              <!-- ราคาแนะนำ + ช่วงราคา -->
              <div class="tf-ai-price-row">
                <div class="tf-ai-suggest">
                  <div class="tf-ai-suggest-label">ราคาแนะนำ</div>
                  <div class="tf-ai-suggest-value">{{ fmtPrice(aiResult.suggestedPrice) }} <span>฿/{{ aiResult.unit }}</span></div>
                  <span class="tf-ai-confidence" :class="`tf-conf-${aiResult.confidence}`">
                    {{ aiResult.confidence === 'high' ? 'มั่นใจสูง' : aiResult.confidence === 'medium' ? 'ปานกลาง' : 'ข้อมูลน้อย' }}
                  </span>
                </div>
                <div class="tf-ai-range">
                  <div class="tf-ai-range-row">
                    <span class="tf-ai-range-label">ต่ำสุด</span>
                    <span class="tf-ai-range-val tf-val-min">{{ fmtPrice(aiResult.priceMin) }} ฿</span>
                  </div>
                  <div class="tf-ai-range-row">
                    <span class="tf-ai-range-label">สูงสุด</span>
                    <span class="tf-ai-range-val tf-val-max">{{ fmtPrice(aiResult.priceMax) }} ฿</span>
                  </div>
                </div>
              </div>

              <!-- Visual bar: ตำแหน่งราคาปัจจุบันบนแถบ -->
              <div class="tf-ai-bar-wrap">
                <div class="tf-ai-bar-track">
                  <div class="tf-ai-bar-fill" :style="priceRangeStyle" />
                  <div class="tf-ai-bar-pin tf-pin-suggest" :style="priceThumbStyle" title="ราคาแนะนำ AI" />
                  <div class="tf-ai-bar-pin tf-pin-user" :style="userPriceThumbStyle" :title="`ราคาที่กรอก ${fmtPrice(tfUnitPrice)} ฿`" />
                </div>
                <div class="tf-ai-bar-legend">
                  <span><i class="tf-dot tf-dot-suggest" />แนะนำ</span>
                  <span><i class="tf-dot tf-dot-user" />กรอกอยู่</span>
                  <span class="tf-ai-bar-range-text">{{ fmtPrice(aiResult.priceMin) }} – {{ fmtPrice(aiResult.priceMax) }} ฿</span>
                </div>
              </div>

              <!-- คำอธิบายจาก AI -->
              <div v-if="aiResult.reasoning" class="tf-ai-reason">{{ aiResult.reasoning }}</div>
              <div v-if="aiResult.marketNotes" class="tf-ai-notes">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                {{ aiResult.marketNotes }}
              </div>
              <div v-for="w in aiResult.warnings" :key="w" class="tf-ai-warn-item">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#e87020" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                {{ w }}
              </div>

              <!-- ปุ่มใช้ราคา -->
              <button class="tf-ai-apply-btn" @click="applyAiPrice">
                ใช้ราคา {{ fmtPrice(aiResult.suggestedPrice) }} ฿ / {{ aiResult.unit }}
              </button>
            </template>

            <!-- Empty state (ยังไม่กดถาม) -->
            <div v-else class="tf-ai-empty">
              เลือกวัตถุในโมเดลแล้วกด <b>ขอราคา</b> เพื่อให้ AI วิเคราะห์ราคาตลาดปัจจุบัน
            </div>
          </div>

          <!-- Anomaly warning (always-on, static table) -->
          <div
            v-if="selectedInfo && (currentAnomaly === 'warning' || currentAnomaly === 'danger')"
            class="tf-anomaly-strip"
            :class="currentAnomaly === 'danger' ? 'tf-anomaly-strip--danger' : 'tf-anomaly-strip--warn'"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>{{
              currentAnomaly === 'danger'
                ? `ราคา ${fmtPrice(tfUnitPrice)} ฿ ผิดปกติมาก — ห่างจากช่วงตลาดอย่างมีนัยสำคัญ`
                : `ราคา ${fmtPrice(tfUnitPrice)} ฿ อยู่นอกช่วงราคาตลาดปกติ — กรุณาตรวจสอบ`
            }}</span>
          </div>

          <!-- Takeoff list -->
          <div class="skp-section-label" style="margin-top:10px">
            รายการถอดแบบ
            <span class="skp-count-badge">{{ takeoffItems.length }}</span>
            <button v-if="takeoffItems.length" class="tf-clear-btn" @click="clearTakeoff">ล้าง</button>
          </div>
          <!-- Auto-extracting indicator -->
          <div v-if="takeoff.loading.value" class="tf-extracting">
            <svg class="tf-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3a80e8" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
            กำลังสรุปรายการถอดแบบ…
          </div>
          <div v-else-if="!takeoffItems.length" class="skp-empty-msg">ยังไม่มีรายการ</div>
          <div v-else class="tf-item-list">
            <div
              v-for="item in takeoffItems"
              :key="item.id"
              class="tf-item"
              :class="{ 'tf-item-deleting': deletingId === item.id }"
            >
              <div class="tf-item-top">
                <span class="tf-item-name">{{ item.name }}</span>
                <!-- Price anomaly warning icon -->
                <span
                  v-if="itemAnomaly(item) === 'warning' || itemAnomaly(item) === 'danger'"
                  class="tf-item-anomaly-icon"
                  :class="itemAnomaly(item) === 'danger' ? 'tf-icon-danger' : 'tf-icon-warn'"
                  :title="itemAnomaly(item) === 'danger' ? 'ราคาผิดปกติมาก (ต่ำ/สูงกว่าตลาดมาก)' : 'ราคานอกช่วงตลาดปกติ'"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                </span>
                <button
                  class="tf-del-btn"
                  :disabled="deletingId === item.id"
                  title="ลบรายการ"
                  @click="removeTakeoffItem(item.id)"
                >
                  <svg v-if="deletingId !== item.id" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4h6v2"/>
                  </svg>
                  <svg v-else class="tf-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
                </button>
              </div>
              <div class="tf-item-meta">
                <span class="tf-cat-chip">{{ item.category }}</span>
                <span class="tf-dims-chip">{{ item.dimsLabel }}</span>
              </div>
              <div class="tf-item-cost">
                <span>{{ fmtPrice(item.qty) }} {{ item.unit }} × {{ fmtPrice(item.unitPrice) }}</span>
                <b>{{ fmtPrice(item.qty * item.unitPrice) }} ฿</b>
              </div>
            </div>
          </div>

          <!-- Total & Report button -->
          <div v-if="takeoffItems.length" class="tf-total-bar">
            <span>รวมทั้งหมด</span>
            <b class="tf-grand-total">{{ fmtPrice(takeoffTotal) }} ฿</b>
          </div>

          <!-- Save project button -->
          <div v-if="hasModel" class="tf-save-area">
            <div v-if="saveSuccess" class="tf-save-success">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1a7040" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              บันทึกลง DB แล้ว
            </div>
            <button
              class="tf-save-btn"
              :disabled="isSavingProject || takeoffItems.length === 0"
              @click="saveCurrentProject"
            >
              <svg v-if="isSavingProject" class="tf-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              {{ isSavingProject ? 'กำลังบันทึก…' : 'บันทึกโปรเจกต์' }}
            </button>
            <button v-if="takeoffItems.length" class="tf-report-btn" @click="showCostReport = true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              ดูรายงานต้นทุน
            </button>
          </div>
        </div>
      </aside>
    </div>

    <!-- ════════════════════ PROJECT LIST MODAL ════════════════════ -->
    <div v-if="showProjectPanel" class="tf-modal-backdrop" @click.self="showProjectPanel = false">
      <div class="tf-modal proj-modal">
        <div class="tf-modal-header">
          <div class="tf-modal-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3a80e8" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            โปรเจกต์ที่บันทึกไว้
          </div>
          <div class="tf-modal-actions">
            <button class="tf-print-btn" @click="project.loadProjects()">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              รีเฟรช
            </button>
            <button class="tf-close-btn" @click="showProjectPanel = false">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        <div class="tf-modal-body proj-modal-body">

          <!-- Error -->
          <div v-if="project.error.value" class="proj-error">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            {{ project.error.value }}
            <button class="proj-retry-btn" @click="project.loadProjects()">ลองใหม่</button>
          </div>

          <!-- Loading -->
          <div v-else-if="project.uploading.value" class="proj-loading">
            <svg class="tf-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3a80e8" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
            กำลังโหลด…
          </div>

          <!-- Empty -->
          <div v-else-if="!project.error.value && project.projects.value.length === 0" class="proj-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#b0c0d8" stroke-width="1.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <p>ยังไม่มีโปรเจกต์ที่บันทึกไว้</p>
            <small>เปิดไฟล์ GLB แล้วกด "บันทึกโปรเจกต์" ในแท็บถอดแบบ</small>
          </div>

          <!-- Project list -->
          <div v-else-if="project.projects.value.length > 0" class="proj-list">
            <div
              v-for="proj in project.projects.value"
              :key="proj.id"
              class="proj-card"
              :class="{ active: project.currentProject.value?.id === proj.id }"
              @click="loadSavedProject(proj)"
            >
              <div class="proj-card-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3a80e8" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
              </div>
              <div class="proj-card-info">
                <div class="proj-card-name">{{ proj.name }}</div>
                <div class="proj-card-file">{{ proj.modelName }}</div>
                <div class="proj-card-meta">
                  <span>{{ (proj.fileSize / 1024 / 1024).toFixed(1) }} MB</span>
                  <span>·</span>
                  <span>{{ new Date(proj.createdAt).toLocaleDateString('th-TH', { year:'numeric', month:'short', day:'numeric' }) }}</span>
                </div>
              </div>
              <div class="proj-card-action">
                <span v-if="project.currentProject.value?.id === proj.id" class="proj-active-badge">เปิดอยู่</span>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3a80e8" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>

    <!-- ════════════════════ SKP GUIDE MODAL ════════════════════ -->
    <div v-if="showSkpGuide" class="tf-modal-backdrop" @click.self="showSkpGuide = false">
      <div class="tf-modal skp-guide-modal">
        <div class="tf-modal-header">
          <div class="tf-modal-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffb84a" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            ไฟล์ .SKP (SketchUp) — ต้องแปลงก่อนใช้งาน
          </div>
          <button class="tf-close-btn" @click="showSkpGuide = false">✕</button>
        </div>
        <div class="tf-modal-body skp-guide-body">
          <div v-if="skpFileName" class="skp-guide-file">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffb84a" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>
            {{ skpFileName }}
          </div>

          <p class="skp-guide-desc">
            Three.js ไม่รองรับไฟล์ .SKP โดยตรง เนื่องจากเป็น format ที่เป็นกรรมสิทธิ์ของ Trimble SketchUp
            ต้องแปลงเป็น <b>.GLB</b> หรือ <b>.GLTF</b> ก่อน จึงจะนำเข้าได้
          </p>

          <!-- Method 1: SketchUp Desktop -->
          <div class="skp-method">
            <div class="skp-method-header">
              <span class="skp-method-num">1</span>
              <span>SketchUp Pro / Make (Desktop)</span>
              <span class="skp-method-tag recommended">แนะนำ</span>
            </div>
            <div class="skp-steps">
              <div class="skp-step"><span class="step-num">①</span> เปิดไฟล์ <code>.skp</code> ใน SketchUp</div>
              <div class="skp-step"><span class="step-num">②</span> เมนู <code>File</code> → <code>Export</code> → <code>3D Model…</code></div>
              <div class="skp-step"><span class="step-num">③</span> เลือก Format: <code>glTF File (*.gltf)</code> หรือ <code>Binary glTF (*.glb)</code></div>
              <div class="skp-step"><span class="step-num">④</span> กด <b>Export</b> → นำไฟล์ที่ได้มาเปิดในโปรแกรมนี้</div>
            </div>
            <div class="skp-tip">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4a9eff" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
              ถ้าเลือก <b>.glb</b> ได้ไฟล์เดียว (texture รวมอยู่ใน) — ใช้งานง่ายกว่า
            </div>
          </div>

          <!-- Method 2: SketchUp Free Web -->
          <div class="skp-method">
            <div class="skp-method-header">
              <span class="skp-method-num">2</span>
              <span>SketchUp Free (เว็บเบราว์เซอร์)</span>
              <span class="skp-method-tag free">ฟรี</span>
            </div>
            <div class="skp-steps">
              <div class="skp-step"><span class="step-num">①</span> เปิด <code>app.sketchup.com</code> → Sign in</div>
              <div class="skp-step"><span class="step-num">②</span> อัปโหลดไฟล์ .skp → เปิดในเว็บ</div>
              <div class="skp-step"><span class="step-num">③</span> <code>File</code> → <code>Download</code> → เลือก <b>STL</b> หรือ <b>Collada (.dae)</b></div>
              <div class="skp-step"><span class="step-num">④</span> นำ .dae ไปแปลงต่อด้วย Blender</div>
            </div>
          </div>

          <!-- Method 3: Blender -->
          <div class="skp-method">
            <div class="skp-method-header">
              <span class="skp-method-num">3</span>
              <span>Blender (ฟรี / Opensource)</span>
              <span class="skp-method-tag free">ฟรี</span>
            </div>
            <div class="skp-steps">
              <div class="skp-step"><span class="step-num">①</span> ติดตั้ง Blender (blender.org) → <code>File → Import → Collada (.dae)</code></div>
              <div class="skp-step"><span class="step-num">②</span> หรือใช้ addon <b>SketchUp Importer</b> นำเข้า .skp โดยตรง</div>
              <div class="skp-step"><span class="step-num">③</span> <code>File → Export → glTF 2.0 (.glb/.gltf)</code></div>
              <div class="skp-step"><span class="step-num">④</span> เลือก Format: <b>Binary (glb)</b> → กด Export</div>
            </div>
          </div>

          <!-- Method 4: Online converters -->
          <div class="skp-method">
            <div class="skp-method-header">
              <span class="skp-method-num">4</span>
              <span>Online Converter (ไม่ต้องติดตั้งโปรแกรม)</span>
            </div>
            <div class="skp-online-list">
              <div class="skp-online-item">
                <code>gltf.report</code>
                <small>อัปโหลด glb/gltf ตรวจสอบและ optimize</small>
              </div>
              <div class="skp-online-item">
                <code>aspose.app/3d/conversion/skp-to-glb</code>
                <small>แปลง SKP → GLB ออนไลน์ (ฟรี)</small>
              </div>
              <div class="skp-online-item">
                <code>cloudconvert.com</code>
                <small>แปลงหลาย format รวมถึง SKP → GLTF</small>
              </div>
            </div>
          </div>

          <!-- Format comparison table -->
          <div class="skp-compare">
            <div class="skp-compare-header">สรุปรูปแบบไฟล์ที่รองรับ</div>
            <table class="skp-compare-table">
              <thead><tr><th>ไฟล์</th><th>รองรับ</th><th>หมายเหตุ</th></tr></thead>
              <tbody>
                <tr class="ok-row"><td><b>.GLB</b></td><td>✓ โดยตรง</td><td>แนะนำ — ไฟล์เดียว ครบทุกอย่าง</td></tr>
                <tr class="ok-row"><td><b>.GLTF</b></td><td>✓ โดยตรง</td><td>เลือกหลายไฟล์ (model + textures) พร้อมกัน</td></tr>
                <tr class="warn-row"><td>.SKP</td><td>✗ ต้องแปลง</td><td>ใช้ SketchUp Export หรือ Blender</td></tr>
                <tr class="warn-row"><td>.FBX</td><td>✗ ต้องแปลง</td><td>ใช้ Blender: Import FBX → Export GLB</td></tr>
                <tr class="warn-row"><td>.OBJ</td><td>✗ ต้องแปลง</td><td>ใช้ Blender: Import OBJ → Export GLB</td></tr>
                <tr class="warn-row"><td>.DAE</td><td>✗ ต้องแปลง</td><td>ใช้ Blender: Import Collada → Export GLB</td></tr>
                <tr class="warn-row"><td>.STL</td><td>✗ ต้องแปลง</td><td>ใช้ Blender: Import STL → Export GLB</td></tr>
              </tbody>
            </table>
          </div>

          <button class="tf-add-btn" style="width:100%;justify-content:center;margin-top:8px" @click="showSkpGuide = false; openFilePicker()">
            เปิดไฟล์ .GLB / .GLTF
          </button>
        </div>
      </div>
    </div>

    <!-- ════════════════════ COST REPORT MODAL ════════════════════ -->
    <div v-if="showCostReport" class="tf-modal-backdrop" @click.self="showCostReport = false">
      <div class="tf-modal boq-modal">
        <!-- Modal toolbar (ไม่พิมพ์) -->
        <div class="boq-toolbar no-print">
          <div class="boq-toolbar-left">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3a80e8" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span>รายงานประมาณราคาต้นทุน (BOQ)</span>
          </div>
          <div class="boq-toolbar-right">
            <button class="boq-btn-print" @click="printReport">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              พิมพ์ / บันทึก PDF
            </button>
            <button class="boq-btn-close" @click="showCostReport = false">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        <!-- ═══ PRINT AREA ═══ -->
        <div class="tf-modal-body" id="tf-print-area">
          <div class="boq-page">

            <!-- Header -->
            <div class="boq-header">
              <div class="boq-header-brand">
                <div class="boq-logo">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="#3a80e8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="#3a80e8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>
                  </svg>
                </div>
                <div>
                  <div class="boq-company">BIM Viewer · Digital Twin Platform</div>
                  <div class="boq-doc-title">ใบประมาณราคาต้นทุนวัสดุและงานก่อสร้าง</div>
                  <div class="boq-doc-sub">Bill of Quantities (BOQ)</div>
                </div>
              </div>
              <div class="boq-header-info">
                <table class="boq-info-table">
                  <tr><td class="boq-info-lbl">โครงการ</td><td class="boq-info-val">{{ selectedFileName || 'BIM Model' }}</td></tr>
                  <tr><td class="boq-info-lbl">จัดทำโดย</td><td class="boq-info-val">{{ userLabel }}</td></tr>
                  <tr><td class="boq-info-lbl">วันที่</td><td class="boq-info-val">{{ new Date().toLocaleDateString('th-TH', { year:'numeric', month:'long', day:'numeric' }) }}</td></tr>
                  <tr><td class="boq-info-lbl">รายการทั้งหมด</td><td class="boq-info-val">{{ takeoffItems.length }} รายการ</td></tr>
                </table>
              </div>
            </div>

            <div class="boq-divider"></div>

            <!-- Category summary badges -->
            <div class="boq-summary-row">
              <div v-for="(items, cat) in takeoffByCategory" :key="'s'+cat" class="boq-summary-chip">
                <span class="boq-chip-cat">{{ cat }}</span>
                <span class="boq-chip-amt">{{ fmtPrice(items.reduce((s,x)=>s+x.qty*x.unitPrice,0)) }} ฿</span>
              </div>
            </div>

            <!-- Category tables -->
            <div v-for="(items, cat) in takeoffByCategory" :key="cat" class="boq-section">
              <div class="boq-section-header">
                <div class="boq-section-accent"></div>
                <span class="boq-section-title">{{ cat }}</span>
                <span class="boq-section-count">{{ items.length }} รายการ</span>
                <span class="boq-section-subtotal">{{ fmtPrice(items.reduce((s,x)=>s+x.qty*x.unitPrice,0)) }} บาท</span>
              </div>

              <table class="boq-table">
                <thead>
                  <tr>
                    <th class="boq-th-no">#</th>
                    <th class="boq-th-name">รายการ</th>
                    <th class="boq-th-dims">ขนาด (ก×ส×ล เมตร)</th>
                    <th class="boq-th-num">ปริมาณ</th>
                    <th class="boq-th-unit">หน่วย</th>
                    <th class="boq-th-num">ราคา/หน่วย</th>
                    <th class="boq-th-total">รวม (บาท)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(item, idx) in items" :key="item.id" :class="idx % 2 === 1 ? 'boq-row-alt' : ''">
                    <td class="boq-td-no">{{ idx + 1 }}</td>
                    <td class="boq-td-name">{{ item.name }}</td>
                    <td class="boq-td-dims">{{ item.dimsLabel }}</td>
                    <td class="boq-td-num">{{ fmtPrice(item.qty) }}</td>
                    <td class="boq-td-unit">{{ item.unit }}</td>
                    <td class="boq-td-num">{{ fmtPrice(item.unitPrice) }}</td>
                    <td class="boq-td-total">{{ fmtPrice(item.qty * item.unitPrice) }}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr class="boq-subtotal-row">
                    <td colspan="6" class="boq-subtotal-lbl">รวม {{ cat }}</td>
                    <td class="boq-subtotal-val">{{ fmtPrice(items.reduce((s,x)=>s+x.qty*x.unitPrice,0)) }}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <!-- Grand total -->
            <div class="boq-grand">
              <div class="boq-grand-inner">
                <div class="boq-grand-left">
                  <div class="boq-grand-label">ราคาประมาณการรวมทั้งสิ้น</div>
                  <div class="boq-grand-sub">Total Estimated Cost (Materials)</div>
                </div>
                <div class="boq-grand-right">
                  <div class="boq-grand-num">{{ fmtPrice(takeoffTotal) }}</div>
                  <div class="boq-grand-currency">บาท (THB)</div>
                </div>
              </div>
            </div>

            <!-- Footer note -->
            <div class="boq-footer">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#90a0b8" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              <span>ราคานี้เป็นการประมาณการเบื้องต้นสำหรับวัสดุเท่านั้น ไม่รวมค่าแรงงาน ภาษีมูลค่าเพิ่ม ค่าขนส่ง และค่าใช้จ่ายอื่นๆ · จัดทำด้วย BIM Viewer Digital Twin Platform</span>
            </div>

          </div>
        </div>
      </div>
    </div>

    <!-- ═════════════════════════════════════ STATUS BAR ══════════════════════════════════════ -->
    <div class="skp-statusbar">
      <div class="skp-statusbar-left">
        <span class="skp-status-tool">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3l7 18 3-7 7-3z"/>
          </svg>
          {{ tools.find(t => t.id === activeTool)?.label || viewTools.find(t => t.id === activeTool)?.label || 'Select' }}
        </span>
        <span class="skp-status-sep">|</span>
        <span class="skp-status-hint">
          {{ hasModel
            ? `Model loaded · ${lightDevices.length} light(s) · Click light to toggle`
            : 'Open a .glb or .gltf file to begin · File > Open or toolbar Open button'
          }}
        </span>
      </div>
      <div class="skp-statusbar-right">
        <span class="skp-coord">X <b>{{ mouseCoords.x }}</b></span>
        <span class="skp-coord">Y <b>{{ mouseCoords.y }}</b></span>
        <span class="skp-coord">Z <b>{{ mouseCoords.z }}</b></span>
        <span class="skp-status-sep">|</span>
        <span class="skp-status-dim">{{ viewerReady ? 'Viewer Ready' : 'Initializing…' }}</span>
      </div>
    </div>

    <!-- Hidden file input -->
    <input
      ref="fileInput"
      class="skp-hidden-input"
      type="file"
      accept=".glb,.gltf,.skp,.fbx,.obj,.dae,.bin,.ktx2,.png,.jpg,.jpeg,.webp,.basis"
      multiple
      @change="onPickFile"
    />

    <!-- ════════════════════ SAVE PROJECT MODAL ════════════════════ -->
    <div v-if="showSaveModal" class="tf-modal-backdrop" @click.self="showSaveModal = false">
      <div class="tf-modal save-modal">
        <div class="tf-modal-header">
          <div class="tf-modal-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3a80e8" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            บันทึกโปรเจกต์
          </div>
          <button class="tf-close-btn" @click="showSaveModal = false">✕</button>
        </div>
        <div class="tf-modal-body save-modal-body">
          <label class="save-name-label">ชื่อโปรเจกต์</label>
          <input
            v-model="pendingProjectName"
            class="save-name-input"
            type="text"
            placeholder="กรอกชื่อโปรเจกต์…"
            maxlength="100"
            @keyup.enter="confirmSaveModal"
            autofocus
          />
          <div class="save-modal-actions">
            <button class="save-cancel-btn" @click="showSaveModal = false">ยกเลิก</button>
            <button class="save-confirm-btn" :disabled="!pendingProjectName.trim()" @click="confirmSaveModal">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
              บันทึก
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ════════════════════ ABOUT MODAL ════════════════════ -->
    <div v-if="showAbout" class="tf-modal-backdrop" @click.self="showAbout = false">
      <div class="tf-modal about-modal">
        <div class="tf-modal-header">
          <div class="tf-modal-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3a80e8" stroke-width="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
            เกี่ยวกับ BIM Viewer
          </div>
          <button class="tf-close-btn" @click="showAbout = false">✕</button>
        </div>
        <div class="tf-modal-body about-body">

          <!-- Logo + Brand -->
          <div class="ab-brand">
            <div class="ab-logo">
              <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#3a80e8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <div class="ab-name">BIM Viewer</div>
              <div class="ab-sub">Digital Twin Platform</div>
              <div class="ab-version">Version 1.0.0</div>
            </div>
          </div>

          <div class="ab-divider"></div>

          <!-- Product Info -->
          <div class="ab-section-label">ข้อมูลผลิตภัณฑ์</div>
          <div class="ab-info-grid">
            <div class="ab-info-row">
              <span class="ab-info-key">ชื่อโปรแกรม</span>
              <span class="ab-info-val">BIM Viewer — Digital Twin Platform</span>
            </div>
            <div class="ab-info-row">
              <span class="ab-info-key">Version</span>
              <span class="ab-info-val">1.0.0 (Build 2025)</span>
            </div>
            <div class="ab-info-row">
              <span class="ab-info-key">Engine</span>
              <span class="ab-info-val">Three.js 0.160 · Nuxt 4 · Vue 3</span>
            </div>
            <div class="ab-info-row">
              <span class="ab-info-key">รองรับไฟล์</span>
              <span class="ab-info-val">.GLB · .GLTF · .OBJ · .FBX · .DAE</span>
            </div>
            <div class="ab-info-row">
              <span class="ab-info-key">Platform</span>
              <span class="ab-info-val">Web Application (Browser-based)</span>
            </div>
          </div>

          <div class="ab-divider"></div>

          <!-- License Info -->
          <div class="ab-section-label">ข้อมูล License</div>
          <div class="ab-info-grid">
            <div class="ab-info-row">
              <span class="ab-info-key">ผู้ใช้งาน</span>
              <span class="ab-info-val">{{ currentUser?.email || '—' }}</span>
            </div>
            <div class="ab-info-row">
              <span class="ab-info-key">ประเภท License</span>
              <span class="ab-info-val">
                <span v-if="license?.label" class="ab-badge ab-badge-blue">{{ license.label }}</span>
                <span v-else class="ab-badge ab-badge-gray">—</span>
              </span>
            </div>
            <div class="ab-info-row">
              <span class="ab-info-key">สถานะ</span>
              <span class="ab-info-val">
                <span v-if="license?.isValid" class="ab-badge ab-badge-green">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                  Active
                </span>
                <span v-else class="ab-badge ab-badge-red">Inactive</span>
              </span>
            </div>
            <div class="ab-info-row">
              <span class="ab-info-key">วันหมดอายุ</span>
              <span class="ab-info-val">
                <template v-if="license?.expiresAt">
                  {{ new Date(license.expiresAt).toLocaleDateString('th-TH', { year:'numeric', month:'long', day:'numeric' }) }}
                  <span v-if="license.daysLeft !== null" class="ab-days-left">(เหลือ {{ license.daysLeft }} วัน)</span>
                </template>
                <template v-else>—</template>
              </span>
            </div>
          </div>

          <div class="ab-divider"></div>

          <!-- Copyright -->
          <div class="ab-copyright">
            © 2025 BIM Viewer. All rights reserved.<br/>
            <span>Powered by Three.js · Supabase · Nuxt</span>
          </div>

        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* ══════════════ BASE ══════════════ */
* { box-sizing: border-box; }

.skp-app {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f0f2f5;
  color: #2a3545;
  font-family: "Noto Sans Thai", -apple-system, "Segoe UI", sans-serif;
  font-size: 12px;
  user-select: none;
}

/* ══════════════ MENU BAR ══════════════ */
.skp-menubar {
  height: 28px;
  background: #ffffff;
  border-bottom: 1px solid #d0d5da;
  display: flex;
  align-items: center;
  gap: 0;
  flex-shrink: 0;
  padding: 0 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

.skp-brand {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 12px;
  border-right: 1px solid #d8dde4;
  margin-right: 4px;
  font-size: 11.5px;
  font-weight: 700;
  color: #1a2535;
  letter-spacing: 0.3px;
}

.skp-menus {
  display: flex;
  align-items: stretch;
  height: 100%;
  flex: 1;
}

.skp-menu-item {
  position: relative;
  padding: 0 10px;
  display: flex;
  align-items: center;
  cursor: default;
  color: #3a4a5a;
  font-size: 12px;
  transition: background 0.08s;
}

.skp-menu-item:hover,
.skp-menu-item.active {
  background: #dce8f8;
  color: #1a3060;
}

.skp-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  background: #ffffff;
  border: 1px solid #c8d0da;
  border-radius: 4px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.15);
  min-width: 180px;
  z-index: 9999;
  padding: 4px 0;
}

.skp-dropdown-item {
  display: flex;
  align-items: center;
  gap: 0;
  width: 100%;
  text-align: left;
  padding: 5px 16px 5px 6px;
  background: none;
  border: none;
  color: #2a3a4a;
  cursor: default;
  font-size: 12px;
}

.skp-dropdown-item:hover {
  background: #dce8f8;
  color: #1a3060;
}

.mi-check {
  display: inline-block;
  width: 18px;
  text-align: center;
  font-size: 11px;
  color: #3a80e8;
  flex-shrink: 0;
}

.item-checked {
  color: #1a3a80;
  font-weight: 600;
}

.skp-dropdown-sep {
  height: 1px;
  background: #e0e5ea;
  margin: 3px 0;
}

.skp-menubar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.skp-status-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 3px;
}

.skp-status-badge.ok  { background: #d4f0e0; color: #1a7040; }
.skp-status-badge.err { background: #fde8e8; color: #b02020; }
.skp-status-badge.idle{ background: #e8eef8; color: #4060a0; }

.skp-upload-bar {
  position: relative;
  width: 140px;
  height: 22px;
  background: #e8eef8;
  border: 1px solid #c0d0e8;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.skp-upload-fill {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  background: #3a80e8;
  opacity: 0.25;
  transition: width 0.2s;
}
.skp-upload-bar span {
  position: relative;
  font-size: 11px;
  font-weight: 600;
  color: #1a4aaa;
}

.skp-user-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #3a4a60;
  background: #eaf0f8;
  border: 1px solid #c8d4e4;
  border-radius: 5px;
  padding: 3px 9px;
  max-width: 140px;
  overflow: hidden;
}
.skp-user-chip span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skp-mgmt-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #c08a00;
  background: #fdf6e0;
  border: 1px solid #e8d080;
  border-radius: 5px;
  padding: 3px 9px;
  cursor: pointer;
  font-weight: 600;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
  text-decoration: none;
}
.skp-mgmt-btn:hover {
  background: #fbedb0;
  color: #8a6000;
}

.skp-logout-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #c04040;
  background: #fdeaea;
  border: 1px solid #e8b0b0;
  border-radius: 5px;
  padding: 3px 9px;
  cursor: pointer;
  font-weight: 600;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}
.skp-logout-btn:hover {
  background: #f8d0d0;
  color: #901818;
}

/* ══════════════ TOOLBAR ══════════════ */
.skp-toolbar {
  height: 38px;
  background: #eef0f4;
  border-bottom: 1px solid #c8cdd4;
  display: flex;
  align-items: center;
  padding: 0 8px;
  gap: 4px;
  flex-shrink: 0;
}

.skp-toolbar-group { display: flex; align-items: center; gap: 2px; }

.skp-toolbar-sep {
  width: 1px;
  height: 22px;
  background: #c8cdd4;
  margin: 0 4px;
}

.skp-tool-btn {
  width: 30px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: #5a6878;
  cursor: pointer;
  transition: all 0.1s;
  padding: 0;
  gap: 5px;
}

.skp-tool-btn:hover        { background: #dce8f8; color: #1a3060; border-color: #b0c8e8; }
.skp-tool-btn.active       { background: #c8dff8; color: #1a4aaa; border-color: #80b0e8; }
.skp-tool-btn:disabled     { opacity: 0.4; cursor: not-allowed; }

.skp-tool-action {
  width: auto;
  padding: 0 8px;
  font-size: 11.5px;
  font-weight: 600;
  color: #3a5070;
}

.skp-tool-action:hover  { color: #1a3060; }
.skp-tool-action.active { color: #1a4aaa; background: #c8dff8; }

.skp-toolbar-file-info { gap: 6px; }

.skp-file-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: #ffffff;
  border: 1px solid #c8d4e0;
  border-radius: 3px;
  color: #4a6080;
  font-size: 11px;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skp-chip-dim { color: #8090a0; }

/* ══════════════ MAIN AREA ══════════════ */
.skp-main {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

/* ══════════════ PANELS ══════════════ */
.skp-left-panel {
  width: 220px;
  flex-shrink: 0;
  background: #f8f9fb;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid #c8cdd4;
  box-shadow: 2px 0 6px rgba(0,0,0,0.06);
}

.skp-right-panel {
  flex-shrink: 0;
  background: #f8fafC;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid #c8d4e0;
  box-shadow: -3px 0 12px rgba(30,60,110,0.08);
  position: relative;
}

/* ── Resize handle ── */
.rp-resize-handle {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 5px;
  cursor: col-resize;
  z-index: 20;
  background: transparent;
  transition: background 0.15s;
}
.rp-resize-handle:hover { background: #3a80e8; }

/* ── Tabs ── */
.skp-panel-tabs {
  display: flex;
  background: #ffffff;
  border-bottom: 1px solid #dce4ee;
  flex-shrink: 0;
  padding: 0 4px;
  gap: 2px;
}

.skp-panel-tab {
  flex: 1;
  height: 34px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: #8898b8;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  transition: all 0.1s;
}

.skp-panel-tab:hover  { color: #1a3060; background: #f0f4fb; }
.skp-panel-tab.active { color: #1a4aaa; background: #ffffff; border-bottom: 2px solid #3a80e8; }

.skp-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 0 16px;
}
.skp-panel-body::-webkit-scrollbar       { width: 4px; }
.skp-panel-body::-webkit-scrollbar-track { background: transparent; }
.skp-panel-body::-webkit-scrollbar-thumb { background: #c0ccd8; border-radius: 2px; }

.skp-section-label {
  padding: 10px 12px 5px;
  font-size: 9.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: #3a80e8;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* ── Outliner ── */
.skp-outliner-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 6px;
  border-bottom: 1px solid #e0e5ea;
  color: #90a0b0;
}

.skp-search-input {
  flex: 1;
  background: #ffffff;
  border: 1px solid #c8d0da;
  border-radius: 3px;
  color: #2a3a4a;
  padding: 3px 6px;
  font-size: 11px;
  outline: none;
}

.skp-search-input:focus       { border-color: #3a80e8; }
.skp-search-input::placeholder { color: #a0b0c0; }

.skp-tree { padding: 4px 0; }

.skp-tree-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  cursor: pointer;
  color: #4a5a6a;
  font-size: 12px;
}

.skp-tree-item:hover { background: #dce8f8; color: #1a3060; }
.skp-tree-root       { color: #2a3a50; font-weight: 600; }

.skp-arrow { flex-shrink: 0; color: #8090a8; transform: rotate(0deg); transition: transform 0.15s; }
.skp-arrow.open { transform: rotate(90deg); }

.skp-tree-children { padding-left: 14px; }
.skp-tree-l2       { padding-left: 28px; }

.skp-tree-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

.skp-tree-empty {
  padding: 8px 14px;
  color: #a0b0c0;
  font-style: italic;
  font-size: 11px;
}

/* ── Layers ── */
.skp-layers-toolbar {
  display: flex;
  gap: 4px;
  padding: 4px 8px 6px;
  border-bottom: 1px solid #e0e5ea;
}

.skp-icon-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  border: 1px solid #c8d0da;
  border-radius: 3px;
  color: #6080a0;
  cursor: pointer;
}
.skp-icon-btn:hover { background: #dce8f8; color: #1a3060; }

.skp-layers-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }

.skp-layers-table th {
  padding: 4px 8px;
  color: #90a0b0;
  font-weight: 600;
  text-align: left;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid #e0e5ea;
}

.skp-layer-row { cursor: pointer; }
.skp-layer-row td          { padding: 4px 8px; color: #5a6a7a; }
.skp-layer-row:hover td    { background: #dce8f8; color: #1a3060; }
.skp-layer-row.active td   { color: #1a3060; background: #eef4fc; }

.skp-layer-vis     { width: 12px; height: 12px; border: 1px solid #c0c8d4; border-radius: 2px; background: #f0f2f5; }
.skp-layer-vis.on  { background: #3a80e8; border-color: #2060c0; }
.skp-layer-color   { width: 14px; height: 14px; border-radius: 2px; }

/* ══════════════ VIEWPORT AREA ══════════════ */
.skp-viewport-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  min-width: 0;
}

.skp-scene-tabs {
  height: 28px;
  background: #e8eaee;
  border-bottom: 1px solid #c8cdd4;
  display: flex;
  align-items: flex-end;
  padding: 0 8px;
  gap: 2px;
  flex-shrink: 0;
  position: relative;
}

.skp-scene-tab {
  padding: 5px 14px 4px;
  background: #d8dde4;
  border: 1px solid #c0c8d4;
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  color: #607080;
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 500;
  transition: all 0.1s;
}

.skp-scene-tab:hover  { color: #1a3060; background: #e4eaf4; }
.skp-scene-tab.active { background: #f0f2f5; color: #1a2a3a; border-color: #b0bcc8; font-weight: 600; }

.skp-scene-add {
  padding: 4px 10px;
  background: none;
  border: none;
  color: #8090a8;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  margin-bottom: 2px;
  border-radius: 3px;
}
.skp-scene-add:hover { color: #3a80e8; background: #dce8f8; }

.skp-viewport {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

.skp-viewport canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}


/* ══════════════ NAV CUBE ══════════════ */
.skp-nav-cube {
  position: absolute;
  bottom: 24px; right: 16px;
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  pointer-events: none;
  user-select: none;
}
.skp-nav-cube.nc-active { pointer-events: auto; }

/* Cube wrapper */
.nc-cube-wrap {
  background: rgba(18,26,40,0.78);
  border-radius: 10px;
  padding: 4px;
  border: 1px solid rgba(80,110,160,0.45);
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  cursor: pointer;
}

/* SVG face polygons */
.nc-face {
  stroke: rgba(90,120,170,0.7);
  stroke-width: 0.8;
  cursor: pointer;
  transition: fill 0.12s;
}
.nc-top   { fill: rgba(40,65,110,0.92); }
.nc-right { fill: rgba(30,50,85,0.88); }
.nc-front { fill: rgba(22,40,68,0.85); }
.nc-face:hover { fill: rgba(58,128,232,0.75) !important; }

/* Quick-view buttons */
.nc-btns {
  display: flex; gap: 3px; flex-wrap: wrap; justify-content: center;
  max-width: 80px;
}
.nc-btn {
  height: 20px; min-width: 20px; padding: 0 5px;
  background: rgba(18,26,40,0.78);
  border: 1px solid rgba(80,110,160,0.45);
  border-radius: 4px;
  color: #7a9cc0; font-size: 9px; font-weight: 700; font-family: monospace;
  cursor: pointer; transition: all 0.12s;
  backdrop-filter: blur(4px);
  line-height: 18px;
}
.nc-btn:hover        { background: rgba(58,128,232,0.65); color: #fff; border-color: #3a80e8; }
.nc-btn-iso          { color: #a0c8e8; }
.nc-btn-iso:hover    { background: rgba(58,128,232,0.65); color: #fff; }

/* Axes */
.skp-axes { display: flex; gap: 6px; font-size: 10px; font-weight: 800; font-family: monospace; }
.axis.x { color: #e05050; }
.axis.y { color: #30b870; }
.axis.z { color: #4a9eff; }

/* ══════════════ RIGHT PANEL CONTENT ══════════════ */
.skp-prop-group {
  margin: 0 10px;
  border: 1px solid #e4eaf2;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.skp-prop-row {
  display: flex;
  align-items: center;
  padding: 5px 10px;
  border-bottom: 1px solid #eef2f8;
  gap: 8px;
}
.skp-prop-row:last-child { border-bottom: none; }

.skp-prop-key {
  width: 58px; flex-shrink: 0;
  color: #8898b8; font-size: 10.5px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.3px;
}
.skp-prop-val {
  flex: 1; color: #1a2535; font-size: 11.5px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.skp-prop-val.mono     { font-family: ui-monospace, "Cascadia Code", monospace; color: #1a55a8; font-size: 11px; }
.skp-prop-val.ok-text  { color: #1a7040; font-weight: 700; }
.skp-prop-val.err-text { color: #b02020; font-weight: 700; }

.skp-error-box {
  margin: 8px 10px;
  padding: 8px 10px;
  background: #fdeaea;
  border: 1px solid #e8b0b0;
  border-radius: 7px;
  color: #b02020;
  font-size: 11px;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.skp-action-grid { padding: 4px 10px; display: flex; flex-direction: column; gap: 5px; }

.skp-action-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: #ffffff;
  border: 1px solid #dce6f0;
  border-radius: 7px;
  color: #2a4060;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.12s;
  text-align: left;
  box-shadow: 0 1px 3px rgba(30,60,100,0.06);
}

.skp-action-btn:hover    { background: #eef5ff; color: #1a3a80; border-color: #90b8e8; box-shadow: 0 2px 6px rgba(58,128,232,0.12); }
.skp-action-btn:disabled { opacity: 0.38; cursor: not-allowed; box-shadow: none; }


/* Styles panel */
.skp-style-grid {
  padding: 6px 8px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.skp-style-item {
  display: flex; flex-direction: column; align-items: center;
  gap: 4px; cursor: pointer; padding: 4px;
  border-radius: 4px; border: 1px solid transparent;
  font-size: 10px; color: #6a7888;
}

.skp-style-item:hover  { background: #dce8f8; color: #1a3060; }
.skp-style-item.active { border-color: #80b0e8; background: #dce8f8; color: #1a4aaa; }

.skp-style-preview { width: 44px; height: 32px; border-radius: 3px; border: 1px solid #c8d0da; overflow: hidden; }

.skp-style-preview.textured {
  background: linear-gradient(135deg,#b8c8a8 25%,#c8d8b8 25%,#c8d8b8 50%,#b8c8a8 50%,#b8c8a8 75%,#c8d8b8 75%);
  background-size: 8px 8px;
}
.skp-style-preview.shaded      { background: linear-gradient(145deg,#90b0d0,#5070a0); }
.skp-style-preview.wireframe   { background: #f0f4f8; background-image: linear-gradient(#b0c8e0 1px,transparent 1px),linear-gradient(90deg,#b0c8e0 1px,transparent 1px); background-size: 8px 8px; }
.skp-style-preview.hidden-line { background: #f8f8f8; background-image: linear-gradient(#ccc 1px,transparent 1px),linear-gradient(90deg,#ccc 1px,transparent 1px); background-size: 8px 8px; }
.skp-style-preview.mono-style  { background: linear-gradient(145deg,#e8e8e8,#a8a8a8); }
.skp-style-preview.xray        { background: linear-gradient(145deg,rgba(80,140,220,0.25),rgba(40,90,180,0.12)); border-color: #3a80e8; }

.skp-edge-opts { padding: 0 10px; display: flex; flex-direction: column; gap: 4px; }

.skp-checkbox-row { display: flex; align-items: center; gap: 7px; cursor: pointer; color: #5a6878; font-size: 11.5px; padding: 2px 0; }
.skp-checkbox-row:hover { color: #1a3060; }
.skp-cb { accent-color: #3a80e8; width: 12px; height: 12px; cursor: pointer; }

/* ══════════════ STATUS BAR ══════════════ */
.skp-statusbar {
  height: 24px;
  background: #e8eaed;
  border-top: 1px solid #c8cdd4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  flex-shrink: 0;
}

.skp-statusbar-left, .skp-statusbar-right { display: flex; align-items: center; gap: 8px; }

.skp-status-tool  { display: flex; align-items: center; gap: 5px; color: #2060c0; font-weight: 600; font-size: 11px; }
.skp-status-hint  { color: #7888a0; font-size: 11px; }
.skp-status-sep   { color: #c0c8d4; }
.skp-coord        { font-size: 11px; color: #7888a0; font-family: monospace; }
.skp-coord b      { color: #2060a0; }
.skp-status-dim   { font-size: 11px; color: #90a0b0; }

/* ══════════════ HIDDEN INPUT ══════════════ */
.skp-hidden-input { display: none; }

/* ══════════════ TAKEOFF PANEL ══════════════ */
.tf-tab { position: relative; }

.tf-badge {
  position: absolute; top: 4px; right: 4px;
  background: #e05020; color: #fff;
  font-size: 9px; font-weight: 700;
  border-radius: 8px; padding: 1px 4px; line-height: 1.2;
}

.tf-sel-badge { background: #dce8f8; color: #2060c0; border-radius: 3px; padding: 1px 6px; font-size: 10px; }

.tf-sel-card {
  margin: 0 8px 6px; padding: 8px;
  background: #eef4fc;
  border: 1px solid #b0c8e8;
  border-left: 3px solid #3a80e8;
  border-radius: 4px;
}

.tf-sel-name { font-size: 12px; font-weight: 700; color: #1a3060; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.tf-sel-dims { display: flex; gap: 6px; margin-bottom: 6px; }
.tf-sel-dims span { font-size: 10.5px; color: #4060a0; background: #dce8f8; border-radius: 3px; padding: 2px 6px; font-family: monospace; }

.tf-sel-metrics { display: flex; flex-direction: column; gap: 3px; }
.tf-metric { display: flex; justify-content: space-between; font-size: 11px; }
.tf-metric span { color: #7888a0; }
.tf-metric b    { color: #2a4a70; font-weight: 600; }

/* Form */
.tf-form {
  padding: 0 8px 8px;
  display: flex; flex-direction: column; gap: 6px;
  border-bottom: 1px solid #d8e4f0;
}

.tf-label {
  display: flex; flex-direction: column; gap: 3px;
  font-size: 10.5px; color: #7888a0; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.4px;
}

.tf-input { background: #ffffff; border: 1px solid #c0d0e4; border-radius: 3px; color: #2a3a4a; padding: 4px 7px; font-size: 12px; outline: none; width: 100%; }
.tf-input:focus { border-color: #3a80e8; }
.tf-select { cursor: pointer; }
.tf-select option { background: #ffffff; color: #2a3a4a; }

.tf-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }

.tf-add-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 2px; }

.tf-preview-price { font-size: 12px; font-weight: 700; color: #1a7040; font-family: monospace; }

.tf-add-btn {
  padding: 5px 14px;
  background: #dce8f8; border: 1px solid #80b0e8;
  border-radius: 4px; color: #1a4aaa;
  font-size: 12px; font-weight: 700; cursor: pointer;
  transition: all 0.1s; white-space: nowrap;
}
.tf-add-btn:hover    { background: #c8dff8; color: #103080; border-color: #5090d8; }
.tf-add-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Item list */
.tf-clear-btn { margin-left: auto; background: none; border: none; color: #c08888; font-size: 10px; cursor: pointer; padding: 0 4px; }
.tf-clear-btn:hover { color: #b02020; }

.tf-item-list { padding: 0 8px; display: flex; flex-direction: column; gap: 4px; }

.tf-extracting {
  display: flex; align-items: center; gap: 7px;
  padding: 10px 12px; font-size: 12px; color: #3a80e8;
  background: #eef4fc; border-radius: 4px; margin: 0 8px;
}
.tf-spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.tf-item {
  background: #ffffff; border: 1px solid #d0dce8; border-radius: 6px;
  padding: 7px 8px; display: flex; flex-direction: column; gap: 3px;
  transition: opacity 0.2s;
}
.tf-item-deleting { opacity: 0.4; pointer-events: none; }

.tf-item-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.tf-item-name { font-size: 12px; font-weight: 600; color: #2a4060; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }

.tf-del-btn {
  flex-shrink: 0;
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  background: #fff0f0; border: 1px solid #e8c0c0;
  border-radius: 4px; color: #c04040; cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.tf-del-btn:hover:not(:disabled) { background: #fdd; color: #901818; border-color: #d09090; }
.tf-del-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.tf-item-meta { display: flex; gap: 4px; flex-wrap: wrap; }
.tf-cat-chip  { font-size: 10px; background: #eef4fc; color: #3060a0; border-radius: 3px; padding: 1px 5px; }
.tf-dims-chip { font-size: 10px; color: #8090a8; font-family: monospace; }

.tf-item-cost { display: flex; justify-content: space-between; font-size: 11px; color: #7888a0; }
.tf-item-cost b { color: #1a7040; font-weight: 700; }

.tf-total-bar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 10px; margin: 8px 8px 0;
  background: #eef4fc; border: 1px solid #b0c8e8; border-radius: 4px;
  font-size: 12px; color: #4060a0;
}

.tf-grand-total { font-size: 14px; font-weight: 800; color: #1a7040; font-family: monospace; }

.tf-save-area {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 8px 4px;
  border-top: 1px solid #d8e4f0;
  margin-top: 6px;
}

.tf-save-success {
  display: flex; align-items: center; gap: 6px;
  font-size: 11.5px; font-weight: 600; color: #1a7040;
  background: #e8f8ee; border: 1px solid #90d8a8;
  border-radius: 5px; padding: 5px 10px;
}

.tf-save-btn {
  display: flex; align-items: center; justify-content: center; gap: 7px;
  height: 36px; width: 100%;
  background: linear-gradient(135deg, #1e3a6e, #2a5aaa);
  border: none; border-radius: 7px;
  color: #ffffff; font-size: 13px; font-weight: 700;
  cursor: pointer; transition: all 0.15s;
  box-shadow: 0 3px 10px rgba(30,58,110,0.3);
}
.tf-save-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #162e5a, #1e4888);
  box-shadow: 0 4px 14px rgba(30,58,110,0.4);
  transform: translateY(-1px);
}
.tf-save-btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }

.tf-report-btn {
  display: flex; align-items: center; justify-content: center; gap: 7px;
  width: calc(100% - 16px); margin: 8px 8px 12px; padding: 8px;
  background: linear-gradient(135deg, #3a80e8, #2a60c8);
  border: none; border-radius: 5px;
  color: #ffffff; font-size: 12.5px; font-weight: 700; cursor: pointer;
  transition: all 0.15s;
  box-shadow: 0 2px 6px rgba(58,128,232,0.35);
}
.tf-report-btn:hover { background: linear-gradient(135deg,#2a70d8,#1a50b8); box-shadow: 0 3px 10px rgba(58,128,232,0.45); }

/* ══════════════ MODAL BASE ══════════════ */
/* ══════════════════════════════════════
   MODAL BACKDROP (shared)
══════════════════════════════════════ */
.tf-modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(15, 28, 50, 0.55);
  z-index: 9000;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  backdrop-filter: blur(3px);
}

.tf-modal {
  background: #f4f6f9;
  border: 1px solid #c4cdd8;
  border-radius: 10px;
  width: 100%; max-width: 920px; max-height: 92vh;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 64px rgba(0,0,0,0.28);
  overflow: hidden;
}

/* ── reuse for SKP guide modal ── */
.tf-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid #d8e0ea;
  flex-shrink: 0;
  background: #f5f8fc;
  border-radius: 10px 10px 0 0;
}
.tf-modal-title { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 700; color: #1a2a3a; }
.tf-modal-actions { display: flex; gap: 8px; align-items: center; }
.tf-print-btn { padding: 5px 14px; background: #dce8f8; border: 1px solid #80b0e8; border-radius: 4px; color: #1a4aaa; font-size: 12px; cursor: pointer; }
.tf-print-btn:hover { background: #c8dff8; }
.tf-close-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: #fdeaea; border: 1px solid #e8b0b0; border-radius: 4px; color: #b07070; font-size: 13px; cursor: pointer; }
.tf-close-btn:hover { background: #fbd8d8; color: #b02020; }
.tf-modal-body { flex: 1; overflow-y: auto; padding: 0; }
.tf-modal-body::-webkit-scrollbar       { width: 6px; }
.tf-modal-body::-webkit-scrollbar-thumb { background: #c0ccd8; border-radius: 3px; }

/* ══════════════════════════════════════
   BOQ MODAL — toolbar
══════════════════════════════════════ */
.boq-modal { background: #eef1f6; }

.boq-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 18px;
  background: #1e2d44;
  flex-shrink: 0;
  border-radius: 10px 10px 0 0;
}
.boq-toolbar-left { display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 700; color: #e0eaf8; }
.boq-toolbar-right { display: flex; align-items: center; gap: 8px; }

.boq-btn-print {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 16px; background: #3a80e8; border: none;
  border-radius: 6px; color: #fff; font-size: 12px; font-weight: 700;
  cursor: pointer; transition: background 0.15s;
}
.boq-btn-print:hover { background: #2a68cc; }

.boq-btn-close {
  width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
  border-radius: 6px; color: #a0b8d0; cursor: pointer; transition: background 0.15s;
}
.boq-btn-close:hover { background: rgba(255,60,60,0.25); color: #fff; }

/* ══════════════════════════════════════
   BOQ PAGE (print area)
══════════════════════════════════════ */
.boq-page {
  background: #ffffff;
  margin: 20px;
  border-radius: 8px;
  border: 1px solid #d0dae8;
  box-shadow: 0 2px 12px rgba(0,0,0,0.07);
  padding: 32px 36px;
  font-family: "Noto Sans Thai", -apple-system, "Segoe UI", sans-serif;
}

/* ── Header ── */
.boq-header {
  display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
  margin-bottom: 20px;
}
.boq-header-brand { display: flex; align-items: flex-start; gap: 14px; }
.boq-logo {
  width: 44px; height: 44px; background: #eef4fc; border: 1px solid #c0d4f0;
  border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.boq-company { font-size: 10px; color: #7888a0; font-weight: 500; letter-spacing: 0.3px; margin-bottom: 3px; }
.boq-doc-title { font-size: 18px; font-weight: 800; color: #0f1e32; letter-spacing: -0.3px; line-height: 1.2; }
.boq-doc-sub { font-size: 11px; color: #8898b0; margin-top: 2px; }

.boq-info-table { border-collapse: collapse; font-size: 11.5px; }
.boq-info-table tr + tr td { padding-top: 4px; }
.boq-info-lbl { color: #8898b0; font-weight: 600; padding-right: 10px; white-space: nowrap; vertical-align: top; }
.boq-info-val { color: #1a2535; font-weight: 600; }

/* ── Divider ── */
.boq-divider { height: 2px; background: linear-gradient(90deg, #1e3a6e, #3a80e8 40%, #60b8ff 70%, transparent); border-radius: 2px; margin-bottom: 18px; }

/* ── Summary row ── */
.boq-summary-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; }
.boq-summary-chip {
  display: flex; flex-direction: column; align-items: flex-start;
  background: #f4f8ff; border: 1px solid #c8d8f0;
  border-radius: 7px; padding: 8px 14px; min-width: 140px;
}
.boq-chip-cat { font-size: 10px; color: #5a7098; font-weight: 600; letter-spacing: 0.3px; }
.boq-chip-amt { font-size: 14px; font-weight: 800; color: #1a4a90; font-family: monospace; margin-top: 2px; }

/* ── Section ── */
.boq-section { margin-bottom: 28px; }

.boq-section-header {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 0; padding: 8px 12px;
  background: #f0f5fc; border-radius: 6px 6px 0 0;
  border: 1px solid #c8d8f0; border-bottom: none;
}
.boq-section-accent { width: 4px; height: 18px; background: #3a80e8; border-radius: 2px; flex-shrink: 0; }
.boq-section-title { font-size: 13px; font-weight: 800; color: #1a3a70; flex: 1; }
.boq-section-count { font-size: 11px; color: #7888a0; }
.boq-section-subtotal { font-size: 13px; font-weight: 800; color: #1a5a30; font-family: monospace; }

/* ── Table ── */
.boq-table { width: 100%; border-collapse: collapse; font-size: 12px; border: 1px solid #c8d8f0; }

.boq-table thead tr { background: #1e2d44; }
.boq-table th { padding: 8px 10px; font-size: 10.5px; font-weight: 700; color: #a8c8f0; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap; }

.boq-table td { padding: 7px 10px; border-bottom: 1px solid #e4ecf4; color: #2a3a50; vertical-align: middle; }
.boq-row-alt td { background: #f7f9fc; }
.boq-table tbody tr:hover td { background: #eef4fc; }

.boq-th-no, .boq-td-no   { width: 36px; text-align: center; color: #8898b0 !important; }
.boq-th-name, .boq-td-name { font-weight: 600; }
.boq-th-dims, .boq-td-dims { font-family: monospace; font-size: 11px; color: #7888a0 !important; white-space: nowrap; }
.boq-th-num, .boq-td-num  { text-align: right; font-family: monospace; white-space: nowrap; }
.boq-th-unit, .boq-td-unit { text-align: center; color: #5a7090 !important; white-space: nowrap; }
.boq-th-total, .boq-td-total { text-align: right; font-family: monospace; font-weight: 700; color: #1a5a30 !important; white-space: nowrap; }

.boq-subtotal-row td { background: #e8f0fc; padding: 7px 10px; }
.boq-subtotal-lbl { text-align: right; font-size: 11.5px; font-weight: 700; color: #2a4a80; }
.boq-subtotal-val { text-align: right; font-family: monospace; font-size: 12px; font-weight: 800; color: #1a4a8a; border-left: 2px solid #3a80e8; }

/* ── Grand total ── */
.boq-grand {
  margin-top: 24px;
  background: linear-gradient(135deg, #0f1e32 0%, #1e3a6e 60%, #1a5080 100%);
  border-radius: 8px; padding: 20px 28px;
  box-shadow: 0 4px 16px rgba(20,50,100,0.25);
}
.boq-grand-inner { display: flex; justify-content: space-between; align-items: center; }
.boq-grand-label { font-size: 15px; font-weight: 800; color: #e8f0fc; }
.boq-grand-sub   { font-size: 11px; color: #7898c0; margin-top: 3px; }
.boq-grand-num   { font-size: 28px; font-weight: 900; color: #60e890; font-family: monospace; letter-spacing: -0.5px; text-align: right; }
.boq-grand-currency { font-size: 11px; color: #60d880; text-align: right; margin-top: 2px; }

/* ── Footer ── */
.boq-footer {
  display: flex; align-items: flex-start; gap: 7px;
  margin-top: 20px; padding-top: 14px;
  border-top: 1px dashed #d0dae8;
  font-size: 10.5px; color: #9aabb8; line-height: 1.5;
}

/* ══════════════ EMPTY-STATE DROP ZONE ══════════════ */
/* ══ Loading Overlay ══ */
.skp-loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(240, 244, 250, 0.92);
  backdrop-filter: blur(4px);
  z-index: 50;
}

.skp-loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  background: #ffffff;
  border: 1px solid #d0daea;
  border-radius: 16px;
  padding: 36px 48px;
  box-shadow: 0 12px 40px rgba(40, 80, 140, 0.14);
  min-width: 320px;
  text-align: center;
}

.skp-loading-icon {
  position: relative;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.skp-loading-pulse {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(58,128,232,0.15) 0%, transparent 70%);
  animation: pulse-ring 1.6s ease-in-out infinite;
}

@keyframes pulse-ring {
  0%   { transform: scale(0.8); opacity: 0.8; }
  50%  { transform: scale(1.2); opacity: 0.3; }
  100% { transform: scale(0.8); opacity: 0.8; }
}

.skp-spin-slow {
  animation: spin-slow 3s linear infinite;
}

@keyframes spin-slow {
  from { transform: rotateY(0deg); }
  to   { transform: rotateY(360deg); }
}

.skp-loading-filename {
  font-size: 13px;
  font-weight: 700;
  color: #1a2535;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skp-loading-step {
  font-size: 12px;
  color: #5a7090;
  min-height: 18px;
}

.skp-loading-track {
  width: 100%;
  height: 6px;
  background: #e4ecf8;
  border-radius: 99px;
  overflow: hidden;
}

.skp-loading-fill {
  height: 100%;
  background: linear-gradient(90deg, #3a80e8, #60b8ff);
  border-radius: 99px;
  transition: width 0.4s ease;
}

.skp-loading-pct {
  font-size: 11px;
  font-weight: 700;
  color: #3a80e8;
  letter-spacing: 0.5px;
}

/* ══════════════ DROP ZONE ══════════════ */
.skp-dropzone {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: #e8edf4;
  cursor: pointer; z-index: 5;
  overflow: hidden;
}

/* dot-grid pattern */
.dz-bg-dots {
  position: absolute; inset: 0;
  background-image: radial-gradient(circle, #b8c8dc 1px, transparent 1px);
  background-size: 28px 28px;
  opacity: 0.55;
  pointer-events: none;
}

/* card */
.dz-panel {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 0;
  background: #ffffff;
  border: 1px solid #d0daea;
  border-radius: 16px;
  padding: 36px 40px 32px;
  width: 480px;
  box-shadow: 0 4px 24px rgba(30,60,110,0.10), 0 1px 4px rgba(0,0,0,0.06);
  transition: box-shadow 0.2s, border-color 0.2s;
}
.skp-dropzone:hover .dz-panel,
.skp-dropzone.dz-hover .dz-panel {
  box-shadow: 0 8px 40px rgba(30,90,200,0.14), 0 2px 8px rgba(0,0,0,0.08);
  border-color: #3a80e8;
}

/* icon ring */
.dz-ring {
  width: 68px; height: 68px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3a80e8 0%, #1a55c8 100%);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 20px rgba(58,128,232,0.35);
  margin-bottom: 20px;
  flex-shrink: 0;
  transition: transform 0.2s, box-shadow 0.2s;
}
.skp-dropzone:hover .dz-ring,
.skp-dropzone.dz-hover .dz-ring {
  transform: translateY(-3px);
  box-shadow: 0 10px 28px rgba(58,128,232,0.45);
}

/* heading */
.dz-text-block { text-align: center; margin-bottom: 24px; }
.dz-heading {
  margin: 0 0 6px;
  font-size: 18px; font-weight: 800; letter-spacing: -0.3px;
  color: #1a2535;
}
.dz-caption { margin: 0; font-size: 12.5px; color: #7080a0; }

/* format table */
.dz-fmt-table {
  width: 100%;
  display: flex; flex-direction: column; gap: 0;
  border: 1px solid #e0e8f0;
  border-radius: 10px; overflow: hidden;
  margin-bottom: 24px;
}
.dz-fmt-row {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 14px;
  border-bottom: 1px solid #edf1f7;
  transition: background 0.12s;
  cursor: default;
}
.dz-fmt-row:last-child { border-bottom: none; }
.dz-fmt-row.convert { cursor: pointer; }
.dz-fmt-row.supported:hover { background: #f6faf8; }
.dz-fmt-row.convert:hover   { background: #fffcf2; }

.dz-fmt-left {
  display: flex; align-items: center; gap: 7px;
  min-width: 88px; flex-shrink: 0;
}
.dz-fmt-left svg { color: #8090b0; }
.dz-fmt-row.supported .dz-fmt-left svg { color: #2a9a60; }
.dz-fmt-row.convert  .dz-fmt-left svg  { color: #c08000; }
.dz-fmt-left strong {
  font-size: 12px; font-weight: 800; letter-spacing: 0.2px;
  color: #3a4a5a; font-family: ui-monospace, "Cascadia Code", monospace;
}
.dz-fmt-desc { flex: 1; font-size: 11px; color: #8090a8; }

.dz-fmt-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 20px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.4px;
  flex-shrink: 0;
}
.dz-fmt-badge.green {
  background: #e6f8ee; color: #1a7a40;
  border: 1px solid #a8dfc0;
}
.dz-fmt-badge.amber {
  background: #fff8e0; color: #a07000;
  border: 1px solid #e0cc70;
}

/* CTA */
.dz-cta { display: flex; flex-direction: column; align-items: center; gap: 10px; }

.dz-open-btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 28px;
  background: linear-gradient(135deg, #3a80e8 0%, #1a55c8 100%);
  color: #fff; border-radius: 8px;
  font-size: 13px; font-weight: 700; letter-spacing: 0.2px;
  box-shadow: 0 3px 12px rgba(58,128,232,0.35);
  pointer-events: none;
  transition: all 0.15s;
}
.skp-dropzone:hover .dz-open-btn {
  box-shadow: 0 5px 18px rgba(58,128,232,0.45);
  transform: translateY(-1px);
}

.dz-shortcut {
  font-size: 11px; color: #a0b0c4;
  display: flex; align-items: center; gap: 4px;
}
.dz-shortcut kbd {
  display: inline-block;
  padding: 1px 6px; border-radius: 4px;
  background: #f0f4f8; border: 1px solid #c8d4e0;
  font-size: 10px; font-family: ui-monospace, monospace;
  color: #5a6878; line-height: 1.6;
  box-shadow: 0 1px 0 #b8c8d8;
}

.dz-error {
  display: flex; align-items: center; gap: 8px; margin-top: 16px;
  padding: 9px 14px; background: #fdeaea;
  border: 1px solid #e8b0b0; border-radius: 7px;
  color: #b02020; font-size: 12px; width: 100%;
}

.vp-hidden { display: none !important; }

.skp-file-drop-overlay {
  position: absolute; inset: 0;
  background: rgba(210,235,255,0.75);
  display: flex; align-items: center; justify-content: center;
  border: 2px dashed #3a80e8;
  pointer-events: none; z-index: 20;
  backdrop-filter: blur(2px);
}
.skp-file-drop-overlay .skp-drop-msg { flex-direction: column; gap: 8px; color: #1a5090; font-weight: 700; font-size: 15px; }
.skp-file-drop-overlay .skp-drop-msg small { font-size: 12px; color: #4070a0; font-weight: 400; }

/* ══════════════ PROJECT LIST MODAL ══════════════ */
.proj-modal { max-width: 560px; }
.proj-modal-body { padding: 16px; min-height: 200px; }

.proj-error {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 12px 14px; margin-bottom: 12px;
  background: #fdeaea; border: 1px solid #e8b0b0;
  border-radius: 6px; font-size: 12px; color: #b02020;
}
.proj-retry-btn {
  margin-left: auto; padding: 3px 10px;
  background: #fdeaea; border: 1px solid #e8b0b0;
  border-radius: 4px; color: #b02020; font-size: 11.5px;
  cursor: pointer; font-weight: 600;
}
.proj-retry-btn:hover { background: #fbd8d8; }

.proj-loading {
  display: flex; align-items: center; gap: 10px;
  justify-content: center; padding: 40px;
  color: #3a80e8; font-size: 13px;
}

.proj-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 48px 24px; text-align: center;
}
.proj-empty p     { font-size: 14px; font-weight: 600; color: #6878a0; margin: 0; }
.proj-empty small { font-size: 12px; color: #a0b0c8; }

.proj-list { display: flex; flex-direction: column; gap: 8px; }

.proj-card {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 16px;
  background: #ffffff; border: 1px solid #d0daea;
  border-radius: 8px; cursor: pointer;
  transition: all 0.15s;
}
.proj-card:hover { border-color: #3a80e8; box-shadow: 0 2px 12px rgba(58,128,232,0.12); transform: translateY(-1px); }
.proj-card.active { border-color: #3a80e8; background: #f0f7ff; }

.proj-card-icon {
  width: 44px; height: 44px; flex-shrink: 0;
  background: #eef4fc; border: 1px solid #c0d4f0;
  border-radius: 8px; display: flex; align-items: center; justify-content: center;
}
.proj-card-info { flex: 1; min-width: 0; }
.proj-card-name { font-size: 14px; font-weight: 700; color: #1a2535; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.proj-card-file { font-size: 11px; color: #7888a0; font-family: monospace; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.proj-card-meta { display: flex; gap: 6px; font-size: 11px; color: #a0b0c8; margin-top: 4px; }

.proj-card-action { flex-shrink: 0; }
.proj-active-badge {
  font-size: 10.5px; font-weight: 700; color: #1a5aaa;
  background: #dce8fc; border: 1px solid #a0c0f0;
  border-radius: 99px; padding: 2px 10px;
}

/* ══════════════ SKP GUIDE MODAL ══════════════ */
.skp-guide-modal { max-width: 680px; }
.skp-guide-body  { display: flex; flex-direction: column; gap: 14px; }

.skp-guide-file {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; background: #fffbf0;
  border: 1px solid #e0c870; border-radius: 4px;
  color: #8a6000; font-size: 12px; font-family: monospace;
}

.skp-guide-desc { margin: 0; font-size: 12.5px; color: #4a5a6a; line-height: 1.6; }
.skp-guide-desc b { color: #1a7040; }

.skp-method { background: #f8fafc; border: 1px solid #d0dcea; border-radius: 6px; overflow: hidden; }

.skp-method-header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; background: #eef4fc;
  border-bottom: 1px solid #d0dcea;
  font-size: 12.5px; font-weight: 600; color: #2a4060;
}

.skp-method-num {
  width: 20px; height: 20px; border-radius: 50%;
  background: #dce8f8; color: #2060c0;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 800; flex-shrink: 0;
}

.skp-method-tag { margin-left: auto; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 3px; }
.skp-method-tag.recommended { background: #d4f0e0; color: #1a6030; }
.skp-method-tag.free        { background: #dce8f8; color: #1a4aaa; }

.skp-steps { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }

.skp-step { display: flex; align-items: baseline; gap: 8px; font-size: 12px; color: #4a5a6a; line-height: 1.5; }
.step-num { flex-shrink: 0; color: #90a8c0; font-weight: 700; }

.skp-step code { background: #eef4fc; color: #1a4080; padding: 1px 5px; border-radius: 3px; font-size: 11.5px; font-family: monospace; }
.skp-step b    { color: #2060c0; }

.skp-tip { display: flex; align-items: flex-start; gap: 7px; padding: 6px 12px 10px; font-size: 11.5px; color: #5070a0; }
.skp-tip b { color: #2060c0; }

.skp-online-list { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.skp-online-item { display: flex; align-items: baseline; gap: 10px; font-size: 12px; }
.skp-online-item code  { background: #eef4fc; color: #1a4080; padding: 2px 7px; border-radius: 3px; font-family: monospace; font-size: 11.5px; white-space: nowrap; }
.skp-online-item small { color: #8090a8; }

.skp-compare        { margin-top: 4px; }
.skp-compare-header { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #8090a8; margin-bottom: 6px; }

.skp-compare-table { width: 100%; border-collapse: collapse; font-size: 12px; }

.skp-compare-table th { background: #f0f4f8; color: #7888a0; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.4px; padding: 5px 8px; text-align: left; border-bottom: 1px solid #d0dcea; }
.skp-compare-table td { padding: 5px 8px; border-bottom: 1px solid #e8ecf2; color: #4a5a6a; }

.skp-compare-table .ok-row td:nth-child(2)   { color: #1a7040; font-weight: 600; }
.skp-compare-table .warn-row td:nth-child(2) { color: #b02020; }
.skp-compare-table .ok-row td:first-child    { color: #1a7040; font-weight: 700; }
.skp-compare-table .warn-row td:first-child  { color: #a06020; }

/* ── Print styles ── */
@media print {
  /* ซ่อนทุกอย่าง ยกเว้น print area */
  * { box-sizing: border-box; }
  body, html { height: auto !important; overflow: visible !important; }

  .skp-app > *:not(.tf-modal-backdrop) { display: none !important; }

  /* ปลด fixed/flex/overflow ทั้งหมด */
  .tf-modal-backdrop {
    position: static !important;
    background: none !important;
    padding: 0 !important;
    display: block !important;
    height: auto !important;
    overflow: visible !important;
  }
  .boq-modal {
    background: #fff !important;
    box-shadow: none !important;
    border: none !important;
    max-height: none !important;
    height: auto !important;
    width: 100% !important;
    border-radius: 0 !important;
    display: block !important;
    overflow: visible !important;
  }
  .tf-modal-body {
    overflow: visible !important;
    height: auto !important;
    max-height: none !important;
    padding: 0 !important;
    display: block !important;
  }

  /* ซ่อน toolbar */
  .no-print { display: none !important; }

  /* BOQ page */
  .boq-page {
    margin: 0 !important;
    border: none !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    padding: 16px 20px !important;
    page-break-inside: auto;
  }

  /* ตัดหน้าระหว่าง section */
  .boq-section { page-break-inside: avoid; }
  .boq-grand   { page-break-inside: avoid; page-break-before: auto; }

  /* รักษาสีพื้นหลัง */
  .boq-table thead tr { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #1e2d44 !important; }
  .boq-grand          { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: linear-gradient(135deg,#0f1e32,#1e3a6e 60%,#1a5080) !important; }
  .boq-summary-chip   { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #f4f8ff !important; }
  .boq-section-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #f0f5fc !important; }
  .boq-row-alt td     { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #f7f9fc !important; }
  .boq-subtotal-row td { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #e8f0fc !important; }
}

/* ════════════════════ SAVE PROJECT MODAL ════════════════════ */
.save-modal { max-width: 420px; }
.save-modal-body { padding: 20px 24px 24px; display: flex; flex-direction: column; gap: 10px; }
.save-name-label { font-size: 13px; font-weight: 600; color: #c8d0dc; }
.save-name-input {
  width: 100%; padding: 9px 12px; border-radius: 7px;
  border: 1.5px solid #2e3a4e; background: #1a2332; color: #e2e8f2;
  font-size: 14px; outline: none; box-sizing: border-box;
  transition: border-color .18s;
}
.save-name-input:focus { border-color: #3a80e8; }
.save-name-input::placeholder { color: #4a6080; }
.save-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.save-cancel-btn {
  padding: 8px 18px; border-radius: 7px; border: 1.5px solid #2e3a4e;
  background: transparent; color: #8899aa; font-size: 13px; cursor: pointer;
  transition: background .15s;
}
.save-cancel-btn:hover { background: #1e2d3e; color: #c8d0dc; }
.save-confirm-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 20px; border-radius: 7px; border: none;
  background: #3a80e8; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
  transition: background .15s;
}
.save-confirm-btn:hover:not(:disabled) { background: #2c6fd4; }
.save-confirm-btn:disabled { background: #1e3a60; color: #4a6080; cursor: not-allowed; }

/* ══════════════════════════ AI PRICE CARD ══════════════════════════ */

/* Card container */
.tf-ai-card {
  margin: 8px 0 4px;
  border: 1.5px solid #2a3a52;
  border-radius: 10px;
  background: #111e2e;
  overflow: hidden;
  transition: border-color .2s;
}
.tf-ai-card--active { border-color: #4a60b0; }

/* Header */
.tf-ai-card-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px;
  background: #162030;
  border-bottom: 1px solid #2a3a52;
}
.tf-ai-card-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 11.5px; font-weight: 700; color: #a0b8d8;
  letter-spacing: .3px;
}
.tf-ai-ask-btn {
  display: flex; align-items: center; gap: 5px;
  padding: 4px 10px; border: none; border-radius: 5px;
  background: linear-gradient(135deg, #6a3de8, #3a72e8);
  color: #fff; font-size: 11px; font-weight: 700;
  cursor: pointer; white-space: nowrap; transition: opacity .15s;
}
.tf-ai-ask-btn:hover:not(:disabled) { opacity: .85; }
.tf-ai-ask-btn:disabled { opacity: .35; cursor: not-allowed; }

/* States inside card */
.tf-ai-loading {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 14px; font-size: 11.5px; color: #8090b0;
}
.tf-ai-err-box {
  display: flex; align-items: flex-start; gap: 7px;
  padding: 10px 14px; font-size: 11.5px;
  color: #d06060; background: #1e1010;
  border-top: 1px solid #3a1818;
}
.tf-ai-empty {
  padding: 12px 14px; font-size: 11px; color: #505878;
  line-height: 1.5;
}
.tf-ai-empty b { color: #7090c0; }

/* Price row: suggested + range */
.tf-ai-price-row {
  display: flex; align-items: flex-start; gap: 0;
  padding: 12px 14px 8px;
  border-bottom: 1px solid #1e2c40;
}
.tf-ai-suggest { flex: 1; }
.tf-ai-suggest-label { font-size: 9.5px; color: #6070a0; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 2px; }
.tf-ai-suggest-value {
  font-size: 22px; font-weight: 800; color: #5aabff; line-height: 1.1;
}
.tf-ai-suggest-value span { font-size: 12px; font-weight: 600; color: #6080b0; }

.tf-ai-confidence {
  display: inline-block; margin-top: 5px;
  font-size: 9.5px; font-weight: 700; border-radius: 4px; padding: 2px 7px;
}
.tf-conf-high   { background: #1a3820; color: #4dc870; }
.tf-conf-medium { background: #2e2a10; color: #c8a020; }
.tf-conf-low    { background: #2e1a10; color: #c86020; }

.tf-ai-range { flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; }
.tf-ai-range-row { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
.tf-ai-range-label { font-size: 9.5px; color: #506080; min-width: 34px; text-align: right; }
.tf-ai-range-val { font-size: 11.5px; font-weight: 700; font-family: monospace; min-width: 80px; text-align: right; }
.tf-val-min { color: #50c870; }
.tf-val-max { color: #e86060; }

/* Bar */
.tf-ai-bar-wrap { padding: 4px 14px 10px; }
.tf-ai-bar-track {
  position: relative; height: 8px;
  background: #1e2c40; border-radius: 4px; margin: 6px 0 4px;
}
.tf-ai-bar-fill {
  position: absolute; top: 0; bottom: 0;
  background: linear-gradient(90deg, #2a50a0, #3a80e8);
  border-radius: 4px; opacity: .5;
}
.tf-ai-bar-pin {
  position: absolute; top: 50%; transform: translate(-50%, -50%);
  width: 13px; height: 13px; border-radius: 50%; border: 2px solid #0d1825;
  box-shadow: 0 0 0 1.5px rgba(255,255,255,.2);
}
.tf-pin-suggest { background: #3a80e8; z-index: 2; }
.tf-pin-user    { background: #e87020; z-index: 3; }
.tf-ai-bar-legend {
  display: flex; align-items: center; gap: 10px; font-size: 9.5px; color: #506080;
}
.tf-ai-bar-legend span { display: flex; align-items: center; gap: 4px; }
.tf-ai-bar-range-text { margin-left: auto; font-family: monospace; color: #607090; }
.tf-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.tf-dot-suggest { background: #3a80e8; }
.tf-dot-user    { background: #e87020; }

/* Text content */
.tf-ai-reason {
  padding: 0 14px 6px;
  font-size: 11px; color: #8090b0; line-height: 1.55;
}
.tf-ai-notes {
  display: flex; align-items: flex-start; gap: 5px;
  padding: 0 14px 5px;
  font-size: 10.5px; color: #506880; font-style: italic; line-height: 1.45;
}
.tf-ai-warn-item {
  display: flex; align-items: center; gap: 5px;
  padding: 0 14px 5px;
  font-size: 10.5px; color: #c87830; font-weight: 600;
}

/* Apply button */
.tf-ai-apply-btn {
  display: block; width: calc(100% - 28px); margin: 2px 14px 12px;
  padding: 8px 0; border: 1.5px solid #3a80e8; border-radius: 6px;
  background: transparent; color: #5aabff;
  font-size: 12px; font-weight: 700; cursor: pointer;
  transition: background .15s, color .15s;
}
.tf-ai-apply-btn:hover { background: #1e3a60; color: #90c8ff; }

/* Anomaly strip (always-on warning below card) */
.tf-anomaly-strip {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 10px; border-radius: 6px;
  font-size: 11px; font-weight: 600; margin-bottom: 4px;
}
.tf-anomaly-strip--warn   { background: #211a00; color: #c8a020; border: 1px solid #50400a; }
.tf-anomaly-strip--danger { background: #200808; color: #d06060; border: 1px solid #501010; }

/* Anomaly icon in takeoff list items */
.tf-item-anomaly-icon {
  flex-shrink: 0; display: inline-flex; align-items: center;
  border-radius: 3px; padding: 2px 3px; margin-right: 2px;
}
.tf-icon-warn   { color: #c8a020; background: #211a00; }
.tf-icon-danger { color: #d06060; background: #200808; }

/* ════════════════════ ABOUT MODAL ════════════════════ */
.about-modal { max-width: 460px; }

.about-body {
  padding: 20px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.ab-brand {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 4px 0 16px;
}

.ab-logo {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: #eef4fc;
  border: 1px solid #c0d4f0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ab-name {
  font-size: 20px;
  font-weight: 800;
  color: #1a2535;
  letter-spacing: -0.3px;
}

.ab-sub {
  font-size: 12px;
  color: #5a7090;
  margin-top: 2px;
}

.ab-version {
  display: inline-block;
  margin-top: 6px;
  font-size: 11px;
  font-weight: 600;
  color: #3a80e8;
  background: #eef4fc;
  border: 1px solid #c0d4f0;
  border-radius: 999px;
  padding: 2px 10px;
}

.ab-divider {
  height: 1px;
  background: #e8eef4;
  margin: 12px 0;
}

.ab-section-label {
  font-size: 10.5px;
  font-weight: 700;
  color: #3a80e8;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 8px;
}

.ab-info-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 4px;
}

.ab-info-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
}

.ab-info-key {
  min-width: 110px;
  color: #7888a0;
  flex-shrink: 0;
}

.ab-info-val {
  color: #1a2535;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.ab-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 700;
  border-radius: 999px;
  padding: 2px 10px;
}

.ab-badge-blue  { background: #eef4fc; color: #2a60c8; border: 1px solid #c0d4f0; }
.ab-badge-green { background: #e8f8ee; color: #1a6030; border: 1px solid #90d8a8; }
.ab-badge-red   { background: #fdeaea; color: #b02020; border: 1px solid #e8b0b0; }
.ab-badge-gray  { background: #f0f4f8; color: #7888a0; border: 1px solid #d0daea; }

.ab-days-left {
  font-size: 11px;
  color: #7888a0;
  font-weight: 400;
}

.ab-copyright {
  font-size: 11.5px;
  color: #90a0b8;
  text-align: center;
  line-height: 1.7;
  padding-top: 4px;
}

.ab-copyright span {
  color: #b0bcc8;
}
</style>
