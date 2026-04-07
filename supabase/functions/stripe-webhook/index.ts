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

serve(async (req) => {
  const sig = req.headers.get('stripe-signature')
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig!,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    )
  } catch (err) {
    console.error('Webhook signature error:', err.message)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  console.log('Stripe event:', event.type)

  try {
    // ── Payment completed (subscription or one-time) ──
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const email = session.customer_details?.email
      const customerId = session.customer as string
      const plan = session.mode === 'subscription' ? 'monthly' : 'lifetime'

      if (email) {
        const { error } = await sb
          .from('users')
          .update({ trend_active: true, plan, stripe_customer_id: customerId })
          .eq('email', email)
        if (error) console.error('Supabase update error (checkout):', error)
        else console.log(`Activated Trend for ${email} — plan: ${plan}`)
      }
    }

    // ── Subscription renewed successfully ──
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string
      if (customerId) {
        const { error } = await sb
          .from('users')
          .update({ trend_active: true, plan: 'monthly' })
          .eq('stripe_customer_id', customerId)
        if (error) console.error('Supabase update error (renewal):', error)
      }
    }

    // ── Subscription cancelled or payment failed ──
    if (
      event.type === 'customer.subscription.deleted' ||
      event.type === 'invoice.payment_failed'
    ) {
      const obj = event.data.object as Stripe.Subscription | Stripe.Invoice
      const customerId = obj.customer as string
      if (customerId) {
        const { error } = await sb
          .from('users')
          .update({ trend_active: false, plan: 'free' })
          .eq('stripe_customer_id', customerId)
        if (error) console.error('Supabase update error (cancel):', error)
        else console.log(`Deactivated Trend for customer ${customerId}`)
      }
    }
  } catch (err) {
    console.error('Handler error:', err)
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
})
