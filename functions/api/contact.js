/**
 * Cloudflare Pages Function — Contact Form Handler
 *
 * Accepts POST submissions from the contact form on index.html.
 *  1. Writes the message to the Supabase `messages` table.
 *  2. Sends an email notification to NOTIFY_EMAIL via Resend.
 *
 * Required env vars (set in Cloudflare Pages → Settings → Environment variables):
 *   - RESEND_API_KEY  (get one free at https://resend.com — 100 emails/day, 3k/mo)
 *   - NOTIFY_EMAIL    (defaults to kcountryman@gfcflorida.com)
 *   - FROM_EMAIL      (optional — defaults to "onboarding@resend.dev" which works
 *                      without domain verification. Upgrade to a verified domain
 *                      like "hello@stpetebiblestudy.com" once your Resend domain
 *                      is set up.)
 *
 * Supabase credentials are public anon keys (already exposed on index.html),
 * so we just mirror them here for robustness.
 */

const SUPABASE_URL = 'https://itgyatshpvwxqmfhxgra.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0Z3lhdHNocHZ3eHFtZmh4Z3JhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NTU0MzMsImV4cCI6MjA5MTMzMTQzM30.tt3KNvdaccTVflvYSuHK2Fvq-ObAbYrFhF9LGV5RpUk';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  const name = (payload.name || '').trim();
  const phone = (payload.phone || '').trim();
  const email = (payload.email || '').trim();
  const message = (payload.message || '').trim();

  // Very light server-side validation / honeypot
  if (!name || !message) {
    return new Response(JSON.stringify({ error: 'Name and message are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
  // Honeypot: reject if a hidden "website" field is filled in
  if (payload.website) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  // 1. Save to Supabase (non-blocking error tolerance)
  let supabaseOk = false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, phone, email, message }),
    });
    supabaseOk = res.ok;
    if (!res.ok) {
      console.error('Supabase insert failed:', await res.text());
    }
  } catch (err) {
    console.error('Supabase fetch error:', err);
  }

  // 2. Send email via Resend
  const notifyEmail = env.NOTIFY_EMAIL || 'kcountryman@gfcflorida.com';
  const fromEmail = env.FROM_EMAIL || 'St. Pete Bible Study <onboarding@resend.dev>';
  let emailOk = false;

  if (env.RESEND_API_KEY) {
    try {
      const html = `
        <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
          <div style="background: linear-gradient(135deg, #2AABB3, #145A5E); color: white; border-radius: 16px 16px 0 0; padding: 24px;">
            <div style="font-size: 12px; opacity: 0.9; text-transform: uppercase; letter-spacing: 1px;">St. Pete Bible Study</div>
            <h1 style="margin: 6px 0 0; font-size: 22px;">New Contact Form Message</h1>
          </div>
          <div style="background: white; border: 1px solid #eee; border-top: none; border-radius: 0 0 16px 16px; padding: 24px;">
            <p style="margin: 0 0 16px; color: #636E72; font-size: 14px;">Someone just reached out through the website:</p>
            <table style="width: 100%; font-size: 15px; color: #2D3436;">
              <tr><td style="padding: 6px 0; width: 90px; color: #8E99A4;">Name:</td><td style="padding: 6px 0; font-weight: 600;">${escapeHtml(name)}</td></tr>
              ${phone ? `<tr><td style="padding: 6px 0; color: #8E99A4;">Phone:</td><td style="padding: 6px 0;"><a href="tel:${escapeHtml(phone)}" style="color:#1B7A80;">${escapeHtml(phone)}</a> · <a href="sms:${escapeHtml(phone.replace(/[^\d+]/g,''))}" style="color:#1B7A80;">Text</a></td></tr>` : ''}
              ${email ? `<tr><td style="padding: 6px 0; color: #8E99A4;">Email:</td><td style="padding: 6px 0;"><a href="mailto:${escapeHtml(email)}" style="color:#1B7A80;">${escapeHtml(email)}</a></td></tr>` : ''}
            </table>
            <div style="margin-top: 20px; padding: 16px; background: #FDF6EE; border-left: 4px solid #2AABB3; border-radius: 6px; white-space: pre-wrap; font-size: 15px; line-height: 1.55;">${escapeHtml(message)}</div>
            <p style="margin-top: 24px; font-size: 12px; color: #8E99A4;">Sent from the contact form at stpetebiblestudy.com</p>
          </div>
        </div>
      `;
      const text =
        `New contact form message\n\n` +
        `Name: ${name}\n` +
        (phone ? `Phone: ${phone}\n` : '') +
        (email ? `Email: ${email}\n` : '') +
        `\nMessage:\n${message}\n`;

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [notifyEmail],
          subject: `New message from ${name} — St. Pete Bible Study`,
          html,
          text,
          reply_to: email || undefined,
        }),
      });
      emailOk = resendRes.ok;
      if (!resendRes.ok) {
        console.error('Resend error:', await resendRes.text());
      }
    } catch (err) {
      console.error('Resend fetch error:', err);
    }
  } else {
    console.warn('RESEND_API_KEY not set — skipping email notification. Set it in Cloudflare Pages env vars to enable.');
  }

  return new Response(
    JSON.stringify({ ok: supabaseOk || emailOk, supabase: supabaseOk, email: emailOk }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    }
  );
}
