// Bulwark dashboard. Plain JavaScript, no build step. Everything shown from a scan is escaped:
// device names, banners and page titles come from the network and can't be trusted.

const KEY_STORE = "bulwark.key";
const S = { data: null, tab: "device", open: new Set(), device: null, job: null, modal: null, scans: null, authFailed: false };
let key = readKey();

function readKey() {
  const m = location.hash.match(/key=([a-f0-9]{48})/);
  let k = null;
  if (m) {
    k = m[1];
    try { localStorage.setItem(KEY_STORE, k); } catch { /* private mode */ }
    history.replaceState(null, "", location.pathname);
  }
  if (!k) {
    try { k = localStorage.getItem(KEY_STORE); } catch { /* unavailable */ }
  }
  return k;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const SEVS = ["critical", "high", "medium", "low"];
const RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : await res.text();
  if (res.status === 401) {
    S.authFailed = true;
    render();
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || res.statusText);
    err.code = data && data.code;
    err.data = data;
    throw err;
  }
  return data;
}

// ── icons (static markup) ──

const svg = (body, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  shield: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.5 4.5 7v8.2c0 7.1 4.9 12.5 11.5 14.3 6.6-1.8 11.5-7.2 11.5-14.3V7L16 2.5Z" fill="var(--accent)"/><path d="m10.5 16.2 3.8 3.8 7.2-7.6" fill="none" stroke="var(--accent-ink)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  warn: svg('<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4.5M12 17.5v.01"/>'),
  scan: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  wand: svg('<path d="m4 20 11-11M14 4l1 2.5L17.5 7.5 15 8.5 14 11l-1-2.5L10.5 7.5 13 6.5 14 4ZM19 12l.6 1.4L21 14l-1.4.6L19 16l-.6-1.4L17 14l1.4-.6L19 12Z"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  doc: svg('<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8l-5-5Z"/><path d="M14 3v5h5M8.5 13h7M8.5 17h5"/>'),
  router: svg('<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 16.5h.01M11 16.5h.01M8 13l-2-6M16 13l2-6M9.5 6.5a4 4 0 0 1 5 0"/>'),
  computer: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
  phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
  camera: svg('<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h11A1.5 1.5 0 0 1 17 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-7Z"/><path d="m17 10.5 4-2.5v8l-4-2.5"/>'),
  printer: svg('<path d="M7 9V3.5h10V9M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="6.5" rx="1"/>'),
  tv: svg('<rect x="2.5" y="5" width="19" height="12.5" rx="2"/><path d="M8 21h8"/>'),
  speaker: svg('<rect x="5.5" y="2.5" width="13" height="19" rx="2.5"/><circle cx="12" cy="14.5" r="3.2"/><path d="M12 7h.01"/>'),
  nas: svg('<rect x="4" y="3" width="16" height="7.5" rx="1.5"/><rect x="4" y="13.5" width="16" height="7.5" rx="1.5"/><path d="M8 6.75h.01M8 17.25h.01"/>'),
  home: svg('<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>'),
  device: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="12" cy="12" r="3"/>'),
  code: svg('<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-11Z"/><path d="m10 11-2 2 2 2M14 11l2 2-2 2"/>'),
  package: svg('<path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9L12 3Z"/><path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9"/>'),
};
const KIND_ICON = { Router: "router", Computer: "computer", "This device": "computer", "Phone or tablet": "phone", "Phone or laptop": "phone", "Android device": "phone", Camera: "camera", Printer: "printer", "TV or streaming device": "tv", Speaker: "speaker", NAS: "nas", "Smart home device": "home" };

// ── derived data ──

const scan = () => S.data && S.data.scan;
const localFindings = () => (scan() && scan().local ? scan().local.findings : []);
const deviceFindings = () => localFindings().filter((f) => f.category !== "Software");
const softwareFindings = () => localFindings().filter((f) => f.category === "Software");
const codeFindings = () => (scan() && scan().code ? scan().code.findings : []);
const netFindings = () => (scan() && scan().network ? scan().network.findings : []);
const everyFinding = () => [...localFindings(), ...codeFindings(), ...netFindings()];
const failing = (list) => list.filter((f) => f.status === "fail");

function counts(list) {
  const c = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of failing(list)) if (c[f.severity] !== undefined) c[f.severity]++;
  return c;
}

/** The change that fixed this finding, if one was applied after the scan and checked out. */
function fixedBy(f) {
  const s = scan();
  return (S.data.changes || []).find((c) => c.status === "applied" && c.findingId.split(",").includes(f.id) && s && c.appliedAt >= s.startedAt && (!c.verification || c.verification.status === "pass"));
}

function safeFixable(list) {
  return failing(list).filter((f) => f.remedy && f.remedy.auto && S.data.safeFixes.includes(f.remedy.auto.fixId) && !fixedBy(f));
}

const when = (iso) => {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleString();
};

// ── pieces ──

function sevBadge(sev) {
  return `<span class="sev sev-${esc(sev)}"><i class="dot bg-${esc(sev)}"></i>${esc(sev)}</span>`;
}

