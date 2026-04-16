-- Enable RLS on users table
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Users can read their own row
CREATE POLICY "Users can read own row"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

-- Users can insert their own row (for syncUserAfterLogin)
CREATE POLICY "Users can insert own row"
  ON public.users FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Users can update their own row
CREATE POLICY "Users can update own row"
  ON public.users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Allow service role full access (for Edge Functions)
CREATE POLICY "Service role full access"
  ON public.users FOR ALL
  USING (auth.role() = 'service_role');
