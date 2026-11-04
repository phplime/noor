"""Arabic (fully vowelled Uthmani) → Bangla pronunciation (উচ্চারণ).

Rule based: vowels, long vowels, shadda, tanween, sun letters, alif wasla,
joining across words, and pausing at the end of an ayah. It follows the usual
Bangla convention (বিসমিল্লাহির রাহমানির রাহীম). It is a reading aid, not a
replacement for learning tajweed from a teacher.
"""
import re
import unicodedata

FATHA, DAMMA, KASRA = 'َ', 'ُ', 'ِ'
FATHATAN, DAMMATAN, KASRATAN = 'ً', 'ٌ', 'ٍ'
# Open tanween (Tanzil: U+08F0..2; the KFGQPC text uses U+0657/065E/0656).
OPEN_TAN = {'\u08f0': FATHATAN, '\u08f1': DAMMATAN, '\u08f2': KASRATAN, '\u0657': FATHATAN, '\u065e': DAMMATAN, '\u0656': KASRATAN}
SHADDA = 'ّ'
SUKUN = {'\u06e1'}
SUPER_ALIF = 'ٰ'
MADDA = 'ٓ'
SMALL_WAW = 'ۥ'
SMALL_YEH = 'ۦ'
# Silent letter: small rounded zero (U+06DF); U+06E0 in the KFGQPC text.
SILENT = {'\u06df', '\u06e0', '\u0652'}  # U+0652 marks a silent letter in this text (كَفَرُواْ)
SMALL_HIGH_YEH = '\u06e7'
SMALL_HIGH_NOON = '\u06e8'
IQLAB = {'ۢ', 'ۭ'}
HAMZA_MARKS = {'ٔ', 'ٕ'}
WASLA = 'ٱ'
TATWEEL = 'ـ'

CONS = {
    'ب': 'ব', 'ت': 'ত', 'ث': 'ছ', 'ج': 'জ', 'ح': 'হ', 'خ': 'খ', 'د': 'দ', 'ذ': 'য',
    'ر': 'র', 'ز': 'য', 'س': 'স', 'ش': 'শ', 'ص': 'স', 'ض': 'দ', 'ط': 'ত', 'ظ': 'য',
    'غ': 'গ', 'ف': 'ফ', 'ق': 'ক', 'ك': 'ক', 'ل': 'ল', 'م': 'ম', 'ن': 'ন', 'ه': 'হ',
    'ة': 'ত',
}
GLOTTAL = {'ء', 'أ', 'إ', 'ؤ', 'ئ', 'ع', 'آ'}
SUN = set('تثدذرزسشصضطظلن')
DIGRAPH_VOWEL = {FATHA: 'া', KASRA: 'ি', DAMMA: 'ু'}
LONG_SIGN = {FATHA: 'া', KASRA: 'ী', DAMMA: 'ূ'}
INDEP = {FATHA: 'আ', KASRA: 'ই', DAMMA: 'উ'}
INDEP_LONG = {FATHA: 'আ', KASRA: 'ঈ', DAMMA: 'ঊ'}
HASANT = '্'


class Unit:
    __slots__ = ('ch', 'marks')

    def __init__(self, ch):
        self.ch = ch
        self.marks = []

    @property
    def vowel(self):
        for m in self.marks:
            if m in (FATHA, KASRA, DAMMA):
                return m
        return None

    @property
    def tanween(self):
        for m in self.marks:
            if m in (FATHATAN, DAMMATAN, KASRATAN):
                return m
        return None

    @property
    def shadda(self):
        return SHADDA in self.marks

    @property
    def sukun(self):
        return any(m in SUKUN for m in self.marks)

    @property
    def silent(self):
        return any(m in SILENT for m in self.marks)

    @property
    def bare(self):
        return self.vowel is None and self.tanween is None and not self.sukun and not self.shadda


def units(word):
    out = []
    for ch in word:
        if unicodedata.combining(ch) or ch in OPEN_TAN or ch in (SUPER_ALIF, SMALL_WAW, SMALL_YEH, SMALL_HIGH_YEH, SMALL_HIGH_NOON) or ch in SILENT or ch in IQLAB:
            ch = OPEN_TAN.get(ch, ch)
            if not out:
                out.append(Unit(TATWEEL))
            out[-1].marks.append(ch)
        elif 'ۖ' <= ch <= 'ۭ' or ch in '۞۩':
            continue  # pause signs and ornaments
        else:
            out.append(Unit(ch))
    return out


