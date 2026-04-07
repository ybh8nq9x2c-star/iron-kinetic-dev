import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
})

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const PRICE_IDS: Record<string, string> = {
  monthly:  Deno.env.get('STRIPE_PRICE_MONTHLY')!,
  annual:   Deno.env.get('STRIPE_PRICE_ANNUAL')!,
  lifetime: Deno.env.get('STRIPE_PRICE_LIFETIME')!,
}

const APP_URL = Deno.env.get('APP_URL') || 'https://irokninetic-production.up.railway.app'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader) return new Response('Unauthorized', { status: 401, headers: CORS })

    // Verify Supabase JWT and get user
    const { data: { user }, error: userErr } = await sb.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (userErr || !user) return new Response('Unauthorized', { status: 401, headers: CORS })

    const { plan } = await req.json()
    if (!plan || !PRICE_IDS[plan]) {
      return new Response(
        JSON.stringify({ error: 'Invalid plan. Must be monthly, annual, or lifetime.' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    // Get or create Stripe customer
    const { data: row } = await sb
      .from('users')
      .select('stripe_customer_id, email')
      .eq('id', user.id)
      .single()

    let customerId = row?.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? row?.email ?? undefined,
        metadata: { supabase_uid: user.id },
      })
      customerId = customer.id
      await sb.from('users').update({ stripe_customer_id: customerId }).eq('id', user.id)
    }

    const isSubscription = plan !== 'lifetime'

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      mode: isSubscription ? 'subscription' : 'payment',
      success_url: APP_URL + '?trend=verifying',
      cancel_url: APP_URL,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      ...(isSubscription && {
        subscription_data: {
          metadata: { supabase_uid: user.id, plan },
        },
      }),
      metadata: { supabase_uid: user.id, plan },
    })

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (err) {
    console.error('create-checkout-session error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
