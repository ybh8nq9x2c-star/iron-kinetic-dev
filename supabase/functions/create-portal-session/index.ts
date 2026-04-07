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

    const { data: { user }, error: userErr } = await sb.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (userErr || !user) return new Response('Unauthorized', { status: 401, headers: CORS })

    const { data: row } = await sb
      .from('users')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single()

    if (!row?.stripe_customer_id) {
      return new Response(
        JSON.stringify({ error: 'No subscription found. Please subscribe first.' }),
        { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 404 }
      )
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: APP_URL,
    })

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (err) {
    console.error('create-portal-session error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
