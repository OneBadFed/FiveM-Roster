"""Render a design illustration from the actual Config style plan; not a live Sheets screenshot."""
import json, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent / '.preview'
data = json.loads((root / 'Config.preview.json').read_text(encoding='utf-8'))
grid, styles = data['grid'], data['styled']
widths = [270, 280, 540, 160, 140]
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 15)
bold = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 15)
mono = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 13)
title = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 24)
probe = ImageDraw.Draw(Image.new('RGB', (1, 1)))

def wrap(text, face, width):
    lines = []
    for paragraph in str(text).split('\n'):
        line = ''
        for word in paragraph.split():
            candidate = (line + ' ' + word).strip()
            if line and probe.textlength(candidate, font=face) > width:
                lines.append(line)
                line = word
            else:
                line = candidate
        lines.append(line)
    return lines

status = next(i for i, row in enumerate(grid) if row[0] == '[STATUSES]')
indices = list(range(14)) + [None] + list(range(status, status + 8))
prepared = []
for i in indices:
    if i is None:
        prepared.append((None, [], [], 36))
        continue
    kind = styles[i]['kind']
    faces = [mono] + [bold if kind in ('section', 'columns') else font] * 4
    if kind == 'title': faces[1] = title
    text = [wrap(v, faces[c], widths[c] - 20) for c, v in enumerate(grid[i])]
    height = {'title': 58, 'section': 44, 'columns': 30, 'space': 12}.get(kind, max(32, max(map(len, text)) * 18 + 14))
    prepared.append((i, text, faces, height))

image = Image.new('RGB', (sum(widths), 40 + sum(r[3] for r in prepared)), '#191d23')
draw = ImageDraw.Draw(image)
draw.text((14, 12), 'CONFIG DESIGN PREVIEW   /   Example defaults · selected sections', fill='#b6c7da', font=mono)
y = 40
for i, texts, faces, height in prepared:
    if i is None:
        draw.text((14, y + 9), 'Additional configuration sections continue below…', fill='#8996a8', font=mono)
    else:
        x = 0
        for c, w in enumerate(widths):
            draw.rectangle((x, y, x+w, y+height), fill=styles[i]['backgrounds'][c])
            top = y + max(5, (height - len(texts[c]) * 18) // 2)
            for line in texts[c]:
                draw.text((x+10, top), line, font=faces[c], fill=styles[i]['colors'][c])
                top += 18
            x += w
    y += height
image.save(root / 'Config.preview.png')
