#!/usr/bin/env python3
"""One-off asset discovery helper: search Wikimedia Commons for imagery.

Usage: python3 scripts/saturn_asset_scan.py "Mimas PIA184" "Titan mosaic" ...
"""
import json, sys, urllib.request, urllib.parse

def api(params):
    url = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': 'Web-Earth-asset-scan/1.0 (contact: local dev)'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def search(term, limit=8):
    d = api({
        'action': 'query', 'format': 'json',
        'generator': 'search', 'gsrsearch': term, 'gsrnamespace': 6, 'gsrlimit': str(limit),
        'prop': 'imageinfo', 'iiprop': 'url|size|extmetadata', 'iiurlwidth': '2048',
    })
    pages = d.get('query', {}).get('pages', {})
    out = []
    for p in pages.values():
        ii = p.get('imageinfo', [{}])[0]
        em = ii.get('extmetadata', {})
        lic = em.get('LicenseShortName', {}).get('value', '?')
        out.append((p.get('title', ''), ii.get('width'), ii.get('height'), ii.get('thumburl', ''), lic, ii.get('url', '')))
    out.sort()
    for t, w, h, thumb, lic, full in out:
        print('  %s  [%sx%s]  %s' % (t, w, h, lic))
        print('    thumb2048: %s' % thumb)
        print('    full: %s' % full)

for term in sys.argv[1:]:
    print('=== %s' % term)
    try:
        search(term)
    except Exception as e:
        print('  ERROR:', e)
