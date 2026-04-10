/**
 * Cloudflare Pages Function — SMS Notify Kody on new guest
 *
 * POST /api/sms-notify
 *   Body: { firstName, lastName?, phone?, connector?, source? }
 *
 * Sends a text to Kody (NOTIFY_SMS_TO) when someone new signs in via the
 * kiosk or pre-signs in on the invite page. Uses Twilio.
 *
 * Required env vars (set in Cloudflare Pages → Settings → Environment variables):
 *   - TWILIO_ACCOUNT_SID
 *   - TWILIO_AUTH_TOKEN
 *   - TWILIO_FROM_NUMBER   (a Twilio number in E.164, e.g. "+18135551234")
 *   - NOTIFY_SMS_TO        (defaults to "+18636084406" — Kody's cell)
 *
 * If env vars aren't set, this function still returns 200 OK so the caller
 * isn't broken — it just logs a warning.
 */

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
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

  const firstName = (payload.firstName || '').trim();
  const lastName = (payload.lastName || '').trim();
  const phone = (payload.phone || '').trim();
  const connector = (payload.connector || '').trim();
  const source = (payload.source || 'kiosk').trim();

  if (!firstName) {
    return new Response(JSON.stringify({ error: 'firstName is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const fromNumber = env.TWILIO_FROM_NUMBER;
  const toNumber = env.NOTIFY_SMS_TO || '+18636084406';

  if (!accountSid || !authToken || !fromNumber) {
    console.warn('Twilio env vars not configured — skipping SMS notification.');
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  const fullName = `${firstName}${lastName ? ' ' + lastName : ''}`.trim();
  const sourceLabel = source === 'invite' ? 'pre sign-in' : 'kiosk check-in';
  const lines = [
    `🆕 New guest from ${sourceLabel}:`,
    fullName,
  ];
  if (phone) lines.push(phone);
  if (connector) lines.push(`Invited by: ${connector}`);
  lines.push('— stpetebiblestudy.com');
  const body = lines.join('\n');

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const params = new URLSearchParams();
  params.set('To', toNumber);
  params.set('From', fromNumber);
  params.set('Body', body);

  try {
    const basic = btoa(`${accountSid}:${authToken}`);
    const res = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const ok = res.ok;
    if (!ok) {
      const errText = await res.text();
      console.error('Twilio error:', res.status, errText);
      return new Response(JSON.stringify({ ok: false, error: 'twilio_failed' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  } catch (err) {
    console.error('Twilio fetch error:', err);
    return new Response(JSON.stringify({ ok: false, error: 'fetch_failed' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
}
