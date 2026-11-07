"""Add English meaning (Saheeh International) and Latin transliteration to public/quran/*.

Each ayah becomes: [arabic, bangla meaning, bangla pronunciation, english meaning, english transliteration].
index.json gains "enMeaning"; daily.json gains "en" and "trEn".

Usage: npm pack quran-json@3.1.2 && tar -xzf quran-json-3.1.2.tgz
       python3 scripts/add-quran-en.py package/dist
"""
import json
import os
import sys

src = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), '..', 'public', 'quran')
en = {c['id']: c for c in json.load(open(os.path.join(src, 'quran_en.json'), encoding='utf-8'))}
tr = {c['id']: c for c in json.load(open(os.path.join(src, 'quran_transliteration.json'), encoding='utf-8'))}

for n in range(1, 115):
    p = os.path.join(out, f'{n}.json')
    d = json.load(open(p, encoding='utf-8'))
    ev = en[n]['verses']
    tv = tr[n]['verses']
    assert len(ev) == len(d['v']) == len(tv), n
    d['v'] = [v[:3] + [ev[i]['translation'], tv[i]['transliteration']] for i, v in enumerate(d['v'])]
    json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

idx = json.load(open(os.path.join(out, 'index.json'), encoding='utf-8'))
for s in idx:
    s['enMeaning'] = en[s['n']]['translation']
json.dump(idx, open(os.path.join(out, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

daily = json.load(open(os.path.join(out, 'daily.json'), encoding='utf-8'))
for d in daily:
    d['en'] = en[d['s']]['verses'][d['a'] - 1]['translation']
    d['trEn'] = tr[d['s']]['verses'][d['a'] - 1]['transliteration']
json.dump(daily, open(os.path.join(out, 'daily.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('ok')
