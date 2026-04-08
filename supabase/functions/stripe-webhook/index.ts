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

/* ════════════════════════════════════════════════════════════
   Helper: idempotency guard
   Inserts event into processed_events. If duplicate (23505),
   returns a Response to skip. Otherwise continues.
   ════════════════════════════════════════════════════════════ */
async function checkIdempotency(
  event: Stripe.Event,
  customerId: string | null
): Promise<Response | null> {
  const { error: dupError } = await sb
    .from('processed_events')
    .insert({
      event_id: event.id,
      event_type: event.type,
      customer_id: customerId ?? null,
    })

  if (dupError?.code === '23505') {
    // Already processed — skip silently
    console.log(`Skipping duplicate event: ${event.id} (${event.type})`)
    return new Response(JSON.stringify({ received: true, skipped: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  }
  if (dupError) throw dupError
  return null // continue processing
}

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

  console.log('Stripe event:', event.type, event.id)

  try {
    // ── 1. checkout.session.completed ──────────────────────
    // First payment or one-time purchase
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const email = session.customer_details?.email
      const customerId = session.customer as string
      const plan = session.mode === 'subscription' ? 'monthly' : 'lifetime'

      // Idempotency check
      const skip = await checkIdempotency(event, customerId)
      if (skip) return skip

      if (email) {
        const { error } = await sb
          .from('users')
          .update({
            trend_active: true,
            plan,
            stripe_customer_id: customerId,
          })
          .eq('email', email)
        if (error) console.error('Supabase update error (checkout):', error)
        else console.log(`Activated Trend for ${email} — plan: ${plan}`)
      }
    }

    // ── 2. invoice.payment_succeeded ───────────────────────
    // Subscription renewal — update period bounds + clear grace
    // Plan detected from price_id (supports monthly/annual/lifetime)
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string
      const subscriptionId = invoice.subscription as string | null

      // Idempotency check
      const skip = await checkIdempotency(event, customerId)
      if (skip) return skip

      if (customerId) {
        // Detect plan from invoice line item price_id
        const lineItem = invoice.lines?.data?.[0]
        const priceId = lineItem?.price?.id

        const PRICE_MONTHLY  = Deno.env.get('STRIPE_PRICE_MONTHLY')
        const PRICE_ANNUAL   = Deno.env.get('STRIPE_PRICE_ANNUAL')
        const PRICE_LIFETIME = Deno.env.get('STRIPE_PRICE_LIFETIME')

        const plan = priceId === PRICE_LIFETIME ? 'lifetime'
                   : priceId === PRICE_ANNUAL   ? 'annual'
                   : priceId === PRICE_MONTHLY  ? 'monthly'
                   : null  // unknown price — don't overwrite

        const updatePayload: Record<string, unknown> = {
          trend_active: true,
          cancel_at_period_end: false,
          grace_period_until: null,
        }

        // Only update plan if we recognised the price
        if (plan) updatePayload.plan = plan

        // Convert unix timestamps to ISO strings for Supabase
        if (invoice.period_start) {
          updatePayload.current_period_start = new Date(invoice.period_start * 1000).toISOString()
        }
        if (invoice.period_end) {
          updatePayload.current_period_end = new Date(invoice.period_end * 1000).toISOString()
        }

        // Store subscription ID if available
        if (subscriptionId) {
          updatePayload.stripe_subscription_id = subscriptionId
        }

        const { error } = await sb
          .from('users')
          .update(updatePayload)
          .eq('stripe_customer_id', customerId)
        if (error) console.error('Supabase update error (renewal):', error)
        else console.log(`Renewed subscription for customer ${customerId} — plan: ${plan ?? 'unchanged'}`)
      }
    }

    // ── 3. customer.subscription.deleted ───────────────────
    // Subscription fully cancelled — start 48h grace period
    // trend_active stays TRUE during grace, frontend checks expiry
    // plan is NOT changed here — becomes 'free' only when frontend
    // detects grace_period_until has expired
    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string

      // Idempotency check
      const skip = await checkIdempotency(event, customerId)
      if (skip) return skip

      if (customerId) {
        const graceEnd = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
        const { error } = await sb
          .from('users')
          .update({
            trend_active: true, // keep active during grace period
            cancel_at_period_end: true,
            grace_period_until: graceEnd,
            current_period_end: new Date(subscription.ended_at * 1000).toISOString(),
          })
          .eq('stripe_customer_id', customerId)
        if (error) console.error('Supabase update error (sub deleted):', error)
        else console.log(`Grace period started for customer ${customerId} until ${graceEnd}`)
      }
    }

    // ── 4. invoice.payment_failed ──────────────────────────
    // Payment failed — start 48h grace period, do NOT revoke yet
    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string

      // Idempotency check
      const skip = await checkIdempotency(event, customerId)
      if (skip) return skip

      if (customerId) {
        // Check if grace period already set — don't overwrite if already in grace
        const { data: existing } = await sb
          .from('users')
          .select('grace_period_until')
          .eq('stripe_customer_id', customerId)
          .single()

        if (!existing?.grace_period_until) {
          const graceEnd = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
          const { error } = await sb
            .from('users')
            .update({
              trend_active: true, // keep active during grace period
              grace_period_until: graceEnd,
            })
            .eq('stripe_customer_id', customerId)
          if (error) console.error('Supabase update error (payment failed):', error)
          else console.log(`Payment failed — grace period for ${customerId} until ${graceEnd}`)
        } else {
          console.log(`Payment failed — grace already active for ${customerId}`)
        }
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
