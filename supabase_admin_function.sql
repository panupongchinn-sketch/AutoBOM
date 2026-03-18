-- ══════════════════════════════════════════════════════════════════════════════
-- admin_get_all_users() — ฟังก์ชัน SECURITY DEFINER สำหรับหน้า Management
--
-- ทำงานอย่างไร:
--   1. ตรวจว่าผู้เรียกอยู่ใน super_users หรือไม่ (ผ่าน auth.uid())
--   2. ถ้าไม่ใช่ → ปฏิเสธทันที (RAISE EXCEPTION)
--   3. ถ้าใช่ → ดึงข้อมูลจาก auth.users + public tables แล้วส่งกลับ
--
-- ไม่ต้องการ SUPABASE_SERVICE_KEY เลย!
-- รัน SQL นี้ใน Supabase SQL Editor ครั้งเดียว
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_get_all_users()
RETURNS TABLE (
  id           UUID,
  email        TEXT,
  full_name    TEXT,
  created_at   TIMESTAMPTZ,
  project_count BIGINT,
  license_key  TEXT,
  license_label TEXT,
  expires_at   TIMESTAMPTZ,
  is_super_user BOOLEAN
)
SECURITY DEFINER
SET search_path = public, auth
LANGUAGE plpgsql
AS $$
BEGIN
  -- ── ตรวจสิทธิ์: เฉพาะ super user เท่านั้น ──────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM public.super_users WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Forbidden: ไม่มีสิทธิ์เข้าถึงข้อมูลนี้';
  END IF;

  -- ── ดึงข้อมูลผู้ใช้ทั้งหมด ──────────────────────────────────────────────
  RETURN QUERY
  SELECT
    u.id,
    u.email::TEXT,
    COALESCE(u.raw_user_meta_data->>'full_name', '')::TEXT AS full_name,
    u.created_at,
    COUNT(DISTINCT p.id)::BIGINT                           AS project_count,
    lk.key::TEXT                                           AS license_key,
    lk.label::TEXT                                         AS license_label,
    ul.expires_at,
    EXISTS(
      SELECT 1 FROM public.super_users su WHERE su.user_id = u.id
    )                                                      AS is_super_user
  FROM auth.users u
  LEFT JOIN public.bim_projects   p  ON p.user_id        = u.id
  LEFT JOIN public.user_licenses  ul ON ul.user_id        = u.id
  LEFT JOIN public.license_keys   lk ON lk.id             = ul.license_key_id
  GROUP BY u.id, u.email, u.raw_user_meta_data, u.created_at,
           lk.key, lk.label, ul.expires_at;
END;
$$;

-- อนุญาตให้ authenticated user เรียกฟังก์ชันนี้ได้
-- (การตรวจสิทธิ์จริงอยู่ภายในฟังก์ชัน)
GRANT EXECUTE ON FUNCTION public.admin_get_all_users() TO authenticated;
