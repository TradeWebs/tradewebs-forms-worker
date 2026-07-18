// Shared form-handling Worker for TradeWebs and every client trade site.
// A single deployment serves everyone: each site posts { client_id, ...fields }
// and CLIENTS below decides where the notification email goes. Onboarding a
// new client site is "add one entry here", not "write new code".

const allowedOrigins = [
  "https://tradewebs.co.uk",
  "https://www.tradewebs.co.uk",
  "https://tradewebs.pages.dev",
];

const CLIENTS = {
  tradewebs: {
    to: "jamesbowlesmail@gmail.com",
    siteName: "TradeWebs",
    allowedOrigins,
  },
  "tradewebs-onboarding": {
    to: "jamesbowlesmail@gmail.com",
    siteName: "TradeWebs — New Client Onboarding",
    allowedOrigins,
  },
  southwestflatroofing: {
    to: "info@somersetflatroofingsw.com",
    siteName: "South West Flat Roofing",
    allowedOrigins: [
      "https://southwestflatroofing.uk",
      "https://www.southwestflatroofing.uk",
      "https://southwestflatroofing.pages.dev",
    ],
  },
};

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function isAllowedOrigin(client, origin) {
  if (!origin) return false;
  if (client.allowedOrigins.includes(origin)) return true;
  // allow any *.pages.dev preview deploy for this project during development
  return /^https:\/\/[a-z0-9-]+\.tradewebs\.pages\.dev$/.test(origin);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function sendNotification(env, client, fields) {
  const entries = Object.entries(fields).filter(
    ([key]) => key !== "bot-field" && key !== "client_id"
  );

  const rows = entries
    .map(([key, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:13px;text-transform:capitalize;">${escapeHtml(key)}</td><td style="padding:4px 0;font-size:14px;">${escapeHtml(value)}</td></tr>`)
    .join("");

  const text = entries
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");

  const subjectParts = [fields.name || "New enquiry"];
  if (fields.trade) subjectParts.push(fields.trade);
  subjectParts.push(client.siteName);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: client.to,
      reply_to: fields.email ? [fields.email] : undefined,
      subject: subjectParts.join(" — "),
      html: `<table>${rows}</table>`,
      text,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend API error (${res.status}): ${text}`);
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    let body;
    const contentType = request.headers.get("Content-Type") || "";
    try {
      if (contentType.includes("application/json")) {
        body = await request.json();
      } else {
        const form = await request.formData();
        body = Object.fromEntries(form.entries());
      }
    } catch {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    // Honeypot — silently pretend success so bots don't learn anything.
    if (body["bot-field"]) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    const clientId = body.client_id;
    const client = clientId && CLIENTS[clientId];
    if (!client) {
      return new Response(JSON.stringify({ error: "Unknown client_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    if (!isAllowedOrigin(client, origin)) {
      return new Response(JSON.stringify({ error: "Origin not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    try {
      await sendNotification(env, client, body);
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  },
};
