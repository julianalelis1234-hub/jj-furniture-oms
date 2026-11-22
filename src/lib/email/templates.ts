/**
 * Branded transactional emails (HTML + plain text). Inline styles and tables
 * only, because email clients ignore stylesheets. Palette: Espresso #2B1D17,
 * Mocha #6B4A3A, Caramel #C48A5A, Latte #E7D6C1, Cream #FAF6F0. Every dynamic
 * value is HTML-escaped. Links are passed in at send time and never stored.
 */
export const OUTBOX_KINDS = ["quote_review_ready", "order_confirmed_new_customer", "order_confirmed_returning_customer", "account_setup_link"] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

export interface TemplateData {
  customer_name?: string;
  order_code?: string;
  item_summary?: string;
  total?: string;
  down_payment?: string;
  quote_expires?: string | null;
  link_expires?: string | null;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const C = { espresso: "#2B1D17", mocha: "#6B4A3A", caramel: "#C48A5A", latte: "#E7D6C1", cream: "#FAF6F0" };
const SANS = "'Nunito Sans',Segoe UI,Helvetica,Arial,sans-serif";
const SERIF = "'EB Garamond',Georgia,'Times New Roman',serif";

function row(label: string, value: string | undefined | null) {
  if (!value) return "";
  return `<tr><td style="padding:6px 0;color:${C.mocha};font:14px ${SANS};">${esc(label)}</td><td style="padding:6px 0;text-align:right;color:${C.espresso};font:bold 14px ${SANS};">${esc(value)}</td></tr>`;
}

function layout(p: { preheader: string; heading: string; intro: string; rows: string; cta: string; href: string; after: string }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(p.heading)}</title></head>
<body style="margin:0;padding:0;background:${C.cream};">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${esc(p.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${C.latte};border-radius:16px;overflow:hidden;">
<tr><td style="background:${C.espresso};padding:20px 28px;">
  <span style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;border-radius:10px;background:${C.caramel};color:${C.espresso};font:800 15px ${SANS};">JJ</span>
  <span style="margin-left:10px;color:${C.cream};font:800 18px ${SANS};vertical-align:middle;">JJ Furniture</span>
  <div style="margin-top:4px;color:${C.latte};font:12px ${SANS};letter-spacing:.06em;">Shop and Enterprises · Valencia City, Bukidnon</div>
</td></tr>
<tr><td style="height:3px;background:${C.caramel};line-height:3px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px;">
  <h1 style="margin:0 0 12px;color:${C.espresso};font:600 26px/1.2 ${SERIF};">${esc(p.heading)}</h1>
  <p style="margin:0 0 18px;color:${C.espresso};font:15px/1.6 ${SANS};">${p.intro}</p>
  ${p.rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};border:1px solid ${C.latte};border-radius:12px;padding:8px 16px;margin:0 0 22px;">${p.rows}</table>` : ""}
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="border-radius:999px;background:${C.mocha};">
    <a href="${esc(p.href)}" style="display:inline-block;padding:14px 26px;color:${C.cream};font:bold 15px ${SANS};text-decoration:none;border-radius:999px;">${esc(p.cta)}</a>
  </td></tr></table>
  <p style="margin:0;color:${C.mocha};font:13px/1.6 ${SANS};">${p.after}</p>
</td></tr>
<tr><td style="padding:16px 28px;background:${C.cream};border-top:1px solid ${C.latte};color:${C.mocha};font:12px/1.5 ${SANS};">
  JJ Furniture Shop and Enterprises · Poblacion, Valencia City, Bukidnon.<br>If you did not order from JJ Furniture, you can ignore this email.
</td></tr></table></td></tr></table></body></html>`;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** `href` is the secure link (review / set-up) or the login page; it is only ever in memory. */
export function renderEmail(kind: OutboxKind, d: TemplateData, href: string): RenderedEmail {
  const name = d.customer_name || "there";
  switch (kind) {
    case "quote_review_ready": {
      const subject = `Your JJ Furniture quotation for ${d.order_code} is ready`;
      const rows = row("Order ID", d.order_code) + row("Item", d.item_summary) + row("Total", d.total) + row("Quotation valid until", d.quote_expires);
      const html = layout({
        preheader: `Review and accept your quotation for ${d.order_code}.`,
        heading: "Your quotation is ready",
        intro: `Hello ${esc(name)}, please review the exact specification and price below, then accept it if everything is right.`,
        rows, cta: "Review & Accept Quotation", href,
        after: `This secure link works once${d.link_expires ? ` and expires on ${esc(d.link_expires)}` : ""}. Nothing is ordered or charged until you accept.`,
      });
      const text = `Hello ${name},\n\nYour JJ Furniture quotation is ready.\nOrder ID: ${d.order_code}\nItem: ${d.item_summary}\nTotal: ${d.total}\n` +
        `${d.quote_expires ? `Quotation valid until: ${d.quote_expires}\n` : ""}\nReview & accept (single-use link${d.link_expires ? `, expires ${d.link_expires}` : ""}):\n${href}\n\n` +
        "Nothing is ordered or charged until you accept. If you did not order from JJ Furniture, ignore this email.";
      return { subject, html, text };
    }
    case "order_confirmed_new_customer": {
      const subject = `Order ${d.order_code} confirmed — set your JJ Furniture password`;
      const rows = row("Order ID", d.order_code) + row("Confirmed item", d.item_summary) + row("Total", d.total) + row("30% down payment", d.down_payment);
      const html = layout({
        preheader: `Order ${d.order_code} is confirmed. Create your password to follow it.`,
        heading: "Your order is confirmed",
        intro: `Thank you, ${esc(name)}! Production starts once your <b>30% down payment</b>${d.down_payment ? ` of <b>${esc(d.down_payment)}</b>` : ""} is verified by the shop. Create your password to follow every step of your order.`,
        rows, cta: "Set Your Password & Track Order", href,
        after: "This link works once and expires soon. If it has expired, use “Forgot Password?” on the login page to get a new one. JJ Furniture will never email you a password.",
      });
      const text = `Thank you, ${name}!\n\nOrder ${d.order_code} is confirmed: ${d.item_summary}.\nTotal: ${d.total}\n30% down payment: ${d.down_payment}\n` +
        `Production starts once your 30% down payment is verified.\n\nSet your password & track your order (single-use link):\n${href}\n\n` +
        "If the link expired, use “Forgot Password?” on the login page. JJ Furniture will never email you a password.";
      return { subject, html, text };
    }
    case "order_confirmed_returning_customer": {
      const subject = `Order ${d.order_code} is confirmed`;
      const rows = row("Order ID", d.order_code) + row("Confirmed item", d.item_summary) + row("Total", d.total) + row("30% down payment", d.down_payment);
      const html = layout({
        preheader: `Order ${d.order_code} was added to your JJ Furniture account.`,
        heading: "Your order is confirmed",
        intro: `Thank you, ${esc(name)}! This order was added to your existing JJ Furniture account. Production starts once your 30% down payment is verified.`,
        rows, cta: "Log In to Track Your Order", href,
        after: "Log in with your usual email and password. Your password was not changed.",
      });
      const text = `Thank you, ${name}!\n\nOrder ${d.order_code} is confirmed and was added to your account: ${d.item_summary}.\nTotal: ${d.total}\n` +
        `30% down payment: ${d.down_payment}\n\nLog in to track your order: ${href}\nYour password was not changed.`;
      return { subject, html, text };
    }
    case "account_setup_link": {
      const subject = "Your JJ Furniture password set-up link";
      const html = layout({
        preheader: "Use this secure link to set a new password.",
        heading: "Set your password",
        intro: `Hello ${esc(name)}, use the button below to choose a new password for your JJ Furniture account.`,
        rows: "", cta: "Set Your Password", href,
        after: "This link works once and expires soon. If you did not ask for it, ignore this email — your password stays the same.",
      });
      const text = `Hello ${name},\n\nSet a new password for your JJ Furniture account (single-use link):\n${href}\n\nIf you did not ask for this, ignore this email; your password stays the same.`;
      return { subject, html, text };
    }
  }
}
