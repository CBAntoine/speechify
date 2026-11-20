// Static microsite builder. No dependencies: Node 20+ only.
//
// Each site lives in sites/<slug>/ as a site.json plus HTML fragments in pages/.
// The build wraps every fragment in the shared layout, inlines the stylesheet,
// and writes a folder that any static host can serve (Cloudflare Pages, Netlify).
//
// Two modes, picked by site.json:
//   guide mode  partner is null. No phone number anywhere. Safe to publish while
//               the domain ages and you look for a plumbing company.
//   call mode   partner is set. Call buttons, the tracking number, and the
//               partner's license statement on every page.
//
// Texas only lets you advertise plumbing once a Responsible Master Plumber is
// secured (Occupations Code §1301.351(a-2)), which is why the phone number never
// appears without a partner.

import { readFile, writeFile, mkdir, rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(LIB_DIR, '..');
export const DEFAULT_SITES_DIR = path.join(ROOT_DIR, 'sites');
export const DEFAULT_OUT_DIR = path.join(ROOT_DIR, 'dist');

export class BuildError extends Error {
  constructor(site, problems) {
    super(`${site}: not built\n  - ${problems.join('\n  - ')}`);
    this.site = site;
    this.problems = problems;
  }
}

// Preview builds fill gaps with these so a page can be reviewed before the real
// details exist. 555-0100 to 555-0199 is reserved for fiction, so the sample
// number can't ring a real person. Production builds refuse every one of them.
export const SAMPLE = Object.freeze({
  phone: '+17135550142',
  operator: { name: 'Your Name or LLC', email: 'you@example.com' },
  partner: {
    company: 'Sample Plumbing Co.',
    license: { holder: 'Pat Sample', number: 'M-00000', label: 'Responsible Master Plumber' },
  },
});

const PLACEHOLDER = /\b(sample|todo|tbd|lorem)\b|example\.(com|org|net)\b/i;
const LIVE_TOKENS = new Set(['phone', 'phoneE164', 'partnerCompany', 'licenseHolder', 'licenseNumber', 'licenseLabel']);

const PHONE_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>';
const DROP_ICON =
  '<svg aria-hidden="true" viewBox="0 0 32 32" fill="currentColor"><path d="M16 2.5C12.3 7.6 6.5 14.3 6.5 19.5a9.5 9.5 0 0 0 19 0C25.5 14.3 19.7 7.6 16 2.5z"/></svg>';

// ---------------------------------------------------------------------------
// Small helpers

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

export function formatPhone(e164) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(e164);
}

const isUsPhone = (v) => /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(v);
const isFictionalPhone = (v) => /^\+1\d{3}55501\d{2}$/.test(v);

function formatDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function* walkStrings(value, where = '') {
  if (typeof value === 'string') yield [where, value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* walkStrings(v, `${where}[${i}]`);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('$')) continue; // "$comment" notes are for humans, never rendered
      yield* walkStrings(v, where ? `${where}.${k}` : k);
    }
  }
}

function outputFileFor(urlPath) {
  if (urlPath === '/') return 'index.html';
  if (urlPath.endsWith('.html')) return urlPath.slice(1);
  if (urlPath.endsWith('/')) return `${urlPath.slice(1)}index.html`;
  return null;
}

function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

// ---------------------------------------------------------------------------
// Loading and checking a site's config

export async function listSiteDirs(sitesDir = DEFAULT_SITES_DIR) {
  const entries = await readdir(sitesDir, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(sitesDir, entry.name);
    try {
      await stat(path.join(dir, 'site.json'));
      dirs.push(dir);
    } catch {
      // Not a site folder.
    }
  }
  return dirs.sort();
}

export async function loadSite(dir) {
  const slug = path.basename(dir);
  const raw = await readFile(path.join(dir, 'site.json'), 'utf8');
  try {
    return { dir, slug, config: JSON.parse(raw) };
  } catch (err) {
    throw new BuildError(slug, [`site.json is not valid JSON: ${err.message}`]);
  }
}

