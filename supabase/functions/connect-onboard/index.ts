import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

/* ══════════════════════════════════════════════════════════════
   connect-onboard — Iron Kinetic
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

/* ── Rate limiting: 5 requests per user per minute ── */
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    })

    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return json(req, { error: 'Unauthorized' }, 401)

    const { data: { user }, error: authError } = await sb.auth.getUser(token)
    if (authError || !user) return json(req, { error: 'Unauthorized' }, 401)

    /* ── Rate limit ── */
    if (!checkRateLimit(user.id, 5)) {
      return json(req, { error: 'Too many requests' }, 429)
    }

    const { data: userData } = await sb
      .from('users')
      .select('stripe_connect_account_id, stripe_connect_onboarded')
      .eq('id', user.id)
      .single()

    let accountId = userData?.stripe_connect_account_id

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'IT',
        email: user.email!,
        capabilities: { transfers: { requested: true } },
        business_type: 'individual',
        metadata: { supabase_user_id: user.id }
      })
      accountId = account.id

      await sb.from('users')
        .update({ stripe_connect_account_id: accountId })
        .eq('id', user.id)
    }

    // Se già onboardato → rimanda al dashboard Stripe Express
    if (userData?.stripe_connect_onboarded && accountId) {
      const loginLink = await stripe.accounts.createLoginLink(accountId)
      return json(req, { url: loginLink.url })
    }

    // Use APP_URL env var — never trust client-passed URLs
    const APP_URL = Deno.env.get('APP_URL') || 'https://irokninetic-production.up.railway.app'
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${APP_URL}?connect=refresh`,
      return_url:  `${APP_URL}?connect=success`,
      type: 'account_onboarding'
    })

    return json(req, { url: accountLink.url })

  } catch (err) {
    console.error('[connect-onboard]', err)
    return json(req, { error: 'Internal server error' }, 500)
  }
})
