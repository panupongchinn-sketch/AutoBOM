// server/api/storage/download.get.ts
//
// Proxy สำหรับ Supabase Storage download
// — browser fetch ไปที่ /api/storage/download?path=... (same-origin, ไม่มี CORS)
// — server ค่อย fetch จาก Supabase ด้วย JWT ของ user

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { path: filePath } = getQuery(event)

  if (!filePath || typeof filePath !== "string") {
    throw createError({ statusCode: 400, statusMessage: "Missing path" })
  }

  const authHeader = getHeader(event, "authorization") || ""
  if (!authHeader.startsWith("Bearer ")) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" })
  }

  const storageUrl = `${config.public.SUPABASE_URL}/storage/v1/object/authenticated/bim-models/${filePath}`

  let storageRes: Response
  try {
    storageRes = await fetch(storageUrl, {
      headers: {
        Authorization: authHeader,
        apikey: config.public.SUPABASE_KEY as string,
      },
    })
  } catch (err: any) {
    throw createError({
      statusCode: 502,
      statusMessage: `Supabase Storage unreachable: ${err?.message}`,
    })
  }

  if (!storageRes.ok) {
    throw createError({
      statusCode: storageRes.status,
      statusMessage: await storageRes.text(),
    })
  }

  const contentType =
    storageRes.headers.get("Content-Type") || "application/octet-stream"
  setResponseHeader(event, "Content-Type", contentType)

  const buffer = await storageRes.arrayBuffer()
  return send(event, Buffer.from(buffer))
})