function resolveConfig(site, { production, forceLive, now }) {
  const problems = [];
  const warnings = [];
  const samples = [];
  const c = structuredClone(site.config);
  const strictly = (message) => (production ? problems : warnings).push(message);

  for (const key of ['domain', 'brand', 'service', 'city', 'state', 'stateName', 'lastReviewed']) {
    if (typeof c[key] !== 'string' || !c[key].trim()) problems.push(`${key} is required`);
  }
  if (c.domain && !/^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/.test(c.domain)) {
    problems.push(`domain "${c.domain}" should be a bare lowercase hostname like example.com`);
  }
  if (!Array.isArray(c.pages) || c.pages.length === 0) problems.push('pages must list at least one page');
  if (production && forceLive) {
    problems.push('--live is for previews only. To publish in call mode, add the partner and phone number to site.json.');
  }

  const live = Boolean(c.partner) || (Boolean(forceLive) && !production);

  c.operator = { ...(c.operator ?? {}) };
  for (const key of ['name', 'email']) {
    if (c.operator[key]) continue;
    if (production) problems.push(`operator.${key} is missing (who runs the site; it appears in the footer, the About page and the policies)`);
    else {
      c.operator[key] = SAMPLE.operator[key];
      samples.push(`operator.${key}`);
    }
  }

  if (live) {
    if (!c.partner) {
      c.partner = structuredClone(SAMPLE.partner);
      samples.push('partner');
    }
    c.partner = { ...c.partner, license: { ...(c.partner.license ?? {}) } };
    const fill = (obj, key, sample, label) => {
      if (obj[key]) return;
      if (production) problems.push(`${label} is missing. Call mode has to name the licensed company and its license.`);
      else {
        obj[key] = sample;
        samples.push(label);
      }
    };
    fill(c.partner, 'company', SAMPLE.partner.company, 'partner.company');
    fill(c.partner.license, 'holder', SAMPLE.partner.license.holder, 'partner.license.holder');
    fill(c.partner.license, 'number', SAMPLE.partner.license.number, 'partner.license.number');
    c.partner.license.label ||= SAMPLE.partner.license.label;
    if (!c.phone) {
      if (production) problems.push('phone is missing. Call mode needs the tracking number in E.164 form, like +17135550123.');
      else {
        c.phone = SAMPLE.phone;
        samples.push('phone');
      }
    }
    for (const key of ['name', 'statement', 'address', 'phone', 'url']) {
      if (!c.regulator?.[key]) problems.push(`regulator.${key} is required in call mode (the license statement names the licensing board)`);
    }
  } else if (c.phone) {
    strictly(
      'phone is set but partner is empty, so the number stays off the site. Texas only lets you advertise plumbing ' +
        'once a Responsible Master Plumber is secured (Occupations Code §1301.351(a-2)). Add the partner to switch to call mode.',
    );
    c.phone = null;
  }

  if (c.phone) {
    if (!isUsPhone(c.phone)) problems.push(`phone "${c.phone}" must be a US number in E.164 form, like +17135550123`);
    else if (production && isFictionalPhone(c.phone)) problems.push(`phone ${c.phone} is a 555-01xx number reserved for fiction. Use the real tracking number.`);
  }
  for (const number of c.safetyPhones ?? []) {
    if (number !== '911' && !isUsPhone(number)) problems.push(`safetyPhones entry "${number}" must be 911 or a US number in E.164 form`);
  }

  if (production) {
    if (c.operator.email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(c.operator.email)) {
      problems.push(`operator.email "${c.operator.email}" doesn't look like an email address`);
    }
    for (const [where, value] of walkStrings(c)) {
      if (PLACEHOLDER.test(value)) problems.push(`${where} still holds placeholder text: "${value}"`);
    }
  }

  const reviewed = Date.parse(`${c.lastReviewed}T00:00:00Z`);
  if (Number.isNaN(reviewed)) problems.push(`lastReviewed "${c.lastReviewed}" must be a date like 2026-11-20`);
  else if ((now - reviewed) / 86_400_000 > 365) {
    strictly('lastReviewed is over a year old. Re-check permit rules, fees and phone numbers, then update the date.');
  }

  if (samples.length) warnings.push(`sample values filled in for: ${samples.join(', ')}`);
  return { c, live, problems, warnings, samples };
}

