import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
})

serve(async (req) => {
  // ── CORS preflight ──
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Auth: extract JWT from Authorization header ──
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 1. Auth client — anon key + user JWT to verify identity
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: authHeader } },
      }
    )

    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Parse request body for price selection ──
    const { price_tier } = await req.json() // 'monthly' | 'annual' | 'lifetime'

    // Map tier to Stripe price ID from env
    const priceMap: Record<string, string | undefined> = {
      monthly: Deno.env.get('STRIPE_PRICE_MONTHLY'),
      annual: Deno.env.get('STRIPE_PRICE_ANNUAL'),
      lifetime: Deno.env.get('STRIPE_PRICE_LIFETIME'),
    }

    const priceId = priceMap[price_tier]
    if (!priceId) {
      return new Response(
        JSON.stringify({ error: `Invalid price_tier: ${price_tier}. Use monthly, annual, or lifetime.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const isSubscription = price_tier === 'monthly' || price_tier === 'annual'
    const appUrl = Deno.env.get('APP_URL')!

    // ── Create Stripe Checkout Session ──
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      mode: isSubscription ? 'subscription' : 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${appUrl}?trend=success`,
      cancel_url: `${appUrl}?trend=cancel`,
      // Top-level metadata — visible in checkout.session.completed event
      metadata: {
        supabase_uid: user.id,
      },
    }

    // For subscriptions, pass metadata on the subscription object too
    if (isSubscription) {
      sessionConfig.subscription_data = {
        metadata: {
          supabase_uid: user.id,
        },
      }
    }

    const session = await stripe.checkout.sessions.create(sessionConfig)

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Checkout session error:', err)
    return new Response(
      JSON.stringify({ error: err.message ?? 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
