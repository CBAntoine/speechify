// A tolerant little XML reader: enough for UPnP descriptions, SOAP replies, DIDL-Lite and Roku ECP.
// Elements are { name, local, attrs, children, text }. Namespace prefixes are kept in `name`
// and stripped in `local`, so lookups work whatever prefix a device chose.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
}

const localName = (n) => n.slice(n.indexOf(":") + 1);

export function parseXml(input) {
  const src = String(input);
  const root = { name: "#root", local: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) {
      stack[stack.length - 1].text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1].text += decodeEntities(src.slice(i, lt));
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      stack[stack.length - 1].text += src.slice(lt + 9, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src[lt + 1] === "?" || src[lt + 1] === "!") {
      const end = src.indexOf(">", lt);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    const gt = findTagEnd(src, lt);
    if (gt === -1) break;
    const raw = src.slice(lt + 1, gt);
    i = gt + 1;
    if (raw[0] === "/") {
      const name = raw.slice(1).trim();
      // Pop to the matching element; tolerate stray close tags.
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const m = body.match(/^\s*([^\s/>]+)/);
    if (!m) continue;
    const name = m[1];
    const attrs = {};
    for (const a of body.slice(m[0].length).matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[a[1]] = decodeEntities(a[2] ?? a[3]);
      attrs[localName(a[1])] ??= attrs[a[1]];
    }
    const el = { name, local: localName(name), attrs, children: [], text: "" };
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) stack.push(el);
  }
  return root;
}

function findTagEnd(src, from) {
  let q = null;
  for (let i = from + 1; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === ">") return i;
  }
  return -1;
}

/** Depth-first search for elements whose local name matches. */
export function findAll(node, local, out = []) {
  if (!node) return out;
  for (const c of node.children) {
    if (c.local === local) out.push(c);
    findAll(c, local, out);
  }
  return out;
}

export const findFirst = (node, local) => {
  if (!node) return null;
  for (const c of node.children) {
    if (c.local === local) return c;
    const f = findFirst(c, local);
    if (f) return f;
  }
  return null;
};

/** Direct children only. */
export const child = (node, local) => node?.children.find((c) => c.local === local) ?? null;
export const childText = (node, local) => {
  const c = child(node, local);
  return c ? c.text.trim() : null;
};
export const textOf = (node, local) => {
  const c = findFirst(node, local);
  return c ? c.text.trim() : null;
};
