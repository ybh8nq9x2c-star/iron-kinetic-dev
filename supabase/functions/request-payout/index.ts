import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MIN_PAYOUT_CENTS = 2000 // €20 — modifica solo questa costante per cambiare soglia

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-06-20'
    })

    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    const { data: { user }, error: authError } = await sb.auth.getUser(token)
    if (authError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    const { data: ud } = await sb
      .from('users')
      .select('referral_credit_cents, stripe_connect_account_id, stripe_connect_onboarded')
      .eq('id', user.id)
      .single()

    // ── Validazioni pre-consume ──
    if (!ud?.stripe_connect_onboarded || !ud?.stripe_connect_account_id) {
      return new Response(
        JSON.stringify({ error: 'account_not_onboarded' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if ((ud.referral_credit_cents || 0) < MIN_PAYOUT_CENTS) {
      return new Response(
        JSON.stringify({ error: 'below_minimum', minimum: MIN_PAYOUT_CENTS }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
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
      return new Response(
        JSON.stringify({ error: 'credit_already_consumed_or_below_minimum' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const amount: number = consumeResult

    // ── Verifica account Stripe attivo ──
    const account = await stripe.accounts.retrieve(ud.stripe_connect_account_id)
    if (!account.payouts_enabled) {
      // Ripristina il credito: account non pronto
      await sb.rpc('add_referral_credit', { uid: user.id, amount })
      return new Response(
        JSON.stringify({ error: 'payouts_disabled' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Transfer Stripe (with idempotency key to prevent double payout) ──
    let transfer: Stripe.Transfer
    try {
      transfer = await stripe.transfers.create(
        {
          amount,
          currency: 'eur',
          destination: ud.stripe_connect_account_id,
          description: `Iron Kinetic™ referral payout — user ${user.id}`,
          metadata: { user_id: user.id },
        },
        {
          idempotencyKey: `payout_${user.id}_${Date.now()}`,
        }
      )
    } catch (stripeErr) {
      // Transfer fallito: ripristina il credito
      await sb.rpc('add_referral_credit', { uid: user.id, amount })
      console.error('[request-payout] stripe transfer failed, credit restored:', stripeErr)
      throw stripeErr
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

    return new Response(
      JSON.stringify({ success: true, amount_cents: amount, transfer_id: transfer.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('[request-payout]', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
