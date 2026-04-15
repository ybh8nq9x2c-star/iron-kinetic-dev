import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/* ══════════════════════════════════════════════════════════════
   create-checkout-session — Iron Kinetic
   ──────────────────────────────────────────────────────────────
   POST /functions/v1/create-checkout-session
   Headers:
     Authorization: Bearer <supabase_access_token>   ← JWT utente
     apikey: <supabase_anon_key>
     Content-Type: application/json
   Body:
     { "plan": "monthly" | "annual" | "lifetime" }
     (accetta anche "price_tier" per compatibilità col client)
   Returns:
     200  { "url": "https://checkout.stripe.com/..." }
     400  { "error": "..." }   ← input non valido
     401  { "error": "..." }   ← auth fallita
     500  { "error": "..." }   ← errore interno / Stripe
   ══════════════════════════════════════════════════════════════ */

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://irokninetic-production.up.railway.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-jwt',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  /* ── 1. Read user JWT ──
     Prefer X-User-JWT custom header; fall back to Authorization. */
  const accessToken =
    req.headers.get('X-User-JWT') ??
    req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''

  if (!accessToken) {
    console.error('[checkout] Missing X-User-JWT header')
    return json({ error: 'Unauthorized — missing token' }, 401)
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
    return json({ error: 'Unauthorized — sessione non valida o scaduta' }, 401)
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
    return json({ error: `Piano non valido: "${plan}". Valori accettati: monthly, annual, lifetime` }, 400)
  }

  /* ── 3b. Validate referral_code against DB ── */
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
    if (!v) throw new Error(`Missing env var STRIPE_PRICE_${k.toUpperCase()}`)
  }
  const priceId = priceMap[plan]
  console.log('[checkout] plan=', plan, 'priceId=', priceId)

  /* ── 5. Verifica STRIPE_SECRET_KEY ── */
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) {
    console.error('[checkout] STRIPE_SECRET_KEY not set')
    return json({ error: 'Configurazione Stripe mancante — contatta il supporto' }, 500)
  }
  if (stripeKey.startsWith('sk_test_')) {
    console.warn('[checkout] ⚠️  ATTENZIONE: stai usando una STRIPE TEST key in produzione!')
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
    const session = await stripe.checkout.sessions.create(sessionParams)
    console.log('[checkout] session created:', session.id)

    if (!session.url) {
      console.error('[checkout] Stripe returned no URL for session:', session.id)
      return json({ error: 'Stripe non ha restituito un URL di checkout' }, 500)
    }

    return json({ url: session.url })

  } catch (stripeErr) {
    const msg = (stripeErr as Error).message
    console.error('[checkout] Stripe error:', msg)

    if (msg.includes('No such price')) {
      return json({ error: 'Errore durante la creazione della sessione di pagamento. Riprova più tardi.' }, 500)
    }
    if (msg.includes('Invalid API Key') || msg.includes('No such api key')) {
      return json({ error: 'Errore durante la creazione della sessione di pagamento. Riprova più tardi.' }, 500)
    }

    return json({ error: 'Errore durante la creazione della sessione di pagamento. Riprova più tardi.' }, 500)
  }
})