// ---------------------------------------------------------------------------
// Rendering

function makeContext(site, resolved, { production, now, css, networkDomains }) {
  const { c, live, samples } = resolved;
  const pages = c.pages.map((p) => {
    const merged = { nav: null, footer: null, noindex: false, sitemap: true, ...p, ...(live ? p.live : p.guide) };
    delete merged.live;
    delete merged.guide;
    return merged;
  });
  const byRole = (role) => pages.find((p) => p.role === role);
  const year = String(new Date(now).getUTCFullYear());
  const tokens = {
    brand: c.brand,
    domain: c.domain,
    service: c.service,
    city: c.city,
    state: c.state,
    stateName: c.stateName,
    year,
    lastReviewed: formatDate(c.lastReviewed),
    lastReviewedIso: c.lastReviewed,
    operatorName: c.operator.name,
    operatorEmail: c.operator.email,
    retentionDays: String(c.retentionDays ?? 90),
  };
  if (c.regulator) {
    Object.assign(tokens, {
      regulatorName: c.regulator.name,
      regulatorStatement: c.regulator.statement,
      regulatorAddress: c.regulator.address,
      regulatorPhone: c.regulator.phone,
      regulatorUrl: c.regulator.url,
      regulatorHost: c.regulator.url ? new URL(c.regulator.url).host : '',
    });
  }
  if (live) {
    Object.assign(tokens, {
      phone: formatPhone(c.phone),
      phoneE164: c.phone,
      partnerCompany: c.partner.company,
      licenseHolder: c.partner.license.holder,
      licenseNumber: c.partner.license.number,
      licenseLabel: c.partner.license.label,
    });
  }
  return { site, c, live, production, samples, pages, byRole, tokens, css, networkDomains, now };
}

function components(ctx) {
  const { c, live } = ctx;
  const e = escapeHtml;
  const about = ctx.byRole('about')?.path ?? '/';
  const callModeOnly = (name, render) => () => {
    if (!live) throw new Error(`[[${name}]] only works in call mode. Wrap it in <!-- if:live --> ... <!-- /if:live -->.`);
    return render();
  };
  return {
    cta: callModeOnly('cta', () =>
      `<div class="cta-block"><a class="cta" href="tel:${e(c.phone)}">${PHONE_ICON}<span>Call ${e(formatPhone(c.phone))}</span></a>` +
        `<p class="cta-note">Free call, answered 24/7 by an automated assistant. We're a referral service: ` +
        `the work is done by ${e(c.partner.company)}, a licensed plumbing company. <a href="${about}">How it works</a></p></div>`,
    ),
    'call-link': callModeOnly('call-link', () => `<a href="tel:${e(c.phone)}">${e(formatPhone(c.phone))}</a>`),
    license: callModeOnly('license', () => licenseHtml(c)),
    disclosure: () =>
      live
        ? `<aside class="disclosure" aria-label="Referral disclosure"><p><strong>Referral disclosure:</strong> ${e(c.brand)} is an ` +
          `independent referral service, not a plumbing company. Calls are answered by an automated assistant and passed to ` +
          `${e(c.partner.company)}, which does the work under ${e(c.stateName)} license ${e(c.partner.license.number)} and pays us ` +
          `for referrals. <a href="${about}">Details</a></p></aside>`
        : `<aside class="disclosure" aria-label="About this site"><p><strong>About this site:</strong> ${e(c.brand)} is an ` +
          `independent guide. We don't do plumbing work, and we don't refer you to any company. <a href="${about}">Details</a></p></aside>`,
  };
}

