-- ══════════════════════════════════════════════════════════════════════════════
-- super_users table — ระบุว่าใครเป็น Super User ที่เข้า Management ได้
-- ══════════════════════════════════════════════════════════════════════════════
--
-- วิธีเพิ่ม Super User:
--   INSERT INTO public.super_users (user_id)
--   VALUES ('uuid-ของ-user-จาก-auth.users');
--
-- วิธีเช็คว่า user เป็น super user:
--   SELECT * FROM public.super_users WHERE user_id = auth.uid();

CREATE TABLE IF NOT EXISTS public.super_users (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- เปิด RLS
ALTER TABLE public.super_users ENABLE ROW LEVEL SECURITY;

-- Policy: user อ่านได้เฉพาะ record ของตัวเอง
-- (ใช้ตรวจสอบว่าตัวเองเป็น super user หรือไม่)
CREATE POLICY "super_users_read_own"
  ON public.super_users
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE: ทำได้เฉพาะผ่าน service_role (Admin เท่านั้น)
-- ไม่มี policy → authenticated user ทำไม่ได้

-- ══════════════════════════════════════════════════════════════════════════════
-- เพิ่ม Super User: Panupong.chinn@gmail.com
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO public.super_users (user_id)
SELECT id
FROM auth.users
WHERE email = 'Panupong.chinn@gmail.com'
ON CONFLICT (user_id) DO NOTHING;
