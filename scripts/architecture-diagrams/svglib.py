"""Tiny SVG builder for the Resonate architecture diagrams.

Colours follow the Obsidian Frequency tokens in web/src/styles/tokens.css. Standard library only.
"""
from xml.sax.saxutils import escape

SANS = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

# Domain accents (Obsidian Frequency tokens + semantic tokens)
ACC = {
    "edge": "#60A5FA",      # --r-info
    "platform": "#9880FF",  # brand violet (light stop)
    "agent": "#A78BFA",     # electric violet, lifted for contrast
    "sound": "#FF8F6B",     # coral ember (mid stop)
    "data": "#34D399",      # --r-success
    "analytics": "#FBBF24", # --r-warning
    "chain": "#C4B5FD",     # lavender
    "pay": "#F472B6",       # settlement pink
    "ops": "#94A3B8",       # slate
}

TEXT = "#F4F2FF"
MUTED = "#A9A3C9"
FAINT = "#6F6A8F"
SURF_LOW = "#11101E"
SURF = "#161427"
SURF_HI = "#1D1B32"
LINE = "#2A2745"


class Svg:
    def __init__(self, w, h, title, desc):
        self.w, self.h = w, h
        self.title, self.desc = title, desc
        self.body = []
        self.top = []  # drawn after body (arrows over cards when needed)

    def add(self, s, top=False):
        (self.top if top else self.body).append(s)

    # ---------- primitives ----------
    def text(self, x, y, s, size=13, color=TEXT, weight=500, anchor="start", mono=False,
             spacing=None, opacity=None, top=False):
        fam = MONO if mono else SANS
        extra = f' letter-spacing="{spacing}"' if spacing is not None else ""
        extra += f' opacity="{opacity}"' if opacity is not None else ""
        self.add(f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" font-weight="{weight}" '
                 f'fill="{color}" text-anchor="{anchor}"{extra}>{escape(s)}</text>', top)

    def rect(self, x, y, w, h, rx=12, fill=SURF, stroke=LINE, sw=1, extra="", top=False):
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" '
                 f'stroke="{stroke}" stroke-width="{sw}" {extra}/>', top)

    # ---------- composites ----------
    def zone(self, x, y, w, h, kicker, title, acc, note=None):
        """Large grouping region with a kicker + title header."""
        self.rect(x, y, w, h, rx=22, fill=SURF_LOW, stroke=LINE, sw=1.2,
                  extra='fill-opacity="0.82"')
        self.rect(x + 22, y + 22, 8, 8, rx=2, fill=acc, stroke="none")
        self.text(x + 40, y + 30, kicker.upper(), size=11, color=acc, weight=700, spacing="1.6")
        self.text(x + 22, y + 56, title, size=19, weight=750)
        if note:
            self.text(x + w - 22, y + 30, note, size=11, color=FAINT, weight=600, anchor="end", mono=True)

    def box(self, x, y, w, h, title, acc, lines=(), mono=True, size=10.8, title_size=14):
        """Tinted box with a centred title on top and centred detail lines."""
        self.rect(x, y, w, h, rx=9, fill=acc, stroke=acc, sw=1, extra='fill-opacity="0.11" stroke-opacity="0.5"')
        self.text(x + w / 2, y + 24, title, size=title_size, weight=700, anchor="middle")
        for i, ln in enumerate(lines):
            self.text(x + w / 2, y + 46 + i * 17, ln, size=size, color=MUTED, weight=550, anchor="middle", mono=mono)

    def card(self, x, y, w, h, title, acc, lines=(), tag=None, icon=None, title_size=15, glow=False):
        """Content card with accent stripe, title, body lines and optional mono tag."""
        if glow:
            self.rect(x - 3, y - 3, w + 6, h + 6, rx=17, fill="none", stroke=acc, sw=1,
                      extra='stroke-opacity="0.25"')
        self.rect(x, y, w, h, rx=14, fill=SURF, stroke=acc, sw=1, extra='stroke-opacity="0.42"')
        self.add(f'<path d="M{x+1} {y+14} a13 13 0 0 1 13 -13 h{w*0.38} " stroke="{acc}" stroke-width="2.4" '
                 f'stroke-linecap="round" fill="none" opacity="0.9"/>')
        tx = x + 16
        if icon:
            self.add(icon_svg(icon, x + 16, y + 17, acc))
            tx = x + 44
        self.text(tx, y + 30, title, size=title_size, weight=700)
        ly = y + 51
        for ln in lines:
            self.text(x + 16, ly, ln, size=12.5, color=MUTED, weight=500)
            ly += 18
        if tag:
            self.text(x + 16, y + h - 14, tag, size=10.5, color=acc, weight=600, mono=True, opacity="0.92")

    def chip(self, x, y, w, label, acc, h=30, sub=None, center=True, mono=False, size=12.5):
        self.rect(x, y, w, h, rx=9, fill=acc, stroke=acc, sw=1,
                  extra='fill-opacity="0.11" stroke-opacity="0.5"')
        if sub:
            self.text(x + (w / 2 if center else 12), y + h / 2 - 2, label, size=size, weight=650,
                      anchor="middle" if center else "start", mono=mono)
            self.text(x + (w / 2 if center else 12), y + h / 2 + 13, sub, size=10.5, color=MUTED,
                      weight=500, anchor="middle" if center else "start")
        else:
            self.text(x + (w / 2 if center else 12), y + h / 2 + 4.5, label, size=size, weight=650,
                      anchor="middle" if center else "start", mono=mono)

    def arrow(self, d, acc, dashed=False, width=1.7, label=None, lx=None, ly=None, top=True,
              opacity=0.9, lanchor="middle"):
        dash = ' stroke-dasharray="5 5"' if dashed else ""
        mid = ACC_MARKER[acc]
        self.add(f'<path d="{d}" stroke="{acc}" stroke-width="{width}" fill="none" stroke-linecap="round" '
                 f'stroke-linejoin="round" opacity="{opacity}"{dash} marker-end="url(#{mid})"/>', top)
        if label:
            self.label(lx, ly, label, acc, anchor=lanchor)

    def label(self, x, y, s, acc, anchor="middle"):
        w = len(s) * 6.3 + 14
        rx = x - w / 2 if anchor == "middle" else (x if anchor == "start" else x - w)
        self.rect(rx, y - 12, w, 18, rx=9, fill="#0B0A16", stroke=acc, sw=1,
                  extra='stroke-opacity="0.55"', top=True)
        self.text(rx + w / 2, y + 1, s, size=10.5, color=acc, weight=650, anchor="middle", mono=True, top=True)

    def dot(self, x, y, acc, r=3.2):
        self.add(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{acc}"/>', True)

    # ---------- output ----------
    def render(self):
        markers = "".join(
            f'<marker id="{mid}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" '
            f'orient="auto-start-reverse"><path d="M1 1.2 L9 5 L1 8.8 Z" fill="{c}"/></marker>'
            for c, mid in ACC_MARKER.items())
        w, h = self.w, self.h
        head = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc">
  <title id="title">{escape(self.title)}</title>
  <desc id="desc">{escape(self.desc)}</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="{w}" y2="{h}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0D0B1C"/><stop offset="0.55" stop-color="#08080F"/><stop offset="1" stop-color="#0C0912"/>
    </linearGradient>
    <radialGradient id="auraV" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate({w*0.18} {h*0.02}) scale({w*0.42} {h*0.42})">
      <stop offset="0" stop-color="#7C5CFF" stop-opacity="0.30"/><stop offset="1" stop-color="#7C5CFF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="auraC" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate({w*0.92} {h*1.0}) scale({w*0.36} {h*0.40})">
      <stop offset="0" stop-color="#FF6B4A" stop-opacity="0.16"/><stop offset="1" stop-color="#FF6B4A" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7C5CFF"/><stop offset="0.6" stop-color="#A085FF"/><stop offset="1" stop-color="#FF8F6B"/>
    </linearGradient>
    <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.9" fill="#FFFFFF" fill-opacity="0.045"/>
    </pattern>
    {markers}
  </defs>
  <rect width="{w}" height="{h}" rx="28" fill="url(#bg)"/>
  <rect width="{w}" height="{h}" rx="28" fill="url(#grid)"/>
  <rect width="{w}" height="{h}" rx="28" fill="url(#auraV)"/>
  <rect width="{w}" height="{h}" rx="28" fill="url(#auraC)"/>
  <rect x="0.5" y="0.5" width="{w-1}" height="{h-1}" rx="27.5" fill="none" stroke="#2A2745"/>
'''
        return head + "\n".join("  " + s for s in self.body + self.top) + "\n</svg>\n"

    def header(self, title, subtitle, kicker="RESONATE"):
        # waveform mark
        bars = [6, 14, 24, 14, 30, 18, 8]
        x0 = 56
        for i, bh in enumerate(bars):
            self.rect(x0 + i * 7, 62 - bh / 2, 3.6, bh, rx=1.8, fill="url(#brand)", stroke="none")
        self.text(118, 52, kicker, size=11.5, color=ACC["platform"], weight=750, spacing="2.4")
        self.text(118, 80, title, size=30, weight=800, spacing="-0.4")
        self.text(118, 106, subtitle, size=14, color=MUTED, weight=500)

    def legend(self, x, y, items):
        """items: list of (label, acc, dashed)"""
        cx = x
        for label, acc, dashed in items:
            dash = ' stroke-dasharray="5 5"' if dashed else ""
            self.add(f'<path d="M{cx} {y} h28" stroke="{acc}" stroke-width="1.8" stroke-linecap="round"{dash} '
                     f'marker-end="url(#{ACC_MARKER[acc]})"/>')
            self.text(cx + 40, y + 4.5, label, size=12, color=MUTED, weight=550)
            cx += 40 + len(label) * 6.6 + 28


ACC_MARKER = {c: f"m{i}" for i, c in enumerate(sorted(set(ACC.values()) | {MUTED}))}


def icon_svg(kind, x, y, c):
    """18px line icons, top-left at (x, y)."""
    g = f'<g transform="translate({x} {y})" stroke="{c}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round">'
    p = {
        "user": '<circle cx="9" cy="6" r="3.4"/><path d="M2.5 17c.8-3.6 3.4-5.4 6.5-5.4s5.7 1.8 6.5 5.4"/>',
        "desktop": '<rect x="1.5" y="2.5" width="15" height="10" rx="2"/><path d="M6 16h6M9 12.5V16"/>',
        "bot": '<rect x="2.5" y="5" width="13" height="10" rx="3"/><path d="M9 1.5V5"/><circle cx="6.5" cy="10" r="1"/><circle cx="11.5" cy="10" r="1"/>',
        "gear": '<circle cx="9" cy="9" r="2.6"/><path d="M9 1.5v2.2M9 14.3v2.2M1.5 9h2.2M14.3 9h2.2M3.7 3.7l1.6 1.6M12.7 12.7l1.6 1.6M3.7 14.3l1.6-1.6M12.7 5.3l1.6-1.6"/>',
        "globe": '<circle cx="9" cy="9" r="7.2"/><path d="M1.8 9h14.4M9 1.8c2.2 2 3.2 4.4 3.2 7.2s-1 5.2-3.2 7.2c-2.2-2-3.2-4.4-3.2-7.2S6.8 3.8 9 1.8z"/>',
        "box": '<path d="M9 1.5l7 3.8v7.4L9 16.5 2 12.7V5.3z"/><path d="M2 5.3l7 3.8 7-3.8M9 9.1v7.4"/>',
        "db": '<ellipse cx="9" cy="4" rx="6.5" ry="2.5"/><path d="M2.5 4v10c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V4M2.5 9c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5"/>',
        "wave": '<path d="M1.5 9h2l1.6-4.5 2.4 9 2.4-11 2.4 9 1.6-2.5h2.6"/>',
        "chart": '<path d="M2 16.5h14"/><rect x="3.5" y="9" width="2.6" height="5.5" rx=".6"/><rect x="7.7" y="5" width="2.6" height="9.5" rx=".6"/><rect x="11.9" y="2" width="2.6" height="12.5" rx=".6"/>',
    }[kind]
    return g + p + "</g>"