function licenseHtml(c) {
  const e = escapeHtml;
  const p = c.partner;
  const r = c.regulator;
  // Company names often end in "Co." or "Inc.", so no sentence ends right after one.
  return (
    `<p class="license">Plumbing work is performed by <strong>${e(p.company)}</strong> (${e(p.license.label)}: ` +
    `${e(p.license.holder)}, ${e(c.stateName)} license ${e(p.license.number)}). ${e(r.statement)}, ${e(r.address)}, ` +
    `${e(r.phone)}, <a href="${e(r.url)}">${e(new URL(r.url).host)}</a>.</p>`
  );
}

function applyConditionals(html, flags) {
  return html.replace(/<!--\s*if:(\w+)\s*-->([\s\S]*?)<!--\s*\/if:\1\s*-->/g, (_, flag, inner) => {
    if (!(flag in flags)) throw new Error(`unknown condition "if:${flag}" (use live, guide, preview or production)`);
    return flags[flag] ? inner : '';
  });
}

function renderFragment(source, ctx) {
  const flags = { live: ctx.live, guide: !ctx.live, preview: !ctx.production, production: ctx.production };
  let html = applyConditionals(source, flags);
  const parts = components(ctx);
  html = html.replace(/\[\[([a-z-]+)\]\]/g, (_, name) => {
    if (!parts[name]) throw new Error(`unknown component [[${name}]]`);
    return parts[name]();
  });
  html = html.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!ctx.live && LIVE_TOKENS.has(name)) {
      throw new Error(`{{${name}}} only works in call mode. Wrap it in <!-- if:live --> ... <!-- /if:live -->.`);
    }
    if (!(name in ctx.tokens)) throw new Error(`unknown token {{${name}}}`);
    return escapeHtml(ctx.tokens[name]);
  });
  const leftover = /\{\{|\[\[|<!--\s*\/?if:/.exec(html);
  if (leftover) throw new Error(`unmatched template syntax near "${html.slice(leftover.index, leftover.index + 40)}"`);
  return html;
}

function jsonLd(ctx, page) {
  const { c, live } = ctx;
  const origin = `https://${c.domain}`;
  const blocks = [];
  if (page.role === 'home') {
    blocks.push({ '@context': 'https://schema.org', '@type': 'WebSite', name: c.brand, url: `${origin}/` });
    if (live) {
      blocks.push({
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: `${c.brand} referral line`,
        serviceType: c.service,
        areaServed: { '@type': 'City', name: c.city, containedInPlace: { '@type': 'State', name: c.stateName } },
        provider: { '@type': 'Organization', name: c.partner.company },
        broker: { '@type': 'Organization', name: c.brand, url: `${origin}/`, telephone: c.phone },
        availableChannel: {
          '@type': 'ServiceChannel',
          servicePhone: { '@type': 'ContactPoint', telephone: c.phone, contactType: 'customer service', availableLanguage: 'en' },
        },
      });
    }
  } else if (!page.noindex) {
    const home = ctx.byRole('home');
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: home?.nav ?? c.brand, item: `${origin}/` },
        { '@type': 'ListItem', position: 2, name: page.nav ?? page.footer ?? page.title, item: `${origin}${page.path}` },
      ],
    });
  }
  return blocks
    .map((b) => `<script type="application/ld+json">${JSON.stringify(b).replace(/</g, '\\u003c')}</script>`)
    .join('');
}

function themeCss(theme) {
  const vars = (map) => Object.entries(map ?? {}).map(([k, v]) => `${k}:${v}`).join(';');
  let out = '';
  if (theme?.light) out += `:root{${vars(theme.light)}}`;
  if (theme?.dark) out += `@media (prefers-color-scheme:dark){:root{${vars(theme.dark)}}}`;
  return out;
}

