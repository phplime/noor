/**
 * Whitelist HTML sanitizer for notes. Only simple formatting survives; every
 * attribute except a few safe ones is removed, so pasted or stored content can
 * never run script, load remote resources or restyle the app.
 */
const ALLOWED = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'MARK', 'A', 'HR', 'SPAN']);
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'SVG', 'MATH', 'NOSCRIPT', 'LINK', 'META', 'HEAD', 'TITLE', 'IMG', 'VIDEO', 'AUDIO', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT']);

function cleanNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (DROP_WITH_CONTENT.has(tag)) return null;
  const children = Array.from(el.childNodes)
    .map((c) => cleanNode(c, doc))
    .filter((c): c is Node => c !== null);
  if (!ALLOWED.has(tag)) {
    // Unknown wrapper: keep its text/children, drop the element itself.
    const frag = doc.createDocumentFragment();
    children.forEach((c) => frag.appendChild(c));
    return frag;
  }
  const out = doc.createElement(tag === 'STRIKE' || tag === 'DEL' ? 's' : tag.toLowerCase());
  if (tag === 'A') {
    const href = el.getAttribute('href') ?? '';
    if (/^(https?:|mailto:)/i.test(href.trim())) {
      out.setAttribute('href', href.trim());
      out.setAttribute('rel', 'noopener noreferrer');
      out.setAttribute('target', '_blank');
    }
  }
  if (tag === 'UL' && el.classList.contains('checklist')) out.setAttribute('class', 'checklist');
  if (tag === 'LI' && el.getAttribute('data-checked') === 'true') out.setAttribute('data-checked', 'true');
  if (tag === 'SPAN' && el.classList.contains('hl')) out.setAttribute('class', 'hl');
  children.forEach((c) => out.appendChild(c));
  return out;
}

/** Parse into an inert <template>: nothing in it loads or runs. */
function inert(html: string): DocumentFragment {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content;
}

export function sanitizeHtml(html: string): string {
  const doc = document;
  const out = doc.createElement('div');
  Array.from(inert(html).childNodes).forEach((n) => {
    const c = cleanNode(n, doc);
    if (c) out.appendChild(c);
  });
  return out.innerHTML;
}

/** Plain text of a note's HTML (for titles, search and "copy as text"). */
export function htmlToText(html: string): string {
  const frag = inert(sanitizeHtml(html).replace(/<(br|\/p|\/div|\/li|\/h[1-3]|\/blockquote|\/pre)>/gi, '$&\n'));
  return (frag.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

export function noteTitle(html: string): string {
  const first = htmlToText(html).split('\n').find((l) => l.trim()) ?? '';
  return first.trim().slice(0, 80) || 'New note';
}