function ring(score) {
  const c = 2 * Math.PI * 44;
  const cls = score >= 80 ? "good" : score >= 50 ? "fair" : "poor";
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "F";
  return `<div class="ring" role="img" aria-label="Security score ${score} out of 100">
    <svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="44" fill="none" stroke-width="9"/>
    <circle class="val ${cls}" cx="50" cy="50" r="44" fill="none" stroke-width="9" stroke-linecap="round" stroke-dasharray="${((score / 100) * c).toFixed(1)} ${c.toFixed(1)}"/></svg>
    <div class="ring-label"><div><strong>${score}</strong><small>GRADE ${grade}</small></div></div></div>`;
}

function countRow(c) {
  const parts = SEVS.filter((s) => c[s]).map((s) => `<span class="count"><i class="dot bg-${s}"></i>${c[s]} ${s}</span>`);
  return parts.length ? parts.join("") : `<span class="count"><i class="dot bg-ok"></i>No problems found</span>`;
}

// Turns "…: sudo apt install ufw" into text plus a code span.
function stepHtml(step) {
  const m = step.match(/^(.*?(?::|with|Run|run))\s+((?:sudo|apt|ufw|systemctl|Set-|Get-|chmod|echo|docker|adb|csrutil|softwareupdate|spctl|defaults|mosquitto|ssh|visudo|passwd|usermod)\b.*)$/);
  if (m) return `${esc(m[1])} <code>${esc(m[2])}</code>`;
  return esc(step);
}

function findingItem(f) {
  const open = S.open.has(f.id);
  const fixed = fixedBy(f);
  const auto = f.remedy && f.remedy.auto;
  const meta = [];
  if (fixed) meta.push(`<span class="pill pill-ok">${ICON.check} Fixed</span>`);
  else if (auto) meta.push(`<span class="pill pill-accent">Auto fix</span>`);
  else if (f.status === "fail") meta.push(`<span class="pill pill-muted">Manual steps</span>`);
  if (f.confidence && f.confidence !== "confirmed") meta.push(`<span class="pill pill-muted">${esc(f.confidence)}</span>`);
  let body = "";
  if (open) {
    const steps = (f.remedy && f.remedy.steps) || [];
    body = `<div class="finding-body">
      <h4>Why it matters</h4><p>${esc(f.why)}</p>
      ${f.confidence === "possible" ? `<p class="hint">Bulwark isn't certain: the version matches a vulnerable release, but the maker may have patched it without changing the number.</p>` : ""}
      ${f.evidence && f.evidence.length ? `<h4>What Bulwark saw</h4><pre class="evidence">${esc(f.evidence.join("\n"))}</pre>` : ""}
      ${f.cves && f.cves.length ? `<h4>Known vulnerabilities</h4><div class="cves">${f.cves.map((c) => `<a class="pill pill-muted" href="https://www.cve.org/CVERecord?id=${encodeURIComponent(c)}" target="_blank" rel="noopener noreferrer">${esc(c)}</a>`).join("")}</div>` : ""}
      ${steps.length ? `<h4>${auto ? "Or fix it by hand" : "How to fix it"}</h4><ol>${steps.map((s) => `<li>${stepHtml(s)}</li>`).join("")}</ol>` : ""}
      <div class="actions">
        ${fixed ? `<button class="btn" data-action="undo" data-change="${esc(fixed.id)}">${ICON.undo} Undo this fix</button>` : auto ? `<button class="btn btn-primary" data-action="plan" data-ids="${esc(f.id)}">${ICON.wand} Review the fix</button>` : ""}
        ${steps.length ? `<button class="btn" data-action="copy" data-text="${esc(steps.join("\n"))}">Copy steps</button>` : ""}
      </div>
    </div>`;
  }
  return `<div class="finding">
    <button class="finding-head" data-action="toggle" data-id="${esc(f.id)}" aria-expanded="${open}">
      ${sevBadge(f.severity)}
      <span><div class="f-title">${esc(f.title)}</div><div class="f-sum">${esc(f.summary)}</div></span>
      <span class="f-meta">${meta.join("")}</span>
    </button>${body}</div>`;
}

function findingList(list) {
  return `<div class="list">${list.map(findingItem).join("")}</div>`;
}

// ── screens ──

function topBar() {
  const d = S.data.device;
  return `<header class="top"><div class="top-inner">
    <div class="brand">${ICON.shield}<span>Bulwark</span></div>
    <div class="device-chip"><span>${esc(d.hostname)} · ${esc(d.os)}</span>
      ${d.isRoot ? `<span class="pill pill-ok">Admin</span>` : `<span class="pill pill-warn">Read-only</span>`}</div>
    <div class="spacer"></div>
    ${scan() ? `<button class="btn btn-ghost btn-sm" data-action="report">${ICON.doc} Report</button>` : ""}
    <button class="btn btn-primary" data-action="scan-dialog" ${S.job ? "disabled" : ""}>${ICON.scan} Scan</button>
  </div></header>`;
}

function banners() {
  const out = [];
  if (S.data.demo) {
    out.push(`<div class="banner banner-info">${ICON.home}<div><b>Demo network</b>These devices are pretend ones running on this computer (127.0.0.x), with the kinds of holes real routers, cameras and NAS boxes have, and the two code projects are pretend ones in Bulwark's demo folder. Try the fixes: they really run, on the pretend router and the pretend projects.</div></div>`);
  } else if (!S.data.device.isRoot) {
    out.push(`<div class="banner banner-warn">${ICON.warn}<div><b>Read-only mode</b>Bulwark can find problems but can't fix most of them without admin rights. Stop it and start it again with <code>./bulwark serve --sudo</code>${S.data.device.platform === "win32" ? " (on Windows: from a terminal opened with \"Run as administrator\")" : ""}.</div></div>`);
  }
  return out.join("");
}

