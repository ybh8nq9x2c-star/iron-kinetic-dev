import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/* ══════════════════════════════════════════════════════════════
   create-checkout-session — Iron Kinetic
   ──────────────────────────────────────────────────────────────
   POST /functions/v1/create-checkout-session
   Headers:
     Authorization: Bearer <supabase_access_token>
     apikey: <supabase_anon_key>
     Content-Type: application/json
   Body:
     { "plan": "monthly" | "annual" | "lifetime" }
   Returns:
     200  { "url": "https://checkout.stripe.com/..." }
     400  { "error": "..." }
     401  { "error": "..." }
     500  { "error": "..." }
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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-jwt',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

/* ── Rate limiting: in-memory Map per user ── */
const _rlMap = new Map<string, { count: number; expires: number }>()
function checkRateLimit(userId: string, maxReqs = 5): boolean {
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }

  /* ── 1. Read user JWT ── */
  const accessToken =
    req.headers.get('X-User-JWT') ??
    req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''

  if (!accessToken) {
    return json(req, { error: 'Unauthorized — missing token' }, 401)
  }

  /* ── 2. Verify user JWT via service_role ── */
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: 'Bearer ' + accessToken } },
    }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    console.error('[checkout] JWT verification failed:', authError?.message ?? 'no user')
    return json(req, { error: 'Unauthorized — sessione non valida o scaduta' }, 401)
  }

  /* ── 2b. Rate limit per user ── */
  if (!checkRateLimit(user.id, 5)) {
    return json(req, { error: 'Too many requests — riprova tra qualche minuto' }, 429)
  }

  console.log('[checkout] user verified:', user.id, user.email)

  /* ── 3. Parse body ── */
  let plan = 'monthly'
  let referral_code = ''
  try {
    const body = await req.json()
    plan = body?.plan ?? body?.price_tier ?? 'monthly'
    referral_code = body?.referral_code ?? ''
  } catch {
    console.warn('[checkout] Body parse failed, defaulting plan=monthly')
  }

  const validPlans = ['monthly', 'annual', 'lifetime']
  if (!validPlans.includes(plan)) {
    console.error('[checkout] Invalid plan:', plan)
    return json(req, { error: 'Piano non valido' }, 400)
  }

  /* ── 3b. Sanitize referral_code: alphanumeric + dash, max 32 chars ── */
  if (referral_code) {
    referral_code = referral_code.replace(/[^A-Za-z0-9-]/g, '').substring(0, 32)
  }

  /* ── 3c. Validate referral_code against DB ── */
  if (referral_code) {
    const { data: referrer } = await supabase
      .from('referral_codes')
      .select('user_id')
      .eq('code', referral_code)
      .single()

    if (!referrer || referrer.user_id === user.id) {
      console.warn('[checkout] Invalid or self-referral code ignored:', referral_code)
      referral_code = ''
    } else {
      console.log('[checkout] Valid referral code:', referral_code, 'referrer:', referrer.user_id)
    }
  }

  /* ── 4. Risolvi Price ID ── */
  const priceMap: Record<string, string> = {
    monthly:  Deno.env.get('STRIPE_PRICE_MONTHLY')  || '',
    annual:   Deno.env.get('STRIPE_PRICE_ANNUAL')   || '',
    lifetime: Deno.env.get('STRIPE_PRICE_LIFETIME') || '',
  }
  for (const [k, v] of Object.entries(priceMap)) {
    if (!v) {
      console.error(`[checkout] Missing env var STRIPE_PRICE_${k.toUpperCase()}`)
      return json(req, { error: 'Configurazione Stripe mancante — contatta il supporto' }, 500)
    }
  }
  const priceId = priceMap[plan]
  console.log('[checkout] plan=', plan, 'priceId=', priceId)

  /* ── 5. Verifica STRIPE_SECRET_KEY ── */
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) {
    console.error('[checkout] STRIPE_SECRET_KEY not set')
    return json(req, { error: 'Configurazione Stripe mancante — contatta il supporto' }, 500)
  }
  if (stripeKey.startsWith('sk_test_')) {
    console.warn('[checkout] WARNING: using STRIPE TEST key in production!')
  }

  /* ── 6. Cerca customer Stripe esistente (evita duplicati) ── */
  let stripeCustomerId: string | undefined
  try {
    const { data: userData } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single()
    if (userData?.stripe_customer_id) {
      stripeCustomerId = userData.stripe_customer_id
      console.log('[checkout] existing Stripe customer:', stripeCustomerId)
    }
  } catch (e) {
    console.warn('[checkout] Could not fetch stripe_customer_id:', (e as Error).message)
  }

  /* ── 7. Crea Stripe Checkout Session ── */
  const stripe = new Stripe(stripeKey, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  })

  const origin =
    req.headers.get('origin') ??
    Deno.env.get('APP_URL') ??
    'https://irokninetic-production.up.railway.app'

  const isLifetime = plan === 'lifetime'

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: isLifetime ? 'payment' : 'subscription',
    client_reference_id: user.id,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/?trend=success`,
    cancel_url:  `${origin}/`,
    metadata: { userId: user.id, supabase_uid: user.id, plan, referral_code: referral_code || '' },
    ...(stripeCustomerId
      ? { customer: stripeCustomerId }
      : { customer_email: user.email }),
    ...(!isLifetime && {
      subscription_data: { metadata: { supabase_uid: user.id, plan } },
    }),
    ...(isLifetime && {
      payment_intent_data: { metadata: { supabase_uid: user.id, plan: 'lifetime' } },
    }),
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionParams, {
      idempotencyKey: `checkout_${user.id}_${plan}`,
    })
    console.log('[checkout] session created:', session.id)

    if (!session.url) {
      console.error('[checkout] Stripe returned no URL for session:', session.id)
      return json(req, { error: 'Errore durante la creazione della sessione di pagamento' }, 500)
    }

    // ── AREA 10a: Audit log ──
    await supabase.from('audit_log').insert({
      user_id:  user.id,
      action:   'checkout_session_created',
      metadata: { session_id: session.id, plan, referral_code: referral_code || null },
    })

    return json(req, { url: session.url })

  } catch (stripeErr) {
    const msg = (stripeErr as Error).message
    console.error('[checkout] Stripe error:', msg)
    // Never expose Stripe error details to client
    return json(req, { error: 'Errore durante la creazione della sessione di pagamento. Riprova più tardi.' }, 500)
  }
})
