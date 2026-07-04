// POST /subscribe — Double opt-in signup for The Veil.
// Replaces the old Make webhook. Calls Brevo's DOI endpoint so a
// confirmation email is sent and the contact only joins the list
// (id 4) AFTER they click the link — protecting against bots and typos.
//
// Requires a Cloudflare Pages environment variable / secret:
//   BREVO_API_KEY  (the xkeysib-... key; never commit it to git)

const LIST_ID = 4;                 // The Veil Subscribers
const DOI_TEMPLATE_ID = 119;       // "The Veil — Confirm subscription (DOI)"
const REDIRECT_URL = 'https://theveil.media/confirmed';

// Zero-downtime fallback: until BREVO_API_KEY is set as a Pages secret,
// forward signups to the existing Make webhook (single opt-in, the old
// behavior). Double opt-in activates automatically once the key exists.
const MAKE_FALLBACK = 'https://hook.us2.make.com/krlnf1d61bokrrwcfymviv92dte1ralt';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { 'allow': 'POST' } });
  }

  // Accept either form-encoded or JSON.
  let data = {};
  try {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      data = await request.json();
    } else {
      const form = await request.formData();
      form.forEach((v, k) => { data[k] = v; });
    }
  } catch (e) {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  // Honeypot: real users never fill this hidden field. Silently succeed
  // so bots get no signal, but do nothing.
  if ((data.company || data.website || data.hp || '').toString().trim() !== '') {
    return json({ ok: true, pending: true });
  }

  const email = (data.email || '').toString().trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return json({ ok: false, error: 'invalid_email' }, 422);
  }

  const region = (data.region || '').toString().trim().slice(0, 16);
  const tz = (data.tz || '').toString().trim().slice(0, 64);

  // No Brevo key yet → forward to Make (old single-opt-in path), no downtime.
  if (!env.BREVO_API_KEY) {
    try {
      const body = new URLSearchParams({ email, region, tz, utm_source: 'website', utm_medium: 'landing', utm_campaign: 'home' });
      await fetch(MAKE_FALLBACK, { method: 'POST', body });
      return json({ ok: true, pending: false, fallback: true });
    } catch (e) {
      return json({ ok: false, error: 'upstream_unreachable' }, 502);
    }
  }

  const attributes = {};
  if (region) attributes.REGION = region;
  if (tz) attributes.CONTACT_TIMEZONE = tz;

  const payload = {
    email,
    includeListIds: [LIST_ID],
    templateId: DOI_TEMPLATE_ID,
    redirectionUrl: REDIRECT_URL,
    attributes,
  };

  let resp;
  try {
    resp = await fetch('https://api.brevo.com/v3/contacts/doubleOptinConfirmation', {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json({ ok: false, error: 'upstream_unreachable' }, 502);
  }

  // Brevo returns 201/204 with no body on success.
  if (resp.status === 201 || resp.status === 204 || resp.ok) {
    return json({ ok: true, pending: true });
  }

  // Read the error to handle "already confirmed" gracefully.
  let detail = {};
  try { detail = await resp.json(); } catch (e) { /* no body */ }
  const code = (detail && detail.code) || '';

  // Already a confirmed contact on the list — treat as success, no re-send needed.
  if (code === 'duplicate_parameter' || resp.status === 400) {
    return json({ ok: true, already: true });
  }

  return json({ ok: false, error: code || 'brevo_error', status: resp.status }, 502);
}
