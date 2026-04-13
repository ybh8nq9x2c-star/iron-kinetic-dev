import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

const MIN_PAYOUT_CENTS = 2000 // €20 minimum

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      {
        auth: { persistSession: false },
        global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')!
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    })

    const { data: ud } = await supabase
      .from('users')
      .select('referral_credit_cents, stripe_connect_account_id, stripe_connect_onboarded')
      .eq('id', user.id)
      .single()

    // Validations
    if (!ud?.stripe_connect_onboarded || !ud?.stripe_connect_account_id) {
      return json({ error: 'account_not_onboarded' }, 400)
    }
    if ((ud.referral_credit_cents || 0) < MIN_PAYOUT_CENTS) {
      return json({ error: 'below_minimum', minimum: MIN_PAYOUT_CENTS }, 400)
    }

    const amount = ud.referral_credit_cents

    // Verify Stripe Connect account is still active
    const account = await stripe.accounts.retrieve(ud.stripe_connect_account_id)
    if (!account.payouts_enabled) {
      return json({ error: 'payouts_disabled' }, 400)
    }

    // Create transfer to Connect sub-account
    const transfer = await stripe.transfers.create({
      amount,
      currency: 'eur',
      destination: ud.stripe_connect_account_id,
      description: `Iron Kinetic referral payout - user ${user.id}`,
      metadata: { user_id: user.id, supabase_user_id: user.id },
    })

    // Record payout request
    await supabase.from('payout_requests').insert({
      user_id: user.id,
      amount_cents: amount,
      status: 'paid',
      stripe_transfer_id: transfer.id,
      stripe_connect_account_id: ud.stripe_connect_account_id,
      paid_at: new Date().toISOString(),
    })

    // Reset user credit to zero
    await supabase.from('users')
      .update({ referral_credit_cents: 0 })
      .eq('id', user.id)

    console.log(`[request-payout] paid ${amount} cents to ${ud.stripe_connect_account_id}`)
    return json({ success: true, amount_cents: amount, transfer_id: transfer.id })

  } catch (err) {
    console.error('[request-payout]', err)
    return json({ error: (err as Error).message }, 500)
  }
})
