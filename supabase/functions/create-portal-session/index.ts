import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

/* ══════════════════════════════════════════════════════════════
   create-portal-session — Iron Kinetic
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }

  try {
    /* ── 1. Auth: extract JWT ── */
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json(req, { error: 'Missing Authorization header' }, 401)
    }

    const token = authHeader.replace('Bearer ', '')

    /* ── 2. Verify JWT with anon client ── */
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: authHeader } },
      }
    )

    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return json(req, { error: 'Invalid or expired token' }, 401)
    }

    /* ── 3. Rate limit ── */
    if (!checkRateLimit(user.id, 5)) {
      return json(req, { error: 'Too many requests' }, 429)
    }

    /* ── 4. Admin client for DB queries ── */
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    /* ── 5. Look up stripe_customer_id ── */
    const { data: userData, error: userError } = await adminClient
      .from('users')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single()

    if (userError || !userData?.stripe_customer_id) {
      return json(req, { error: 'No Stripe customer found' }, 400)
    }

    /* ── 6. Create Stripe Billing Portal session ── */
    const session = await stripe.billingPortal.sessions.create({
      customer: userData.stripe_customer_id,
      return_url: Deno.env.get('APP_URL') || 'https://irokninetic-production.up.railway.app',
    })

    return json(req, { url: session.url })

  } catch (err) {
    console.error('[portal] Error:', err)
    // Never expose internal error details to client
    return json(req, { error: 'Internal server error' }, 500)
  }
})