def word_tr(us, first_in_ayah, last_in_ayah):
    """Transliterate one word. Returns (text, starts_with_wasla_kind)."""
    s = []
    i = 0
    n = len(us)
    prev_vowel = None  # vowel sound the last syllable ended with
    short_end = [-1]  # position just after the last short vowel written

    def cons(u):
        return CONS.get(u.ch)

    while i < n:
        u = us[i]
        c = u.ch
        if u.silent:
            i += 1
            continue
        if c == TATWEEL:
            if any(m in HAMZA_MARKS for m in u.marks):
                c = 'ء'  # hamza written on a tatweel: treat as a glottal stop below
            else:
                if SUPER_ALIF in u.marks and prev_vowel != FATHA:
                    s.append('া')
                    prev_vowel = FATHA
                if SMALL_HIGH_YEH in u.marks and s and s[-1] == 'ি':
                    s[-1] = 'ী'
                if SMALL_HIGH_NOON in u.marks:
                    s.append('ন')
                i += 1
                continue
        if c == WASLA:
            # inside a word (wa-l…, bi-l…): the article's lam is silent before a doubled sun letter
            if i + 2 < n and us[i + 1].ch == 'ل' and us[i + 1].bare and us[i + 2].shadda:
                i += 2
            else:
                i += 1
            continue
        if c in ('ا', 'ى') and not u.vowel and not u.tanween:
            # lengthening alif / alif maqsura
            if SUPER_ALIF in u.marks and prev_vowel != FATHA:
                s.append('া')
            elif c == 'ى' and prev_vowel == KASRA:
                if s and s[-1] == 'ি':
                    s[-1] = 'ী'
            i += 1
            continue
        if c in GLOTTAL or c == 'ء' or (c == 'ا' and (u.vowel or u.tanween)):
            v = u.vowel
            nxt = us[i + 1] if i + 1 < n else None
            long_ = (v == FATHA and (c == 'آ' or (nxt and nxt.ch in ('ا', 'ى') and nxt.bare))) or \
                    (v == KASRA and nxt and nxt.ch == 'ي' and nxt.bare) or \
                    (v == DAMMA and nxt and nxt.ch == 'و' and nxt.bare) or SUPER_ALIF in u.marks
            if c == 'آ' and not v:
                s.append('আ')
                prev_vowel = FATHA
            elif v:
                s.append((INDEP_LONG if long_ else INDEP)[v])
                prev_vowel = v
                if long_ and nxt and nxt.ch in ('ي', 'و') and nxt.bare:
                    i += 1
            elif u.tanween:
                t = u.tanween
                s.append(INDEP[{FATHATAN: FATHA, KASRATAN: KASRA, DAMMATAN: DAMMA}[t]])
                if not last_in_ayah:
                    s.append('ন')
            elif u.sukun or u.bare:
                if s:
                    s.append('\'')
            i += 1
            continue

        # waw and yaa: consonant or long vowel
        if c in ('و', 'ي'):
            if (u.bare or u.sukun) and not u.shadda:
                if c == 'و':
                    if prev_vowel == DAMMA and u.bare:
                        if s and s[-1] == 'ু':
                            s[-1] = 'ূ'
                        elif s and s[-1] == 'উ':
                            s[-1] = 'ঊ'
                    elif prev_vowel == FATHA:
                        s.append('ও')
                    else:
                        s.append('ও' if u.sukun else '')
                else:
                    if prev_vowel == KASRA and u.bare:
                        if s and s[-1] == 'ি':
                            s[-1] = 'ী'
                        elif s and s[-1] == 'ই':
                            s[-1] = 'ঈ'
                    elif prev_vowel == FATHA:
                        s.append('ই')
                    elif u.sukun:
                        s.append('ই')
                if SMALL_WAW in u.marks or SMALL_YEH in u.marks:
                    pass
                i += 1
                continue
            v = u.vowel
            nxt = us[i + 1] if i + 1 < n else None
            long_ = _long(v, nxt, u)
            base = 'য়' if c == 'ي' else 'ও'
            if c == 'و':
                syl = {FATHA: 'ওয়া', KASRA: 'উই', DAMMA: 'উ'}
                if u.shadda:
                    s.append('ও')
                if v:
                    t = syl[v]
                    if long_:
                        t = {FATHA: 'ওয়া', KASRA: 'উঈ', DAMMA: 'ঊ'}[v]
                    s.append(t)
                elif u.tanween:
                    s.append({FATHATAN: 'ওয়া', KASRATAN: 'উই', DAMMATAN: 'উ'}[u.tanween])
                    if not last_in_ayah:
                        s.append('ন')
            else:
                start = not s or prev_vowel is None
                if u.shadda:
                    s.append('ইয়্য' if start else 'য়্য')
                else:
                    s.append('ইয়' if start else 'য়')
                if v:
                    s.append((LONG_SIGN if long_ else DIGRAPH_VOWEL)[v])
                elif u.tanween:
                    s.append(DIGRAPH_VOWEL[{FATHATAN: FATHA, KASRATAN: KASRA, DAMMATAN: DAMMA}[u.tanween]])
                    if not last_in_ayah:
                        s.append('ন')
            prev_vowel = v or (u.tanween and {FATHATAN: FATHA, KASRATAN: KASRA, DAMMATAN: DAMMA}[u.tanween])
            if long_ and nxt and nxt.bare:
                i += 1
            i += 1
            continue

        b = cons(u)
        if b is None:
            i += 1
            continue
        if c == 'ة' and (last_in_ayah or (not u.vowel and not u.tanween)):
            b = 'হ'
            if last_in_ayah:
                s.append(b)
                i += 1
                continue
        if any(m in IQLAB for m in u.marks) and c == 'ن':
            b = 'ম'
        v = u.vowel
        nxt = us[i + 1] if i + 1 < n else None
        long_ = _long(v, nxt, u)
        if u.shadda:
            s.append(b + HASANT + b)
        else:
            s.append(b)
        if v:
            s.append((LONG_SIGN if long_ else DIGRAPH_VOWEL)[v])
            if not long_:
                short_end[0] = len(s)
            prev_vowel = v
            if long_ and nxt and nxt.ch in ('ا', 'ى', 'و', 'ي') and nxt.bare:
                i += 1
        elif u.tanween:
            t = u.tanween
            vv = {FATHATAN: FATHA, KASRATAN: KASRA, DAMMATAN: DAMMA}[t]
            nasal = 'ম' if any(m in IQLAB for m in u.marks) else 'ন'
            if last_in_ayah:
                if t == FATHATAN:
                    s.append('া')
            else:
                s.append(DIGRAPH_VOWEL[vv] + nasal)
            prev_vowel = vv
            if nxt and nxt.ch == 'ا' and nxt.bare:
                i += 1
        else:
            prev_vowel = None
        i += 1

    if last_in_ayah and short_end[0] == len(s) and s and s[-1] in ('া', 'ি', 'ু'):
        s.pop()  # pause: the last short vowel isn't pronounced
    return ''.join(s)


