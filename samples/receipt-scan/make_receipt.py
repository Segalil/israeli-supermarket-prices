"""Synthetic Israeli receipt PNG from real catalog products, for manually
testing the site's receipt-scan feature (run from the repo root, needs
site/data/products.json.gz — `python build_site_data.py` first — and a macOS
Hebrew-capable font). Serve the repo and feed the PNG to #/receipt, or run
startReceiptScan(file) from the console; truth.json lists the expected matches.
No raqm in the default PIL build -> manual visual-RTL layout: reverse token
order, reverse chars inside Hebrew tokens (Hebrew has no joining so this is
exact)."""
import gzip, json, random, re, sys
from PIL import Image, ImageDraw, ImageFont

SITE_DATA = 'site/data/products.json.gz'
OUT = 'samples/receipt-scan/receipt.png'
TRUTH = 'samples/receipt-scan/truth.json'

data = json.load(gzip.open(SITE_DATA, 'rt', encoding='utf-8'))
prods = data['products']

def clean_tokens(name):
    """True if every token is purely Hebrew or purely digits/percent (keeps the
    manual bidi honest)."""
    for t in name.split():
        heb = bool(re.search(r'[א-ת]', t))
        other = bool(re.search(r'[0-9%]', t))
        if heb and other:
            return False
        if not heb and not re.fullmatch(r'[0-9]+%?', t):
            return False
    return True

random.seed(11)
pool = [p for p in prods
        if re.fullmatch(r'\d{13}', str(p[0]))
        and clean_tokens(p[1])
        and 3 <= len(p[1].split()) <= 6
        and sum(v is not None for v in p[4]) >= 3]
picked = random.sample(pool, 10)

def price_of(p):
    vals = [v for v in p[4] if v is not None]
    return round(sum(vals) / len(vals), 1) or 7.9

def vis(s):
    if not re.search(r'[א-ת]', s):
        return s                       # pure-LTR line (qty/price rows) stays as printed
    out = []
    for tok in reversed(s.split()):
        out.append(tok[::-1] if re.search(r'[א-ת]', tok) else tok)
    return ' '.join(out)

W, H, M = 860, 1400, 40
img = Image.new('L', (W, H), 252)
d = ImageDraw.Draw(img)
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 26)
big = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 34)
y = M

def line(txt, f=None, align='right', dy=40):
    global y
    f = f or font
    t = vis(txt)
    if align == 'center':
        wpx = d.textlength(t, font=f)
        d.text(((W - wpx) / 2, y), t, font=f, fill=10)
    elif align == 'right':
        wpx = d.textlength(t, font=f)
        d.text((W - M - wpx, y), t, font=f, fill=10)
    else:
        d.text((M, y), t, font=f, fill=10)
    y += dy

def item_line(name, price, code=None):
    """name right-aligned, price at far left, code (ltr digits) mid-left."""
    global y
    t = vis(name)
    wpx = d.textlength(t, font=font)
    d.text((W - M - wpx, y), t, font=font, fill=10)
    d.text((M, y), f'{price:.2f}', font=font, fill=10)
    if code:
        d.text((M + 110, y), code, font=font, fill=10)
    y += 42

def sep():
    global y
    d.text((M, y), '-' * 52, font=font, fill=10)
    y += 42

# --- header (must all be skipped by the parser) ---
line('שופרסל דיל נתניה', big, 'center', 50)
line('רחוב הרצל 12 נתניה', font, 'center')
line('טלפון: 03-1234567  ח.פ 520022732', font, 'center')
line('תאריך: 10/08/2026  שעה: 15:22  קופה: 4', font, 'center')
sep()

truth = []
# --- 6 items with printed codes ---
for p in picked[:6]:
    item_line(p[1], price_of(p), p[0])
    truth.append({'key': p[0], 'name': p[1], 'via': 'code'})
# qty line for the last coded item ("2 X unit  total")
unit = price_of(picked[5])
line(f'2 X {unit:.2f}   {2 * unit:.2f}', font, 'left')
truth[-1]['qty'] = 2

# --- 3 items without codes (name-match path) ---
for p in picked[6:9]:
    item_line(p[1], price_of(p))
    truth.append({'key': p[0], 'name': p[1], 'via': 'name'})

# --- item with a corrupted code (one digit off) -> must fall back to name ---
p = picked[9]
bad = p[0][:-1] + str((int(p[0][-1]) + 5) % 10)
item_line(p[1], price_of(p), bad)
truth.append({'key': p[0], 'name': p[1], 'via': 'name', 'badcode': bad})

# --- weighted produce line (qty must stay 1) ---
item_line('עגבניות שרי', 5.62)
line('0.436 X 12.90', font, 'left')

# --- noise the parser must drop ---
line('הנחת מבצע                 -2.00', font, 'right')
sep()
total = sum(price_of(p) for p in picked) + 2 * unit - unit + 5.62 - 2
line(f'סה"כ לתשלום: {total:.2f}', big, 'right', 52)
line(f'אשראי ויזה: {total:.2f}', font, 'right')
line('מספר פריטים: 12', font, 'right')
sep()
line('תודה שקניתם בשופרסל!', font, 'center')
line('חסכת היום: 12.30', font, 'center')

img = img.crop((0, 0, W, y + M))
img.save(OUT)
json.dump(truth, open(TRUTH, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('receipt:', OUT, img.size)
print('truth:')
for t in truth:
    print(' ', t.get('via'), t['key'], t['name'], 'qty=' + str(t.get('qty', 1)))