function welcome() {
  return `<div class="empty">
    <h3>Find the security holes in your devices, and fix them</h3>
    <p>Bulwark checks this computer's settings, accounts, services and installed software, the code projects you point it at (for dependencies with known vulnerabilities), and, if you want, every device on your network: routers, cameras, printers, TVs, NAS boxes. Every fix is shown before it's applied and can be undone.</p>
    <button class="btn btn-primary" data-action="scan-dialog">${ICON.scan} Run the first scan</button>
  </div>`;
}

function overview() {
  const s = scan();
  const all = everyFinding();
  const score = s.local ? s.scores.local : s.code && !s.network ? s.scores.code : Math.min(100, ...Object.values(s.scores.devices || { x: 100 }));
  const safe = safeFixable(all);
  const devs = s.network ? s.network.devices.length : 0;
  const projects = s.code ? s.code.projects.length : 0;
  return `<section class="overview">
    ${ring(score ?? 100)}
    <div>
      <h1 class="ov-title">${s.local ? (score >= 90 ? "This device is in good shape" : score >= 65 ? "A few things to fix" : "This device needs attention") : s.code && !s.network ? "Code projects" : "Network scan"}</h1>
      <p class="ov-sub">Scanned ${esc(when(s.finishedAt || s.startedAt))}${s.code ? ` · ${plural(projects, "code project")}` : ""}${s.network ? ` · ${plural(devs, "device")} on ${esc(s.network.targets.slice(0, 3).join(", "))}${s.network.targets.length > 3 ? ` and ${s.network.targets.length - 3} more` : ""}` : ""}</p>
      <div class="counts">${countRow(counts(all))}</div>
    </div>
    <div class="ov-actions">
      ${safe.length ? `<button class="btn btn-primary" data-action="fix-all" ${S.job || !S.data.device.isRoot ? "disabled" : ""}>${ICON.wand} Fix ${plural(safe.length, "low-risk issue")}</button>` : ""}
      <button class="btn" data-action="scan-dialog" ${S.job ? "disabled" : ""}>${ICON.scan} Scan again</button>
    </div>
  </section>`;
}

function tabs() {
  const s = scan();
  const t = (id, label, n) => `<button class="tab" role="tab" data-action="tab" data-tab="${id}" aria-selected="${S.tab === id}">${label}${n !== undefined ? `<span class="n">${n}</span>` : ""}</button>`;
  return `<nav class="tabs" role="tablist">
    ${t("device", "This device", s.local ? failing(deviceFindings()).length : undefined)}
    ${t("software", "Software", s.local || s.code ? failing([...softwareFindings(), ...codeFindings()]).length : undefined)}
    ${t("network", "Network", s.network ? s.network.devices.length : undefined)}
    ${t("history", "History", (S.data.changes || []).length || undefined)}
  </nav>`;
}

function deviceTab() {
  const s = scan();
  if (!s.local) return `<div class="empty"><h3>This device wasn't part of the last scan</h3><button class="btn btn-primary" data-action="scan-dialog">${ICON.scan} Scan this device</button></div>`;
  const list = deviceFindings();
  const fails = failing(list).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const passed = list.filter((f) => f.status === "pass");
  const skipped = list.filter((f) => f.status === "skipped" || f.status === "error");
  let html = "";
  if (fails.length) html += `<div class="group-title">Problems</div>${findingList(fails)}`;
  else html += `<div class="empty"><h3>No problems found on this device</h3><p>Every check Bulwark ran came back clean.</p></div>`;
  if (passed.length) html += `<div class="group-title">Passed</div><div class="passed">${passed.map((f) => `<span>${ICON.check}${esc(f.summary)}</span>`).join("")}</div>`;
  if (skipped.length) html += `<div class="group-title">Not checked</div><div class="passed">${skipped.map((f) => `<span>${esc(f.summary)}</span>`).join("")}</div>`;
  return html;
}

const inProject = (f, dir) => f.id.startsWith(`deps.vulnerable@${dir}#`);

function projectCard(p, list) {
  const open = S.device === `code:${p.path}`;
  const status = !scan().code.online ? `<span class="count">Not checked (offline)</span>` : countRow(counts(list)).replace("No problems found", "No known vulnerabilities");
  return `<button class="device" data-action="device" data-ip="${esc(`code:${p.path}`)}" aria-expanded="${open}">
    <div class="device-top"><div class="device-icon">${ICON.code}</div>
      <div class="sr-wrap"><div class="device-name">${esc(p.name)}</div><div class="device-sub">${esc(p.path)}</div></div></div>
    <div class="counts">${status}</div>
    <div class="chips">${p.files.map((f) => `<span class="chip">${esc(f)}</span>`).join("")}<span class="chip">${p.packages} packages</span></div>
  </button>`;
}

