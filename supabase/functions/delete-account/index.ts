import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

/* ══════════════════════════════════════════════════════════════
   delete-account — Iron Kinetic (GDPR Art. 17 — Right to Erasure)
   ══════════════════════════════════════════════════════════════
   POST /functions/v1/delete-account
   Headers:
     Authorization: Bearer <supabase_access_token>
     apikey: <supabase_anon_key>
     Content-Type: application/json
   Returns:
     200  { success: true }
     401  { error: "..." }
     429  { error: "Too many requests" }
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

/* ── Rate limiting: 2 requests per hour per user ── */
const _rlMap = new Map<string, { count: number; expires: number }>()
function checkRateLimit(userId: string, maxReqs = 2): boolean {
  const now = Date.now()
  const entry = _rlMap.get(userId)
  if (!entry || entry.expires < now) {
    _rlMap.set(userId, { count: 1, expires: now + 3_600_000 }) // 1 hour window
    return true
  }
  entry.count++
  return entry.count <= maxReqs
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }

  /* ── Only accept POST ── */
  if (req.method !== 'POST') {
    return json(req, { error: 'Method not allowed' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const sb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    })

    /* ── 1. Verify user JWT ── */
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return json(req, { error: 'Unauthorized — missing token' }, 401)
    }

    const { data: { user }, error: authError } = await sb.auth.getUser(token)
    if (authError || !user) {
      console.error('[delete-account] JWT verification failed:', authError?.message ?? 'no user')
      return json(req, { error: 'Unauthorized — session invalid or expired' }, 401)
    }

    /* ── 2. Rate limit ── */
    if (!checkRateLimit(user.id, 2)) {
      return json(req, { error: 'Too many requests — try again later' }, 429)
    }

    console.log('[delete-account] Initiating deletion for user:', user.id)

    /* ── 3. Fetch user data (for Stripe cleanup) ── */
    const { data: userData } = await sb
      .from('users')
      .select('stripe_customer_id, stripe_connect_account_id')
      .eq('id', user.id)
      .single()

    /* ── 4. Delete Stripe customer if exists ── */
    if (userData?.stripe_customer_id) {
      try {
        const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
          apiVersion: '2024-06-20',
          httpClient: Stripe.createFetchHttpClient(),
        })
        await stripe.customers.del(userData.stripe_customer_id)
        console.log('[delete-account] Stripe customer deleted:', userData.stripe_customer_id)
      } catch (stripeErr) {
        // Log but don't block — customer may already be deleted or Stripe down
        console.warn('[delete-account] Stripe customer deletion failed (non-blocking):', (stripeErr as Error).message)
      }
    }

    /* ── 5. Delete user row from public.users ── */
    const { error: dbDeleteError } = await sb
      .from('users')
      .delete()
      .eq('id', user.id)

    if (dbDeleteError) {
      console.error('[delete-account] Failed to delete user row:', dbDeleteError.message)
      // Continue — auth user deletion is more important
    } else {
      console.log('[delete-account] User row deleted from public.users')
    }

    /* ── 6. Delete related data (payout_requests, referral_codes, referrals) ── */
    // referral_codes
    await sb.from('referral_codes').delete().eq('user_id', user.id)
    // referrals where user is referrer or referred
    await sb.from('referrals').delete().or(`referrer_id.eq.${user.id},referred_id.eq.${user.id}`)
    // payout_requests
    await sb.from('payout_requests').delete().eq('user_id', user.id)
    // payout_log (keep for accounting but anonymize — actually delete for GDPR)
    await sb.from('payout_log').delete().eq('user_id', user.id)

    /* ── 7. Write audit log BEFORE deleting auth user ── */
    await sb.from('audit_log').insert({
      user_id: user.id,
      action: 'account_deleted',
      metadata: {
        email: user.email ?? null,
        stripe_customer_id: userData?.stripe_customer_id ?? null,
        deleted_at: new Date().toISOString(),
      },
    })

    /* ── 8. Delete auth user (this invalidates all sessions) ── */
    const { error: authDeleteError } = await sb.auth.admin.deleteUser(user.id)
    if (authDeleteError) {
      console.error('[delete-account] Failed to delete auth user:', authDeleteError.message)
      return json(req, { error: 'Failed to delete account — please contact support' }, 500)
    }

    console.log('[delete-account] Account fully deleted:', user.id)
    return json(req, { success: true })

  } catch (err) {
    console.error('[delete-account] Unexpected error:', err)
    return json(req, { error: 'Internal server error' }, 500)
  }
})
