import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/* ══════════════════════════════════════════════════════════════
   verify-subscription — Iron Kinetic
   ──────────────────────────────────────────────────────────────
   POST /functions/v1/verify-subscription
   Headers:
     Authorization: Bearer <supabase_access_token>
     apikey: <supabase_anon_key>
     Content-Type: application/json
   Returns:
     200  { access, mode, daysLeft, hoursLeft, plan, trial_end }
     401  { error: "..." }
     429  { error: "Rate limited" }
   ══════════════════════════════════════════════════════════════ */

const ALLOWED_ORIGINS = [
  'https://irokninetic-production.up.railway.app',
  'https://iron-kinetic.app',
  'http://localhost:3000',
]

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/* ── Rate limiting: 30 requests per user per minute ── */
const _rlMap = new Map<string, { count: number; expires: number }>()
function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const entry = _rlMap.get(userId)
  if (!entry || entry.expires < now) {
    _rlMap.set(userId, { count: 1, expires: now + 60_000 })
    return true
  }
  entry.count++
  return entry.count <= 30
}

/* ── Service-role client (bypasses RLS for reading user rows) ── */
function getServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  /* ── 1. Extract and verify user JWT ── */
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) {
    return json({ error: 'Missing authorization token' }, 401)
  }

  /* Use anon client to verify the JWT (validates signature + expiry) */
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  )
  const { data: { user }, error: authError } = await anonClient.auth.getUser(token)
  if (authError || !user) {
    return json({ error: 'Invalid or expired token' }, 401)
  }

  /* ── 2. Rate limit per user ── */
  if (!checkRateLimit(user.id)) {
    return json({ error: 'Too many requests — try again in a minute' }, 429)
  }

  /* ── 3. Read user subscription row with service role ── */
  const sb = getServiceClient()
  const { data, error } = await sb
    .from('users')
    .select('trend_active, trial_end, grace_period_until, plan')
    .eq('id', user.id)
    .single()

  if (error) {
    console.error('[verify-subscription] DB error:', error.message)
    return json({ error: 'Failed to read subscription data' }, 500)
  }

  /* ── 4. No row yet — initialize trial and grant access ── */
  if (!data) {
    const trialEnd = new Date(Date.now() + 7 * 86_400_000).toISOString()
    await sb.from('users').upsert({
      id: user.id,
      trial_end: trialEnd,
      trend_active: false,
      plan: null,
    })
    return json({
      access: true,
      mode: 'trial',
      daysLeft: 7,
      hoursLeft: 168,
      plan: null,
      trial_end: trialEnd,
    })
  }

  /* ── 5. Compute access status ── */
  const now = new Date()

  /* Paid subscriber (trend_active = true) */
  if (data.trend_active) {
    /* Check grace period — subscription may have payment issues */
    if (data.grace_period_until) {
      const graceEnd = new Date(data.grace_period_until)
      if (graceEnd > now) {
        const hoursLeft = Math.ceil((graceEnd.getTime() - now.getTime()) / 3_600_000)
        return json({
          access: true,
          mode: 'grace',
          daysLeft: Math.ceil(hoursLeft / 24),
          hoursLeft,
          plan: data.plan || 'monthly',
          trial_end: data.trial_end,
        })
      }
      /* Grace period expired — access revoked */
      return json({
        access: false,
        mode: 'none',
        daysLeft: 0,
        hoursLeft: 0,
        plan: data.plan || null,
        trial_end: data.trial_end,
      })
    }

    /* Active paid subscription */
    return json({
      access: true,
      mode: 'paid',
      daysLeft: 0,
      hoursLeft: 0,
      plan: data.plan || 'monthly',
      trial_end: data.trial_end,
    })
  }

  /* Trial still active */
  if (data.trial_end) {
    const trialEndDate = new Date(data.trial_end)
    if (trialEndDate > now) {
      const daysLeft = Math.ceil((trialEndDate.getTime() - now.getTime()) / 86_400_000)
      const hoursLeft = Math.ceil((trialEndDate.getTime() - now.getTime()) / 3_600_000)
      return json({
        access: true,
        mode: 'trial',
        daysLeft,
        hoursLeft,
        plan: data.plan || null,
        trial_end: data.trial_end,
      })
    }
  } else {
    /* Row exists but no trial_end — set it now (first access after signup) */
    const trialEnd = new Date(Date.now() + 7 * 86_400_000).toISOString()
    await sb
      .from('users')
      .update({ trial_end: trialEnd })
      .eq('id', user.id)
    return json({
      access: true,
      mode: 'trial',
      daysLeft: 7,
      hoursLeft: 168,
      plan: null,
      trial_end: trialEnd,
    })
  }

  /* ── 6. No access — trial expired, not paid ── */
  return json({
    access: false,
    mode: 'none',
    daysLeft: 0,
    hoursLeft: 0,
    plan: data.plan || null,
    trial_end: data.trial_end,
  })
})
