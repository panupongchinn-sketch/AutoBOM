-- ══════════════════════════════════════════════════════════════════════════════
-- admin_gen_license() — Super User สร้าง License ให้ User คนใดคนหนึ่งโดยตรง
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Parameters:
--   p_target_user_id  UUID    — user ที่ต้องการให้ license
--   p_duration_days   INTEGER — จำนวนวัน (เช่น 30, 90, 365)
--   p_label           TEXT    — ชื่อแสดงผล (เช่น "1 เดือน", "1 ปี")
--
-- Returns: JSON { key, expires_at, label }

CREATE OR REPLACE FUNCTION public.admin_gen_license(
  p_target_user_id UUID,
  p_duration_days  INTEGER,
  p_label          TEXT
)
RETURNS JSON
SECURITY DEFINER
SET search_path = public, auth
LANGUAGE plpgsql
AS $$
DECLARE
  v_key        TEXT;
  v_key_id     UUID;
  v_expires_at TIMESTAMPTZ;
  v_user_email TEXT;
  v_seg1 TEXT; v_seg2 TEXT; v_seg3 TEXT;
BEGIN
  -- ── ตรวจสิทธิ์ Super User ──────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.super_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: ไม่มีสิทธิ์';
  END IF;

  -- ── ดึง email ของ user เป้าหมาย ────────────────────────────────────────
  SELECT email INTO v_user_email FROM auth.users WHERE id = p_target_user_id;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ User ที่ระบุ';
  END IF;

  -- ── Generate key แบบ BIMV-XXXX-XXXX-XXXX (ไม่ซ้ำ) ──────────────────────
  LOOP
    v_seg1 := upper(substring(replace(gen_random_uuid()::text, '-', '') for 4));
    v_seg2 := upper(substring(replace(gen_random_uuid()::text, '-', '') for 4));
    v_seg3 := upper(substring(replace(gen_random_uuid()::text, '-', '') for 4));
    v_key  := 'BIMV-' || v_seg1 || '-' || v_seg2 || '-' || v_seg3;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.license_keys WHERE key = v_key);
  END LOOP;

  -- ── คำนวณวันหมดอายุ ──────────────────────────────────────────────────────
  v_expires_at := NOW() + (p_duration_days || ' days')::INTERVAL;

  -- ── สร้าง license_keys record ผูกกับ user ทันที ──────────────────────────
  INSERT INTO public.license_keys (key, label, duration_days, is_active, bound_user_id, bound_email)
  VALUES (v_key, p_label, p_duration_days, true, p_target_user_id, v_user_email)
  RETURNING id INTO v_key_id;

  -- ── สร้าง / อัปเดต user_licenses ──────────────────────────────────────────
  INSERT INTO public.user_licenses (user_id, license_key_id, activated_at, expires_at)
  VALUES (p_target_user_id, v_key_id, NOW(), v_expires_at)
  ON CONFLICT (user_id) DO UPDATE
    SET license_key_id = EXCLUDED.license_key_id,
        activated_at   = EXCLUDED.activated_at,
        expires_at     = EXCLUDED.expires_at;

  RETURN json_build_object(
    'key',        v_key,
    'expires_at', v_expires_at,
    'label',      p_label
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_gen_license(UUID, INTEGER, TEXT) TO authenticated;