function softwareTab() {
  const s = scan();
  let html = "";
  // Installed on this device.
  html += `<div class="group-title">Installed on this device</div>`;
  if (!s.local) html += `<div class="empty">This device wasn't part of the last scan.</div>`;
  else {
    const list = softwareFindings();
    const fails = failing(list).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
    const passed = list.filter((f) => f.status === "pass");
    if (fails.length) html += findingList(fails);
    if (passed.length) html += `<div class="passed passed-gap">${passed.map((f) => `<span>${ICON.check}${esc(f.summary)}</span>`).join("")}</div>`;
    const skipped = list.filter((f) => f.status === "skipped");
    if (skipped.length) html += `<div class="passed passed-gap">${skipped.map((f) => `<span>${esc(f.summary)}</span>`).join("")}</div>`;
  }
  // Code projects.
  html += `<div class="group-title">Code projects</div>`;
  if (!s.code) {
    html += `<div class="empty"><h3>Check the software you build</h3>
      <p>Bulwark finds the code projects in a folder (npm, pnpm, Yarn, pip, Poetry, uv, Pipenv, Cargo, Go, Bundler, Composer, NuGet, Gradle), checks every exact dependency version against the OSV.dev vulnerability database, and updates vulnerable ones with each project's own tool.</p>
      <button class="btn btn-primary" data-action="scan-dialog" data-code="1">${ICON.scan} Check my code projects</button></div>`;
    return html;
  }
  const code = s.code;
  if (!code.online) html += `<div class="banner banner-warn">${ICON.warn}<div><b>Couldn't reach osv.dev</b>The projects were found, but their dependencies couldn't be checked. Check the internet connection and scan again.</div></div>`;
  if (!code.projects.length) html += `<div class="empty">No lockfiles found in ${esc(code.roots.join(", "))}.</div>`;
  const projects = [...code.projects].sort((a, b) => worst(code.findings.filter((f) => inProject(f, a.path))) - worst(code.findings.filter((f) => inProject(f, b.path))) || a.name.localeCompare(b.name));
  html += `<div class="devices">`;
  for (const p of projects) {
    const list = code.findings.filter((f) => inProject(f, p.path));
    html += projectCard(p, list);
    if (S.device === `code:${p.path}`) {
      const fs = failing(list).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
      html += `<div class="device-detail">${fs.length ? findingList(fs) : `<div class="empty">No known vulnerabilities in ${p.packages} package versions.</div>`}</div>`;
    }
  }
  html += `</div>`;
  if (code.notes.length) html += `<div class="notes">${code.notes.map((n) => `<p>${esc(n)}</p>`).join("")}</div>`;
  return html;
}

function worst(list) {
  const f = failing(list).sort((a, b) => RANK[a.severity] - RANK[b.severity])[0];
  return f ? RANK[f.severity] : 9;
}

function deviceCard(d, list) {
  const c = counts(list);
  const open = S.device === d.ip;
  const title = d.name || (d.isSelf ? "This device" : d.kind);
  const sub = [d.ip, d.model || (d.name ? d.kind : ""), d.mac ? d.mac.toUpperCase() : ""].filter(Boolean).join(" · ");
  const chips = d.services.slice(0, 10).map((s) => `<span class="chip">${s.port} ${esc(s.name)}</span>`).join("");
  return `<button class="device" data-action="device" data-ip="${esc(d.ip)}" aria-expanded="${open}">
    <div class="device-top"><div class="device-icon">${ICON[KIND_ICON[d.kind] || "device"]}</div>
      <div class="sr-wrap"><div class="device-name">${esc(title)}${d.isGateway ? ` <span class="pill pill-muted">router</span>` : ""}</div><div class="device-sub">${esc(sub)}</div></div></div>
    <div class="counts">${countRow(c)}</div>
    ${chips ? `<div class="chips">${chips}</div>` : ""}
  </button>`;
}

