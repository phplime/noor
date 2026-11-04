// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { htmlToText, noteTitle, sanitizeHtml } from '../src/kit/utils/sanitize';

describe('notes sanitizer', () => {
  it('keeps basic formatting and emoji', () => {
    const html = '<h1>Plan 🚀</h1><p><b>bold</b> <i>it</i> <u>u</u> <s>x</s></p><ul class="checklist"><li data-checked="true">done ✅</li><li>todo</li></ul>';
    expect(sanitizeHtml(html)).toBe(html);
  });
  it('removes scripts, handlers, styles and remote resources', () => {
    const dirty = '<p onclick="alert(1)" style="color:red">hi<script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://evil"></iframe></p><a href="javascript:alert(1)">x</a>';
    const clean = sanitizeHtml(dirty);
    expect(clean).toBe('<p>hi</p><a>x</a>');
  });
  it('keeps safe links only', () => {
    expect(sanitizeHtml('<a href="https://example.com">e</a>')).toContain('href="https://example.com"');
    expect(sanitizeHtml('<a href="file:///etc/passwd">f</a>')).toBe('<a>f</a>');
  });
  it('unwraps unknown elements but keeps their text', () => {
    expect(sanitizeHtml('<section><font color="red">text</font></section>')).toBe('text');
  });
  it('derives titles and text', () => {
    expect(noteTitle('<h1>Groceries 🛒</h1><p>milk</p>')).toBe('Groceries 🛒');
    expect(noteTitle('')).toBe('New note');
    expect(htmlToText('<p>a</p><p>b</p>')).toBe('a\nb');
  });
});
