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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

  /* ── 1. Verifica Authorization header ── */
  const authHeader = req.headers.get('Authorization') ?? ''
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim()

  if (!accessToken) {
    console.error('[checkout] Missing Authorization header')
    return json({ error: 'Unauthorized — missing token' }, 401)
  }

  /* ── 2. Verifica JWT utente ──────────────────────────────────
     USA SUPABASE_SERVICE_ROLE_KEY (iniettata automaticamente da
     Supabase) + passa il JWT utente via global header.
     NON usare SUPABASE_ANON_KEY: non è una variabile built-in
     nelle Edge Functions e causa getUser() silenziosamente nullo.
  ─────────────────────────────────────────────────────────────── */
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
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
  try {
    const body = await req.json()
    plan = body?.plan ?? body?.price_tier ?? 'monthly'
  } catch {
    console.warn('[checkout] Body parse failed, defaulting plan=monthly')
  }

  const validPlans = ['monthly', 'annual', 'lifetime']
  if (!validPlans.includes(plan)) {
    console.error('[checkout] Invalid plan:', plan)
    return json({ error: `Piano non valido: "${plan}". Valori accettati: monthly, annual, lifetime` }, 400)
  }

  /* ── 4. Risolvi Price ID ── */
  const priceMap: Record<string, string> = {
    monthly:  Deno.env.get('STRIPE_PRICE_MONTHLY')  ?? 'price_1TLJO9JYTPcSrsvtFVhrRBAT',
    annual:   Deno.env.get('STRIPE_PRICE_ANNUAL')   ?? 'price_1TLJO9JYTPcSrsvts1UjmFlr',
    lifetime: Deno.env.get('STRIPE_PRICE_LIFETIME') ?? 'price_1TLJOAJYTPcSrsvtvdSkbwGr',
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
    metadata: { userId: user.id, supabase_uid: user.id, plan },
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
      return json({ error: `Price ID non trovato su Stripe (${priceId}). Verifica che i Price ID siano in modalità live.` }, 500)
    }
    if (msg.includes('Invalid API Key') || msg.includes('No such api key')) {
      return json({ error: 'Stripe API key non valida. Verifica STRIPE_SECRET_KEY nei Supabase secrets.' }, 500)
    }

    return json({ error: `Errore Stripe: ${msg}` }, 500)
  }
})