function layout(ctx, page, body) {
  const { c, live, production, pages } = ctx;
  const e = escapeHtml;
  const canonical = `https://${c.domain}${page.path}`;
  const noindex = !production || page.noindex;
  const nav = pages
    .filter((p) => p.nav)
    .map((p) => `<a href="${p.path}"${p.path === page.path ? ' aria-current="page"' : ''}>${e(p.nav)}</a>`)
    .join('');
  const legal = pages
    .filter((p) => p.footer)
    .map((p) => `<a href="${p.path}">${e(p.footer)}</a>`)
    .join('');
  const about = ctx.byRole('about');
  const footerNav = [about ? `<a href="${about.path}">${e(about.nav ?? 'About')}</a>` : '', legal].join('');
  const ribbon = production
    ? ''
    : `<div class="preview-ribbon" role="note">Preview build${ctx.samples.length ? ' with sample details' : ''}. Search engines are told not to index it. Run a production build before publishing.</div>`;
  const headerCall = live ? `<a class="header-call" href="tel:${e(c.phone)}">${e(formatPhone(c.phone))}</a>` : '';
  const callbar = live
    ? `<div class="callbar"><a class="cta" href="tel:${e(c.phone)}">${PHONE_ICON}<span>Call ${e(formatPhone(c.phone))} · 24/7</span></a></div>`
    : '';
  const footerText = live
    ? `${e(c.brand)} is an independent referral service, not a plumbing company. Calls are answered by an automated assistant and recorded.`
    : `${e(c.brand)} is an independent guide, not a plumbing company.`;
  const themeColor = c.theme?.light?.['--accent'] ?? '#0b5cad';

  return `<!doctype html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${e(page.title)}</title>
<meta name="description" content="${e(page.description)}">
${page.noindex ? '' : `<link rel="canonical" href="${e(canonical)}">\n`}<meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow'}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${e(c.brand)}">
<meta property="og:title" content="${e(page.title)}">
<meta property="og:description" content="${e(page.description)}">
<meta property="og:url" content="${e(canonical)}">
<meta name="theme-color" content="${e(themeColor)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${ctx.css}${themeCss(c.theme)}</style>
${jsonLd(ctx, page)}
</head>
<body${live ? ' class="has-callbar"' : ''}>
<a class="skip" href="#main">Skip to content</a>
${ribbon}<header class="site-header"><div class="wrap"><a class="logo" href="/">${DROP_ICON}<span>${e(c.brand)}</span></a><nav class="nav" aria-label="Main">${nav}</nav>${headerCall}</div></header>
<main id="main">
${body.trim()}
</main>
<footer class="site-footer"><div class="wrap">
<p>${footerText}</p>
${live ? licenseHtml(c) : ''}
<nav class="footer-nav" aria-label="Site information">${footerNav}</nav>
<p>© ${e(ctx.tokens.year)} ${e(c.operator.name)}. Facts last checked ${e(ctx.tokens.lastReviewed)}. Not affiliated with the City of ${e(c.city)} or any manufacturer.</p>
</div></footer>
${callbar}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Checks that run on the rendered HTML

function collect(regex, html) {
  return [...html.matchAll(regex)].map((m) => m[1]);
}

function checkRendered(ctx, rendered, staticFiles) {
  const problems = [];
  const warnings = [];
  const { c, live } = ctx;
  const ownHost = c.domain.replace(/^www\./, '');
  const network = new Set(ctx.networkDomains.map((d) => d.replace(/^www\./, '')).filter((d) => d !== ownHost));
  const allowedTel = new Set([...(c.safetyPhones ?? []), ...(live ? [c.phone] : [])]);
  const idsByPath = new Map();

  for (const [pagePath, { html }] of rendered) {
    const ids = collect(/\sid="([^"]+)"/g, html);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) problems.push(`${pagePath}: duplicate id(s) ${[...new Set(dupes)].join(', ')}`);
    idsByPath.set(pagePath, new Set(ids));
  }

  for (const [pagePath, { html, page }] of rendered) {
    const h1s = html.match(/<h1[\s>]/g)?.length ?? 0;
    if (h1s !== 1) problems.push(`${pagePath}: needs exactly one <h1>, found ${h1s}`);
    if (page.title.length > 65) warnings.push(`${pagePath}: title is ${page.title.length} characters; Google usually shows about 60`);
    if (!page.description) problems.push(`${pagePath}: description is required`);
    else if (page.description.length > 165) warnings.push(`${pagePath}: description is ${page.description.length} characters; aim for under 160`);

    // Only <a> links: the head's canonical and icon links are generated, not authored.
    for (const href of collect(/<a\s[^>]*?href="([^"]*)"/g, html)) {
      if (href.startsWith('#')) {
        if (href.length > 1 && !idsByPath.get(pagePath).has(href.slice(1))) problems.push(`${pagePath}: link ${href} has no matching id`);
      } else if (href.startsWith('tel:')) {
        const number = href.slice(4);
        if (!allowedTel.has(number)) {
          problems.push(
            live
              ? `${pagePath}: tel link ${number} is neither the tracking number nor in safetyPhones`
              : `${pagePath}: tel link ${number} in guide mode. Only safetyPhones may appear before a partner is signed.`,
          );
        }
      } else if (href.startsWith('mailto:')) {
        // fine
      } else if (href.startsWith('http://')) {
        problems.push(`${pagePath}: use https for ${href}`);
      } else if (href.startsWith('https://')) {
        const host = new URL(href).host.replace(/^www\./, '');
        if (network.has(host)) {
          problems.push(`${pagePath}: links to ${host}, another site in this network. Microsites must never link to each other.`);
        } else if (host === ownHost) {
          problems.push(`${pagePath}: use a root-relative link instead of ${href}`);
        }
      } else if (href.startsWith('/') && !href.startsWith('//')) {
        const [target, hash] = href.split('#');
        if (staticFiles.has(target)) continue;
        if (!rendered.has(target)) {
          problems.push(
            rendered.has(`${target}/`)
              ? `${pagePath}: link ${target} should end with a slash (${target}/)`
              : `${pagePath}: link ${href} points to a page that doesn't exist`,
          );
        } else if (hash && !idsByPath.get(target).has(hash)) {
          problems.push(`${pagePath}: link ${href} has no matching id on ${target}`);
        }
      } else {
        problems.push(`${pagePath}: use a root-relative link (starting with /) instead of "${href}"`);
      }
    }
  }
  return { problems, warnings };
}