function networkTab() {
  const s = scan();
  if (!s.network) {
    return `<div class="empty"><h3>Check the other devices on your network</h3>
      <p>Bulwark looks for devices on your network and checks each one for open doors: Telnet, unencrypted logins, old firmware with known vulnerabilities, databases without passwords, and port forwards your router opened by itself.</p>
      <button class="btn btn-primary" data-action="scan-dialog" data-network="1">${ICON.scan} Scan my network</button></div>`;
  }
  const net = s.network;
  const byIp = (ip) => net.findings.filter((f) => f.target === ip);
  const first = (d) => (d.isGateway ? 0 : d.kind === "Router" ? 1 : d.isSelf ? 2 : 3);
  const devices = [...net.devices].sort((a, b) => first(a) - first(b) || worst(byIp(a.ip)) - worst(byIp(b.ip)) || a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  let html = `<div class="devices">`;
  for (const d of devices) {
    html += deviceCard(d, byIp(d.ip));
    if (S.device === d.ip) {
      const fs = failing(byIp(d.ip)).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
      html += `<div class="device-detail">${fs.length ? findingList(fs) : `<div class="empty">No problems found on ${esc(d.ip)}.</div>`}</div>`;
    }
  }
  html += `</div>`;
  if (!devices.length) html = `<div class="empty"><h3>No devices answered</h3><p>Check that you're connected to the network you meant to scan.</p></div>`;
  if (net.notes.length) html += `<div class="notes">${net.notes.map((n) => `<p>${esc(n)}</p>`).join("")}</div>`;
  return html;
}

function historyTab() {
  const changes = S.data.changes || [];
  let html = `<div class="group-title">Changes Bulwark made</div>`;
  if (!changes.length) html += `<div class="empty">Nothing yet. Fixes you apply show up here, with an Undo button.</div>`;
  else {
    html += `<div class="list">${changes
      .map((c) => {
        const st = c.status === "applied" ? `<span class="pill pill-ok">Applied</span>` : c.status === "rolled-back" ? `<span class="pill pill-muted">Undone</span>` : `<span class="pill pill-bad">Failed</span>`;
        const how = c.error ? c.error : c.verification ? c.verification.summary : "";
        return `<div class="change"><div><div class="when">${esc(new Date(c.appliedAt).toLocaleString())}</div><div class="what">${esc(c.title)} ${st}</div>${how ? `<div class="how">${esc(how)}</div>` : ""}</div>
          <div>${c.status === "applied" && c.reversible ? `<button class="btn btn-sm" data-action="undo" data-change="${esc(c.id)}" ${S.job ? "disabled" : ""}>${ICON.undo} Undo</button>` : c.status === "applied" ? `<span class="pill pill-muted">Can't be undone</span>` : ""}</div></div>`;
      })
      .join("")}</div>`;
  }
  html += `<div class="group-title">Earlier scans</div>`;
  if (!S.scans) {
    html += `<div class="empty">Loading…</div>`;
    loadScans();
  } else if (!S.scans.length) html += `<div class="empty">No scans yet.</div>`;
  else {
    html += `<table class="scans"><thead><tr><th>When</th><th>This device</th><th>Network devices</th></tr></thead><tbody>${S.scans
      .slice(0, 20)
      .map((s) => `<tr><td>${esc(new Date(s.startedAt).toLocaleString())}</td><td>${s.local ? `${s.scores.local}/100` : "–"}</td><td>${s.devices || "–"}</td></tr>`)
      .join("")}</tbody></table>`;
  }
  return html;
}

let loadingScans = false;
async function loadScans() {
  if (loadingScans) return;
  loadingScans = true;
  try {
    S.scans = await api("/api/scans");
  } catch {
    S.scans = [];
  }
  loadingScans = false;
  render();
}

function keyScreen() {
  return `<main><div class="empty"><h3>Open Bulwark with its link</h3>
    <p>For safety, the dashboard only works with the private link Bulwark printed in the terminal when it started (it ends in <code>#key=…</code>). Open that link, or start the dashboard again with <code>./bulwark serve</code>.</p></div></main>`;
}

function render() {
  const app = document.getElementById("app");
  if (!key || S.authFailed) {
    app.innerHTML = keyScreen();
    return;
  }
  if (!S.data) {
    app.innerHTML = `<div class="boot">Loading…</div>`;
    return;
  }
  const body = !scan() ? welcome() : overview() + tabs() + (S.tab === "network" ? networkTab() : S.tab === "software" ? softwareTab() : S.tab === "history" ? historyTab() : deviceTab());
  app.innerHTML = topBar() + `<main>${banners()}${body}</main>`;
  renderProgress();
  renderModal();
}

// ── progress, toasts ──

function renderProgress() {
  let el = document.getElementById("progress");
  if (!S.job) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = "progress";
    el.className = "progress";
    document.body.appendChild(el);
  }
  const p = S.job.progress;
  const pct = p && p.total > 1 ? Math.round((p.done / p.total) * 100) : null;
  const label = { scan: "Scanning", fix: "Applying the fix", "fix-all": "Applying fixes", rollback: "Undoing" }[S.job.kind] || "Working";
  el.innerHTML = `<div class="msg"><span class="spin"></span>${esc(p && p.message ? p.message : label + "…")}</div><div class="bar ${pct === null ? "indeterminate" : ""}"><i></i></div>`;
  if (pct !== null) el.querySelector(".bar > i").style.width = `${pct}%`;
}

