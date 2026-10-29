// ════════════════════════════════════════════════════════════════
// src/parse/xml.mjs — the XML inside DOCX and XLSX, read only ever inside the sandbox (claim L2b).
//
// A deliberately small, non-validating reader: elements, attributes, text, CDATA, comments, processing instructions.
// A document type declaration is REFUSED, so no entity is ever defined or expanded (the billion-laughs and external
// entity tricks have nothing to stand on); only the five predefined entities and numeric character references are
// decoded. Depth and size are capped.
//
//   tree(text, caps?) → { ok, root } | { ok: false, why }   node = { name, attrs: { name: value }, kids: [node | text] }
//       caps { text, nodes, depth } lowers the caps (the tests check each cap at its exact edge with small ones); the
//       office reads with the defaults
//   walk(node, fn)        every element, depth first;  textIn(node) → the text under a node
// Pure and total.
// ════════════════════════════════════════════════════════════════

export const MAX_DEPTH = 256, MAX_TEXT = 64 << 20, MAX_NODES = 2000000;
const no = (why) => ({ ok: false, why });
const capOf = (c, k, d) => { try { const x = c[k]; return Number.isSafeInteger(x) && x > 0 ? x : d; } catch { return d; } };
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decode(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&(#x[0-9A-Fa-f]{1,6}|#[0-9]{1,7}|[A-Za-z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '�';
    }
    return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
  });
}

export function tree(text, caps) {
  const c = Object(caps);
  const maxText = capOf(c, 'text', MAX_TEXT), maxNodes = capOf(c, 'nodes', MAX_NODES), maxDepth = capOf(c, 'depth', MAX_DEPTH);
  if (typeof text !== 'string' || text.length > maxText) return no('XML is text of at most ' + maxText + ' characters');
  const root = { name: '#document', attrs: {}, kids: [] };
  const stack = [root];
  let i = 0, nodes = 0;
  for (;;) {   // every pass moves i on, or ends
    const lt = text.indexOf('<', i);
    if (lt === -1) { const t = text.slice(i); if (t.trim()) stack[stack.length - 1].kids.push(decode(t)); break; }
    if (lt > i) { const t = text.slice(i, lt); if (stack.length > 1) stack[stack.length - 1].kids.push(decode(t)); }
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt + 4); if (e === -1) return no('a comment never ends'); i = e + 3; continue; }
    if (text.startsWith('<![CDATA[', lt)) { const e = text.indexOf(']]>', lt + 9); if (e === -1) return no('a CDATA section never ends'); stack[stack.length - 1].kids.push(text.slice(lt + 9, e)); i = e + 3; continue; }
    if (text.startsWith('<!', lt)) return no('a document type declaration is refused: no entities are ever defined');
    if (text.startsWith('<?', lt)) { const e = text.indexOf('?>', lt + 2); if (e === -1) return no('a processing instruction never ends'); i = e + 2; continue; }
    const gt = text.indexOf('>', lt + 1);
    if (gt === -1) return no('a tag never ends');
    const body = text.slice(lt + 1, gt);
    if (body[0] === '/') {
      const name = body.slice(1).trim();
      const top = stack.pop();
      if (!top || top.name !== name || stack.length === 0) return no('a closing tag </' + name.slice(0, 40) + '> does not match');
      i = gt + 1; continue;
    }
    const selfClose = body.endsWith('/');
    const m = /^([A-Za-z_][\w.:-]*)/.exec(body);
    if (!m) return no('a tag has no name');
    const node = { name: m[1], attrs: {}, kids: [] };
    const re = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a;
    const rest = body.slice(m[1].length, selfClose ? -1 : undefined);
    while ((a = re.exec(rest))) node.attrs[a[1]] = decode(a[3] !== undefined ? a[3] : a[4]);
    if (++nodes > maxNodes) return no('more than ' + maxNodes + ' elements');
    stack[stack.length - 1].kids.push(node);
    if (!selfClose) { stack.push(node); if (stack.length - 1 > maxDepth) return no('nested deeper than ' + maxDepth); }
    i = gt + 1;
  }
  if (stack.length !== 1) return no('an element never closes');
  return { ok: true, root };
}

export function walk(node, fn) {
  if (typeof fn !== 'function') return;
  const todo = [node];
  while (todo.length) {
    const n = todo.pop();
    if (!n || typeof n !== 'object' || !Array.isArray(n.kids)) continue;
    fn(n);
    for (const k of [...n.kids].reverse()) todo.push(k);   // text and anything else is passed over above
  }
}

export function textIn(node) {
  let s = '';
  const go = (n) => { if (!Array.isArray(n.kids)) throw new TypeError('not a node'); for (const k of n.kids) { if (typeof k === 'string') s += k; else go(k); } };   // never s += go(): s would be read before the recursion adds to it
  try { go(node); } catch { return ''; }
  return s;
}

export const local = (name) => (typeof name === 'string' ? name.replace(/^.*:/, '') : '');