// ---------------------------------------------------------------------------
// Extra files

function robotsTxt(ctx) {
  if (!ctx.production) return 'User-agent: *\nDisallow: /\n';
  return `User-agent: *\nAllow: /\n\nSitemap: https://${ctx.c.domain}/sitemap.xml\n`;
}

function sitemapXml(ctx) {
  const urls = ctx.pages
    .filter((p) => !p.noindex && p.sitemap !== false)
    .map((p) => `  <url><loc>https://${ctx.c.domain}${p.path}</loc><lastmod>${ctx.c.lastReviewed}</lastmod></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// Cloudflare Pages and Netlify both read _headers. The CSP allows Cloudflare Web
// Analytics, which Pages injects when you switch it on in the dashboard.
function headersFile(ctx) {
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://static.cloudflareinsights.com",
    "style-src 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self' https://cloudflareinsights.com",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  const lines = [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  X-Frame-Options: DENY',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '  Strict-Transport-Security: max-age=31536000',
    `  Content-Security-Policy: ${csp}`,
  ];
  if (!ctx.production) lines.push('  X-Robots-Tag: noindex, nofollow');
  lines.push('', '/favicon.svg', '  Cache-Control: public, max-age=604800', '');
  return lines.join('\n');
}

function faviconSvg(ctx) {
  const accent = ctx.c.theme?.light?.['--accent'] ?? '#0b5cad';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${escapeHtml(accent)}"/><path d="M32 10c-7 9.6-16.5 21.6-16.5 31a16.5 16.5 0 0 0 33 0C48.5 31.6 39 19.6 32 10z" fill="#fff"/></svg>\n`;
}

// ---------------------------------------------------------------------------
// Public API

export async function buildSite(site, { production = false, forceLive = false, outDir = DEFAULT_OUT_DIR, networkDomains = [], now = Date.now() } = {}) {
  const resolved = resolveConfig(site, { production, forceLive, now });
  if (resolved.problems.length) throw new BuildError(site.slug, resolved.problems);

  const css = minifyCss(await readFile(path.join(LIB_DIR, 'styles.css'), 'utf8'));
  const ctx = makeContext(site, resolved, { production, now, css, networkDomains });
  const problems = [];
  const rendered = new Map();

  for (const page of ctx.pages) {
    for (const key of ['file', 'path', 'title']) if (!page[key]) problems.push(`page ${page.id ?? '?'}: ${key} is required`);
    if (!page.path || !page.file) continue;
    if (!outputFileFor(page.path)) {
      problems.push(`page ${page.id}: path ${page.path} must be "/", end with "/", or end with ".html"`);
      continue;
    }
    if (rendered.has(page.path)) {
      problems.push(`page ${page.id}: path ${page.path} is used twice`);
      continue;
    }
    let source;
    try {
      source = await readFile(path.join(site.dir, 'pages', page.file), 'utf8');
    } catch {
      problems.push(`page ${page.id}: pages/${page.file} not found`);
      continue;
    }
    try {
      rendered.set(page.path, { page, html: layout(ctx, page, renderFragment(source, ctx)) });
    } catch (err) {
      problems.push(`pages/${page.file}: ${err.message}`);
    }
  }
  if (!ctx.byRole('home')) problems.push('one page needs "role": "home"');
  if (!ctx.pages.some((p) => p.path === '/404.html')) problems.push('add a /404.html page, or static hosts treat the site as a single-page app');
  if (problems.length) throw new BuildError(site.slug, problems);

  const extras = new Map([
    ['/robots.txt', robotsTxt(ctx)],
    ['/sitemap.xml', sitemapXml(ctx)],
    ['/_headers', headersFile(ctx)],
    ['/favicon.svg', faviconSvg(ctx)],
  ]);
  const checked = checkRendered(ctx, rendered, new Set(extras.keys()));
  if (checked.problems.length) throw new BuildError(site.slug, checked.problems);

  const target = production ? path.join(outDir, ctx.c.domain) : path.join(outDir, 'preview', ctx.c.domain);
  await rm(target, { recursive: true, force: true });
  const files = [];
  for (const [urlPath, { html }] of rendered) files.push([outputFileFor(urlPath), html]);
  for (const [urlPath, body] of extras) files.push([urlPath.slice(1), body]);
  for (const [rel, body] of files) {
    const file = path.join(target, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  return {
    slug: site.slug,
    domain: ctx.c.domain,
    mode: ctx.live ? 'call' : 'guide',
    production,
    outDir: target,
    files: files.map(([rel]) => rel).sort(),
    warnings: [...resolved.warnings, ...checked.warnings],
  };
}

export async function buildAll({ sitesDir = DEFAULT_SITES_DIR, outDir = DEFAULT_OUT_DIR, only = [], production = false, forceLive = false, now = Date.now() } = {}) {
  const sites = await Promise.all((await listSiteDirs(sitesDir)).map(loadSite));
  const bySlug = new Map(sites.map((s) => [s.slug, s]));
  const failures = [];

  const owners = new Map();
  for (const s of sites) {
    const domain = s.config.domain;
    if (!domain) continue;
    if (owners.has(domain)) failures.push(new BuildError(s.slug, [`domain ${domain} is also used by sites/${owners.get(domain)}`]));
    else owners.set(domain, s.slug);
  }
  for (const name of only) if (!bySlug.has(name)) failures.push(new BuildError(name, [`no folder sites/${name} with a site.json`]));
  if (failures.length) return { results: [], failures };

  const networkDomains = [...owners.keys()];
  const results = [];
  for (const site of only.length ? only.map((n) => bySlug.get(n)) : sites) {
    try {
      results.push(await buildSite(site, { production, forceLive, outDir, networkDomains, now }));
    } catch (err) {
      if (err instanceof BuildError) failures.push(err);
      else throw err;
    }
  }
  return { results, failures };
}