function toast(text, kind = "") {
  const box = document.getElementById("toasts");
  const t = document.createElement("div");
  t.className = `toast ${kind ? `toast-${kind}` : ""}`;
  t.textContent = text;
  box.appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

async function watchJob(jobId, kind) {
  S.job = { id: jobId, kind, progress: null };
  render();
  for (;;) {
    await sleep(600);
    let j;
    try {
      j = await api(`/api/jobs/${jobId}`);
    } catch (err) {
      S.job = null;
      render();
      throw err;
    }
    S.job.progress = j.progress;
    renderProgress();
    if (j.status !== "running") {
      S.job = null;
      return j;
    }
  }
}

async function refresh() {
  S.data = await api("/api/state");
  S.scans = null;
  render();
}

// ── modals ──

function modalFrame(title, body, foot, wide = false) {
  return `<div class="overlay" data-action="overlay"><div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-head"><h2 id="modal-title">${title}</h2><button class="btn btn-ghost btn-sm" data-action="close" aria-label="Close">${ICON.x}</button></div>
    <div class="modal-body">${body}</div><div class="modal-foot">${foot}</div></div></div>`;
}

function diffHtml(detail) {
  return detail
    .split("\n")
    .map((l) => {
      const cls = l.startsWith("+++") || l.startsWith("---") || l.startsWith("@@") ? "meta" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "";
      return `<span class="${cls}">${esc(l)}</span>`;
    })
    .join("\n");
}

function planBody(plan) {
  const kinds = { file: "File", command: "Command", permission: "Permissions", network: "Router", note: "Note" };
  let html = `<div class="counts">
    ${plan.risk === "caution" ? `<span class="pill pill-warn">${ICON.warn} Needs care</span>` : `<span class="pill pill-ok">Low risk</span>`}
    ${plan.reversible ? `<span class="pill pill-muted">${ICON.undo} Can be undone</span>` : `<span class="pill pill-warn">Can't be undone</span>`}
    ${plan.needsRoot ? `<span class="pill pill-muted">Needs admin</span>` : ""}</div>`;
  if (plan.warnings.length) html += `<h4 class="group-title">Good to know</h4><ul class="checklist">${plan.warnings.map((w) => `<li><span class="warn-ico">${ICON.warn}</span><span>${esc(w)}</span></li>`).join("")}</ul>`;
  if (plan.preconditions.length) html += `<h4 class="group-title">Checked first</h4><ul class="checklist">${plan.preconditions.map((p) => `<li><span class="${p.ok ? "ok-ico" : "bad-ico"}">${p.ok ? ICON.check : ICON.x}</span><span>${esc(p.message)}</span></li>`).join("")}</ul>`;
  html += `<h4 class="group-title">What will change</h4>`;
  html += plan.steps.length
    ? plan.steps.map((s, i) => `<div class="step"><div class="step-title"><span class="step-kind">${kinds[s.kind] || s.kind}</span>${i + 1}. ${esc(s.title)}</div>${s.detail ? `<pre class="detail">${s.kind === "file" ? diffHtml(s.detail) : esc(s.detail)}</pre>` : ""}</div>`).join("")
    : `<p>Nothing needs to change.</p>`;
  if (!plan.canApply) html += `<div class="callout callout-bad"><b>Can't apply this yet.</b> ${esc(plan.blockedReason || "")}</div>`;
  return html;
}

function renderModal() {
  const root = document.getElementById("modal-root");
  const m = S.modal;
  if (!m) {
    root.innerHTML = "";
    return;
  }
  const focusFirst = !root.innerHTML;
  if (m.type === "scan") {
    const net = S.data.network;
    const targets = m.targets ?? net.targets.join(", ");
    const typed = targets.split(/[\s,]+/).filter(Boolean);
    const publicTyped = typed.some((t) => /^\d+\.\d+\.\d+\.\d+/.test(t) && !/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(t));
    const needsConfirm = m.network && !(typed.join(",") === net.targets.join(",") && net.targets.every((t) => net.confirmed.includes(t)));
    if (S.data.demo) {
      root.innerHTML = modalFrame("Scan the demo network", `<p>Bulwark checks the pretend devices again (${esc(net.targets.join(", "))}).</p>${m.error ? `<div class="callout callout-bad">${esc(m.error)}</div>` : ""}`, `<button class="btn" data-action="close">Cancel</button><button class="btn btn-primary" data-action="scan-start">${ICON.scan} Start scan</button>`);
      return;
    }
    const body = `
      <div class="field"><label><input type="checkbox" name="local" ${m.local ? "checked" : ""}><span><b>This device</b><div class="hint">Settings, accounts, services and installed software: updates, firewall, SSH, outdated apps and runtimes. About 20 seconds.</div></span></label></div>
      <div class="field"><label><input type="checkbox" name="code" ${m.code ? "checked" : ""}><span><b>Code projects</b><div class="hint">Finds projects in a folder and checks their dependencies for known vulnerabilities.</div></span></label></div>
      ${m.code ? `<div class="sub-field"><div class="field"><input type="text" name="codeRoots" value="${esc(m.codeRoots ?? S.data.code.defaultRoots.join(", "))}" placeholder="~/code" aria-label="Folders to look in" spellcheck="false">
        <div class="hint">Package names and versions are looked up on osv.dev. Nothing else leaves this computer.</div></div></div>` : ""}
      <div class="field"><label><input type="checkbox" name="network" ${m.network ? "checked" : ""}><span><b>Other devices on my network</b><div class="hint">Finds devices and checks each one's open services. Doesn't log in or try passwords. About a minute.</div></span></label></div>
      ${m.network ? `<div class="sub-field">
        <div class="field"><input type="text" name="targets" value="${esc(targets)}" placeholder="192.168.1.0/24" aria-label="Addresses to scan" spellcheck="false">
          <div class="hint">${net.targets.length ? "Your network, as Bulwark sees it." : "Enter a network (192.168.1.0/24), a range (192.168.1.10-50) or addresses."}${net.skipped.length ? ` ${esc(net.skipped.join(" "))}` : ""}</div></div>
        ${needsConfirm ? `<div class="field"><label><input type="checkbox" name="own" ${m.own ? "checked" : ""}><span>This is my network, or I have permission to scan it.<div class="hint">Scanning networks you don't own (a café, a hotel, an employer without IT's OK) can be against the rules or the law.</div></span></label></div>` : ""}
        ${publicTyped ? `<div class="field"><label><input type="checkbox" name="authorized" ${m.authorized ? "checked" : ""}><span>Some of these are public internet addresses. I own them or have written permission to test them.</span></label></div>` : ""}
      </div>` : ""}
      ${m.error ? `<div class="callout callout-bad">${esc(m.error)}</div>` : ""}`;
    const ready = (m.local || m.network || m.code) && (!m.network || !needsConfirm || m.own) && (!publicTyped || m.authorized);
    root.innerHTML = modalFrame("Scan", body, `<button class="btn" data-action="close">Cancel</button><button class="btn btn-primary" data-action="scan-start" ${ready ? "" : "disabled"}>${ICON.scan} Start scan</button>`);
  } else if (m.type === "plan") {
    const body = m.error ? `<div class="callout callout-bad">${esc(m.error)}</div>` : m.alreadyFixed ? `<div class="callout callout-ok">This is already fixed. Scan again to update the list.</div>` : !m.plan ? `<p><span class="spin"></span> Working out exactly what would change…</p>` : planBody(m.plan);
    const p = m.plan;
    const cli = p && !p.canApply && p.needsRoot && !S.data.device.isRoot ? `<span class="hint">Or in a terminal: <code>sudo ./bulwark fix ${esc(m.ids[0])}</code></span>` : "";
    const foot = `<div class="left">${cli}</div><button class="btn" data-action="close">Cancel</button>${p && p.canApply ? `<button class="btn ${p.risk === "caution" ? "btn-danger" : "btn-primary"}" data-action="apply">${ICON.wand} Apply this fix</button>` : ""}`;
    root.innerHTML = modalFrame(esc(p ? p.title : "Review the fix"), body, foot);
  } else if (m.type === "result") {
    const c = m.change;
    let body;
    if (m.alreadyFixed) body = `<div class="callout callout-ok">It was already fixed.</div>`;
    else if (c.status === "applied") body = `<div class="callout ${c.verification && c.verification.status === "pass" ? "callout-ok" : "callout-warn"}"><b>Applied.</b> ${esc(c.verification ? c.verification.summary : "")}</div>${c.reversible ? `<p>Changed your mind? Undo it from the History tab, or with <code>bulwark rollback ${esc(c.id)}</code>.</p>` : ""}`;
    else body = `<div class="callout callout-bad"><b>The fix didn't work.</b> ${esc(c.error || "")}</div><p>${c.status === "rolled-back" ? "Everything was put back the way it was." : "Some steps couldn't be undone. Details are in the History tab."}</p>`;
    if (c && c.log && c.log.length) body += `<h4 class="group-title">Log</h4><pre class="evidence">${esc(c.log.join("\n"))}</pre>`;
    root.innerHTML = modalFrame(esc(c ? c.title : "Done"), body, `<button class="btn btn-primary" data-action="close">Done</button>`);
  } else if (m.type === "fix-all") {
    const list = m.items.map((f) => `<li>${sevBadge(f.severity)} ${esc(f.title)}</li>`).join("");
    root.innerHTML = modalFrame(
      `Fix ${plural(m.items.length, "low-risk issue")}`,
      `<p>These fixes are low risk: they tighten settings without changing how you log in or blocking services you use. Each one becomes its own entry in History, so you can undo any of them.</p><ul class="checklist">${list}</ul>`,
      `<button class="btn" data-action="close">Cancel</button><button class="btn btn-primary" data-action="fix-all-start">${ICON.wand} Fix them</button>`,
    );
  } else if (m.type === "fix-all-result") {
    const rows = m.results.map((r) => (r.skipped ? `<li><span class="warn-ico">${ICON.warn}</span><span>${esc(r.title)}: ${esc(r.skipped)}</span></li>` : `<li><span class="${r.status === "applied" ? "ok-ico" : "bad-ico"}">${r.status === "applied" ? ICON.check : ICON.x}</span><span>${esc(r.title)}${r.error ? `: ${esc(r.error)}` : ""}</span></li>`)).join("");
    root.innerHTML = modalFrame("Done", `<ul class="checklist">${rows || "<li>Nothing needed fixing.</li>"}</ul><p>Run a new scan to see your updated score.</p>`, `<button class="btn" data-action="close">Close</button><button class="btn btn-primary" data-action="scan-again">${ICON.scan} Scan again</button>`);
  } else if (m.type === "undo") {
    const c = (S.data.changes || []).find((x) => x.id === m.changeId);
    root.innerHTML = modalFrame(
      "Undo this change?",
      `<p><b>${esc(c ? c.title : m.changeId)}</b></p><p>Bulwark puts back the files, permissions and settings exactly as they were before this fix.</p>${m.error ? `<div class="callout callout-bad">${esc(m.error)}</div>` : ""}`,
      `<button class="btn" data-action="close">Cancel</button><button class="btn btn-primary" data-action="undo-start">${ICON.undo} Undo</button>`,
    );
  }
  if (focusFirst) {
    const first = root.querySelector(".modal-foot .btn-primary, .modal-foot .btn-danger, .modal-foot .btn");
    if (first) first.focus();
  }
}

// ── actions ──

async function openPlan(ids) {
  S.modal = { type: "plan", ids };
  renderModal();
  try {
    const r = await api("/api/plan", { findingIds: ids });
    if (S.modal && S.modal.type === "plan") {
      if (r.alreadyFixed) S.modal.alreadyFixed = true;
      else S.modal.plan = r;
    }
  } catch (err) {
    if (S.modal) S.modal.error = err.message;
  }
  renderModal();
}

async function applyPlan() {
  const ids = S.modal.ids;
  const title = S.modal.plan && S.modal.plan.title;
  S.modal = null;
  renderModal();
  try {
    const { jobId } = await api("/api/fix", { findingIds: ids });
    const j = await watchJob(jobId, "fix");
    if (j.status === "error") throw new Error(j.error);
    S.modal = j.result.alreadyFixed ? { type: "result", alreadyFixed: true, change: { title } } : { type: "result", change: j.result };
    await refresh();
  } catch (err) {
    toast(err.message, "bad");
    render();
  }
}

async function startScan() {
  const m = S.modal;
  const targets = m.network ? (m.targets ?? S.data.network.targets.join(", ")).split(/[\s,]+/).filter(Boolean) : [];
  try {
    const codeRoots = m.code ? (m.codeRoots ?? S.data.code.defaultRoots.join(", ")).split(",").map((r) => r.trim()).filter(Boolean) : undefined;
    const { jobId } = await api("/api/scan", { local: !!m.local, code: !!m.code, codeRoots, network: !!m.network, targets: m.targets === undefined ? undefined : targets, confirmOwnership: !!m.own, authorized: !!m.authorized });
    S.modal = null;
    const j = await watchJob(jobId, "scan");
    if (j.status === "error") throw new Error(j.error);
    S.tab = m.local ? (S.tab === "history" ? "device" : S.tab) : m.code && !m.network ? "software" : m.network ? "network" : S.tab;
    S.open.clear();
    await refresh();
    const s = scan();
    const n = failing(everyFinding()).length;
    toast(n ? `Scan finished: ${plural(n, "problem")} found.` : "Scan finished: no problems found.", n ? "" : "ok");
    if (!s) render();
  } catch (err) {
    if (S.modal && S.modal.type === "scan") {
      S.modal.error = err.message;
      renderModal();
    } else toast(err.message, "bad");
  }
}

async function fixAll() {
  S.modal = null;
  renderModal();
  try {
    const { jobId } = await api("/api/fix-all-safe", {});
    const j = await watchJob(jobId, "fix-all");
    if (j.status === "error") throw new Error(j.error);
    S.modal = { type: "fix-all-result", results: j.result.results };
    await refresh();
  } catch (err) {
    toast(err.message, "bad");
    render();
  }
}

async function undo(changeId) {
  try {
    const { jobId } = await api("/api/rollback", { changeId });
    S.modal = null;
    const j = await watchJob(jobId, "rollback");
    if (j.status === "error") throw new Error(j.error);
    toast("Undone. Everything is back the way it was.", "ok");
    await refresh();
  } catch (err) {
    if (S.modal && S.modal.type === "undo") {
      S.modal.error = err.message;
      renderModal();
    } else toast(err.message, "bad");
    render();
  }
}

async function downloadReport() {
  try {
    const res = await fetch("/api/report", { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error("Couldn't build the report.");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bulwark-report-${scan().id}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (err) {
    toast(err.message, "bad");
  }
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  if (a === "overlay" && e.target !== el) return;
  switch (a) {
    case "toggle":
      S.open.has(el.dataset.id) ? S.open.delete(el.dataset.id) : S.open.add(el.dataset.id);
      render();
      break;
    case "tab":
      S.tab = el.dataset.tab;
      render();
      break;
    case "device":
      S.device = S.device === el.dataset.ip ? null : el.dataset.ip;
      render();
      break;
    case "scan-dialog": {
      const hasNet = !!(scan() && scan().network);
      const hasCode = !!(scan() && scan().code);
      const only = el.dataset.network || el.dataset.code;
      S.modal = { type: "scan", local: !only, code: !!el.dataset.code || (!only && hasCode), network: !!el.dataset.network || (!only && hasNet) };
      renderModal();
      break;
    }
    case "scan-start":
      startScan();
      break;
    case "scan-again":
      S.modal = { type: "scan", local: true, code: !!(scan() && scan().code), network: !!(scan() && scan().network) };
      renderModal();
      break;
    case "plan":
      openPlan(el.dataset.ids.split(","));
      break;
    case "apply":
      applyPlan();
      break;
    case "fix-all":
      S.modal = { type: "fix-all", items: safeFixable(everyFinding()) };
      renderModal();
      break;
    case "fix-all-start":
      fixAll();
      break;
    case "undo":
      S.modal = { type: "undo", changeId: el.dataset.change };
      renderModal();
      break;
    case "undo-start":
      undo(S.modal.changeId);
      break;
    case "copy":
      navigator.clipboard?.writeText(el.dataset.text).then(() => toast("Copied.", "ok"), () => toast("Couldn't copy.", "bad"));
      break;
    case "report":
      downloadReport();
      break;
    case "close":
    case "overlay":
      S.modal = null;
      renderModal();
      break;
  }
});

document.addEventListener("input", (e) => {
  const m = S.modal;
  if (!m || m.type !== "scan") return;
  const t = e.target;
  if (t.name === "targets" || t.name === "codeRoots") {
    m[t.name] = t.value;
    // Re-render without losing the caret.
    const pos = t.selectionStart;
    renderModal();
    const again = document.querySelector(`input[name="${t.name}"]`);
    if (again) {
      again.focus();
      again.setSelectionRange(pos, pos);
    }
    return;
  }
  if (["local", "code", "network", "own", "authorized"].includes(t.name)) {
    m[t.name] = t.checked;
    renderModal();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.modal) {
    S.modal = null;
    renderModal();
  }
});

(async function start() {
  render();
  if (!key) return;
  try {
    await refresh();
  } catch (err) {
    if (!S.authFailed) document.getElementById("app").innerHTML = `<main><div class="empty"><h3>Couldn't reach Bulwark</h3><p>${esc(err.message)}</p></div></main>`;
  }
})();
