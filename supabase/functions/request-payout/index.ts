import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

/* ══════════════════════════════════════════════════════════════
   request-payout — Iron Kinetic
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

/* ── Rate limiting: 3 requests per user per minute (payouts are expensive) ── */
const _rlMap = new Map<string, { count: number; expires: number }>()
function checkRateLimit(userId: string, maxReqs = 3): boolean {
  const now = Date.now()
  const entry = _rlMap.get(userId)
  if (!entry || entry.expires < now) {
    _rlMap.set(userId, { count: 1, expires: now + 60_000 })
    return true
  }
  entry.count++
  return entry.count <= maxReqs
}

const MIN_PAYOUT_CENTS = 2000 // €20 — modifica solo questa costante per cambiare soglia

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
    if (!checkRateLimit(user.id, 3)) {
      return json(req, { error: 'Too many requests' }, 429)
    }

    const { data: ud } = await sb
      .from('users')
      .select('referral_credit_cents, stripe_connect_account_id, stripe_connect_onboarded')
      .eq('id', user.id)
      .single()

    // ── Validazioni pre-consume ──
    if (!ud?.stripe_connect_onboarded || !ud?.stripe_connect_account_id) {
      return json(req, { error: 'account_not_onboarded' }, 400)
    }
    if ((ud.referral_credit_cents || 0) < MIN_PAYOUT_CENTS) {
      return json(req, { error: 'below_minimum', minimum: MIN_PAYOUT_CENTS }, 400)
    }

    // ── STEP ATOMICO: consuma il credito a DB level ──
    // Se due richieste arrivano in parallelo, una sola otterrà
    // un valore non-null. L'altra riceverà null e verrà bloccata.
    const { data: consumeResult, error: consumeError } = await sb
      .rpc('consume_referral_credit', {
        uid:       user.id,
        min_cents: MIN_PAYOUT_CENTS
      })

    if (consumeError || consumeResult === null) {
      return json(req, { error: 'credit_already_consumed_or_below_minimum' }, 400)
    }

    const amount: number = consumeResult

    // ── Verifica account Stripe attivo (charges_enabled, non payouts_enabled) ──
    const account = await stripe.accounts.retrieve(ud.stripe_connect_account_id)
    if (!account.charges_enabled) {
      // Ripristina il credito: account non pronto
      await sb.rpc('add_referral_credit', { uid: user.id, amount })
      return json(req, { error: 'payouts_disabled' }, 400)
    }

    // ── Transfer Stripe (with idempotency key to prevent double payout) ──
    let transfer: Stripe.Transfer
    try {
      transfer = await stripe.transfers.create(
        {
          amount,
          currency: 'eur',
          destination: ud.stripe_connect_account_id,
          description: `Iron Kinetic referral payout — user ${user.id}`,
          metadata: { user_id: user.id },
        },
        {
          idempotencyKey: `payout_${user.id}_${consumeResult}`,
        }
      )
    } catch (stripeErr) {
      // Transfer fallito: ripristina il credito
      await sb.rpc('add_referral_credit', { uid: user.id, amount })
      console.error('[request-payout] stripe transfer failed, credit restored:', stripeErr)
      return json(req, { error: 'Internal server error' }, 500)
    }

    // ── Registra payout e chiudi ──
    await sb.from('payout_requests').insert({
      user_id:                   user.id,
      amount_cents:              amount,
      status:                    'paid',
      stripe_transfer_id:        transfer.id,
      stripe_connect_account_id: ud.stripe_connect_account_id,
      paid_at:                   new Date().toISOString()
    })

    // ── AREA 8a: Log to payout_log for audit trail ──
    await sb.from('payout_log').insert({
      user_id:            user.id,
      amount_cents:       amount,
      stripe_transfer_id: transfer.id,
    })

    // ── AREA 10a: Audit log ──
    await sb.from('audit_log').insert({
      user_id:  user.id,
      action:   'payout_completed',
      metadata: { amount_cents: amount, transfer_id: transfer.id },
    })

    return json(req, { success: true, amount_cents: amount, transfer_id: transfer.id })

  } catch (err) {
    console.error('[request-payout]', err)
    return json(req, { error: 'Internal server error' }, 500)
  }
})