def _long(v, nxt, u):
    if SUPER_ALIF in u.marks or MADDA in u.marks:
        return v == FATHA or v is None
    if not v or not nxt:
        return False
    if v == FATHA and nxt.ch in ('ا', 'ى') and (nxt.bare or SUPER_ALIF in nxt.marks or MADDA in nxt.marks):
        return True
    if v == KASRA and nxt.ch == 'ي' and (nxt.bare or SMALL_YEH in nxt.marks):
        return True
    if v == DAMMA and nxt.ch == 'و' and (nxt.bare or SMALL_WAW in nxt.marks):
        return True
    if SMALL_WAW in u.marks or SMALL_YEH in u.marks:
        return True
    return False


def ayah_tr(arabic, first_ayah=False):
    words = [w for w in arabic.split() if w.strip()]
    out = []
    if first_ayah and words and (MADDA in words[0] or words[0] in ('طه',)):
        m = muqattaat(words[0])
        if m:
            out.append(m)
            words = words[1:]
    for wi, w in enumerate(words):
        us = units(w)
        if not us:
            continue
        first = not out
        last = wi == len(words) - 1
        if us[0].ch == WASLA:
            rest = us[1:]
            if rest and rest[0].ch == 'ل' and rest[0].shadda:
                # Uthmani writes al-laḏī / al-layl with one doubled lam
                tail = word_tr([_unshadda(rest[0])] + rest[1:], False, last)
                if first:
                    out.append('আল' + HASANT + tail)
                else:
                    out[-1] = _shorten(out[-1]) + 'ল'
                    out.append(tail)
                continue
            is_article = len(rest) >= 2 and rest[0].ch == 'ل'
            is_allah = is_article and rest[1].ch == 'ل' and rest[1].shadda and len(rest) > 2 and rest[2].ch == 'ه'
            body = word_tr(rest[1:] if is_allah else rest, False, last)
            if is_article and not is_allah:
                lam = rest[0]
                nxt = rest[1]
                if lam.bare and nxt.shadda and nxt.ch in CONS and nxt.ch in SUN:
                    # sun letter: al-r-raḥmān → (আ)র রাহমান
                    c = CONS[nxt.ch]
                    tail = word_tr([_unshadda(nxt)] + rest[2:], False, last)
                    head = 'আ' + c if first else c
                    if first:
                        out.append(head + ' ' + tail)
                    else:
                        out[-1] = _shorten(out[-1]) + c
                        out.append(tail)
                    continue
                # moon letter: al-ḥamd → (আ)ল হামদ
                tail = word_tr(rest[1:], False, last)
                if first:
                    out.append('আল' + tail)
                else:
                    out[-1] = _shorten(out[-1]) + 'ল'
                    out.append(tail)
                continue
            if is_allah:
                if first:
                    out.append('আ' + body)
                else:
                    out[-1] = _shorten(out[-1]) + body
                continue
            # wasla on a verb / noun: ihdinā, ibn …
            if first:
                third = rest[1] if len(rest) > 1 else None
                lead = 'উ' if third is not None and third.vowel == DAMMA else 'ই'
                out.append(lead + body)
            else:
                out[-1] = _shorten(out[-1]) + body
            continue
        text = word_tr(us, first, last)
        # idgham: a word that starts doubled takes over the previous word's last consonant
        if out and us[0].shadda and us[0].ch in CONS and out[-1] and '\u0995' <= out[-1][-1] <= '\u09b9':
            c = CONS[us[0].ch]
            out[-1] = out[-1][:-1] + c
            text = _strip_double(text, c)
        out.append(text)
    return ' '.join(t for t in out if t)


