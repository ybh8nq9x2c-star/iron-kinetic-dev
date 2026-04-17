import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/* ══════════════════════════════════════════════════════════════
   generate-referral-code — Iron Kinetic
   ══════════════════════════════════════════════════════════════ */

const ALLOWED_ORIGINS = [
  'https://irokninetic-production.up.railway.app',
  'https://iron-kinetic.app',
  'http://localhost:3000',
]

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

/* ── Rate limiting: 10 requests per user per minute ── */
const _rlMap = new Map<string, { count: number; expires: number }>()
function checkRateLimit(userId: string, maxReqs = 10): boolean {
  const now = Date.now()
  const entry = _rlMap.get(userId)
  if (!entry || entry.expires < now) {
    _rlMap.set(userId, { count: 1, expires: now + 60_000 })
    return true
  }
  entry.count++
  return entry.count <= maxReqs
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return json(req, { error: 'Unauthorized' }, 401)

    const { data: { user }, error: authError } = await sb.auth.getUser(token)
    if (authError || !user) return json(req, { error: 'Unauthorized' }, 401)

    /* ── Rate limit ── */
    if (!checkRateLimit(user.id, 10)) {
      return json(req, { error: 'Too many requests' }, 429)
    }

    // Idempotente: restituisce il codice esistente se già creato
    const { data: existing } = await sb
      .from('referral_codes')
      .select('code')
      .eq('user_id', user.id)
      .single()

    let code: string | null = existing?.code || null

    // Genera codice univoco con retry su collisione se non esiste
    if (!code) {
      for (let attempt = 0; attempt < 5; attempt++) {
        // Use crypto.getRandomValues for secure randomness (Deno compatible)
        const bytes = new Uint8Array(3)
        crypto.getRandomValues(bytes)
        const raw = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').substring(0, 6).toUpperCase()
        const candidate = 'IK-' + raw
        const { error: insertError } = await sb
          .from('referral_codes')
          .insert({ user_id: user.id, code: candidate })
        if (!insertError) { code = candidate; break }
      }
    }

    if (!code) throw new Error('Failed to generate unique code after 5 attempts')

    // Recupera dati utente (credito, connect status)
    const { data: userData } = await sb
      .from('users')
      .select('referral_credit_cents, stripe_connect_account_id, stripe_connect_onboarded')
      .eq('id', user.id)
      .single()

    // Conta referral confermati
    const { count } = await sb
      .from('referrals')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_id', user.id)
      .eq('status', 'confirmed')

    return json(req, {
      code,
      referral_credit_cents: userData?.referral_credit_cents || 0,
      stripe_connect_account_id: userData?.stripe_connect_account_id || null,
      stripe_connect_onboarded: userData?.stripe_connect_onboarded || false,
      confirmed_referrals: count || 0
    })

  } catch (err) {
    console.error('[generate-referral-code]', err)
    return json(req, { error: 'Internal server error' }, 500)
  }
})
