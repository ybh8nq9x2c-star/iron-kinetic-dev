import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
})

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://irokninetic-production.up.railway.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No auth')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) throw new Error('Unauthorized')

    const { price_tier } = await req.json()
    const priceMap: Record<string, string> = {
      monthly: Deno.env.get('STRIPE_PRICE_MONTHLY') || 'price_1TJy0qJYTPcSrsvtmBIyqDmu',
      annual:  Deno.env.get('STRIPE_PRICE_ANNUAL') || 'price_1TJy0qJYTPcSrsvtqITsBfl0',
      lifetime: Deno.env.get('STRIPE_PRICE_LIFETIME') || 'price_1TJy0rJYTPcSrsvttxySfxQk',
    }
    const priceId = priceMap[price_tier] || priceMap.monthly
    const origin = req.headers.get('origin') || Deno.env.get('APP_URL') || 'https://irokninetic-production.up.railway.app'

    const session = await stripe.checkout.sessions.create({
      mode: price_tier === 'lifetime' ? 'payment' : 'subscription',
      client_reference_id: user.id,
      payment_method_types: ['card'],
      customer_email: user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/?trend=success`,
      cancel_url: origin,
      metadata: { userId: user.id, supabase_uid: user.id },
      subscription_data: price_tier !== 'lifetime' ? {
        metadata: { supabase_uid: user.id },
      } : undefined,
    })

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