def _shorten(t):
    # a long vowel before a joined (wasla) word is said short: fī l-… → ফিল
    if t.endswith('ী'):
        return t[:-1] + 'ি'
    if t.endswith('ূ'):
        return t[:-1] + 'ু'
    return t


MUQATTAAT = {
    'الم': 'আলিফ লাম মীম', 'المص': 'আলিফ লাম মীম সোয়াদ', 'الر': 'আলিফ লাম রা', 'المر': 'আলিফ লাম মীম রা',
    'كهيعص': 'কাফ হা ইয়া আইন সোয়াদ', 'طه': 'ত্বা হা', 'طسم': 'ত্বা সীন মীম', 'طس': 'ত্বা সীন', 'يس': 'ইয়া সীন',
    'ص': 'সোয়াদ', 'حم': 'হা মীম', 'عسق': 'আইন সীন কাফ', 'ق': 'কাফ', 'ن': 'নূন',
}


def muqattaat(word):
    letters = ''.join(ch for ch in word if '\u0621' <= ch <= '\u064a')
    return MUQATTAAT.get(letters)


def _unshadda(u):
    v = Unit(u.ch)
    v.marks = [m for m in u.marks if m != SHADDA]
    return v


def _strip_double(text, c):
    dbl = c + HASANT + c
    return c + text[len(dbl):] if text.startswith(dbl) else text


if __name__ == '__main__':
    import json
    import sys
    data = json.load(open(sys.argv[1], encoding='utf-8'))
    for s, a in [(1, None), (112, None), (113, None), (114, None), (2, 255), (18, 1), (36, 1), (2, 1), (2, 2), (38, 1), (103, None), (2, 286)]:
        ch = data[s - 1]
        for v in ch['verses']:
            if a is None or v['id'] == a:
                print(f'{s}:{v["id"]}', ayah_tr(v['text'], v['id'] == 1 or (s == 42 and v['id'] == 2)))
