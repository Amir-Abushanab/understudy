/**
 * Visual brand report: render the measured design model as a self-contained HTML
 * page. It is an instrument readout, not a landing page: understudy's own quiet
 * chrome (cool neutrals, one restrained accent, mono for every measured value),
 * with the captured brand shown as *data* (swatches, specimens, curves) rather
 * than styling the report as the brand.
 *
 * Returns inner page content (a <style> block plus markup), so it can be wrapped
 * in a document by the CLI or published directly as an Artifact.
 */

import type { DesignModel } from './design-model.js';
import type { BrandModel, ColorTokens, Mode, ContrastCheck, TypographyRole } from '../brand/types.js';
import type { MotionModel } from '../analyze/model.js';
import { parseColor, luminance } from '../brand/color.js';

export function toBrandReport(design: DesignModel): string {
  const { brand, motion } = design;
  return [
    fontFaceStyle(brand),
    style(),
    heroVarsCss(brand),
    `<main class="report">`,
    brandHero(design),
    metaBar(design),
    palette(brand), accessibility(brand), typography(brand), scales(brand), elevation(brand), gradients(brand), motionSection(motion),
    footer(design),
    `</main>`,
  ].join('\n');
}

// --------------------------------------------------------------------------

/** The hero wears the captured brand: its background, accent, display font, and
 * logo, so the report opens by rendering the extraction as itself. */
function brandHero(design: DesignModel): string {
  const { brand } = design;
  const c = brand.colors[brand.mode];
  if (!c) return '';
  const themed = Object.keys(brand.colors).length > 1;
  const logo = brand.logo ? logoMarkup(brand) : '';
  const grad = brand.gradients[0]
    ? `<div class="bh-sig"><span class="bh-sig-band" style="background:${esc(brand.gradients[0])}"></span><span class="bh-sig-label mono">signature gradient${themed ? ' · theme-aware' : ''}</span></div>`
    : '';
  // The label style, rendered as the eyebrow when the brand has one.
  const eyebrow = brand.typography.label
    ? `<span class="bh-eyebrow" style="letter-spacing:${brand.typography.label.letterSpacing};${brand.typography.label.transform ? `text-transform:${brand.typography.label.transform}` : ''}">measured brand identity</span>`
    : `<span class="bh-eyebrow">measured brand identity</span>`;
  return `
<header class="brand-hero">
  <div class="bh-top">${logo}${eyebrow}</div>
  <h1 class="bh-name">${esc(design.name)}</h1>
  <a class="bh-src" href="${esc(design.source)}">${esc(design.source)}</a>
  <div class="bh-cta">
    <span class="bh-btn">Primary action</span>
    <span class="bh-btn ghost">Secondary</span>
    <span class="bh-swatch mono">${esc(c.accent)}</span>
  </div>
  ${grad}
</header>`;
}

/** Hero brand variables as CSS, so a themed brand's hero follows the viewer's
 * light/dark theme, while a single-mode brand's hero stays fixed to its mode. */
function heroVarsCss(brand: BrandModel): string {
  const primary = brand.colors[brand.mode];
  if (!primary) return '';
  const disp = brand.typography.display;
  const vars = (c: ColorTokens): string =>
    `--b-bg:${c.background};--b-fg:${c.text1};--b-fg2:${c.text2};--b-accent:${c.accent};--b-on-accent:${readableText(c.accent)};--b-border:${c.border}`;
  const rules = [`.brand-hero{${vars(primary)};--b-display:${cssFam(disp.family)};--b-display-w:${disp.weight}}`];
  const { light, dark } = brand.colors;
  if (light && dark) {
    rules.push(`@media(prefers-color-scheme:dark){.brand-hero{${vars(dark)}}}`);
    rules.push(`@media(prefers-color-scheme:light){.brand-hero{${vars(light)}}}`);
    rules.push(`:root[data-theme="dark"] .brand-hero{${vars(dark)}}`);
    rules.push(`:root[data-theme="light"] .brand-hero{${vars(light)}}`);
  }
  return `<style>${rules.join('')}</style>`;
}

/** Neutral instrument meta strip below the brand hero. */
function metaBar(design: DesignModel): string {
  const { brand, motion } = design;
  const item = (label: string, value: string, warn = false) =>
    `<div><span class="mk">${label}</span><span class="mono"${warn ? ' style="color:var(--warn)"' : ''}>${value}</span></div>`;
  return `<div class="metabar">
    ${item('mode', brand.mode + (Object.keys(brand.colors).length > 1 ? ' + ' + otherMode(brand.mode) : ''))}
    ${item('brand conf', brand.confidence.toFixed(2))}
    ${item('motion conf', motion.meta.confidence.toFixed(2))}
    ${item('archetype', motion.personality.archetype)}
    ${item('sampled', brand.sampled.toLocaleString('en-US'))}
    ${brand.challenged ? item('warning', 'challenge page', true) : ''}
  </div>`;
}

/** Inject @font-face for the brand fonts so the real face loads where the CSP
 * allows external URLs (local report file). In the sandboxed Artifact the CSP
 * blocks them and the fallback stack renders; harmless either way. */
function fontFaceStyle(brand: BrandModel): string {
  const rules: string[] = [];
  const have = new Set<string>();
  for (const f of brand.typography.fontFaces) {
    if (!f.src || !f.family) continue;
    rules.push(`@font-face{font-family:"${f.family}";src:url("${f.src}");font-weight:${f.weight};font-style:${f.style};font-display:swap}`);
    have.add(norm(f.family));
  }
  const files = brand.typography.fontFiles ?? [];
  for (const role of [brand.typography.display, brand.typography.body]) {
    const key = norm(role.family);
    if (have.has(key) || key.length < 4) continue;
    const token = key.slice(0, 5);
    const match = files.find((u) => norm(u).includes(token));
    if (match) {
      rules.push(`@font-face{font-family:"${role.family}";src:url("${match}");font-weight:${role.weight};font-display:swap}`);
      have.add(key);
    }
  }
  return rules.length > 0 ? `<style>${rules.join('')}</style>` : '';
}

function readableText(hex: string): string {
  const c = parseColor(hex);
  return c && luminance(c) > 0.5 ? '#111318' : '#ffffff';
}
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function palette(brand: BrandModel): string {
  const modes = Object.entries(brand.colors) as [Mode, ColorTokens][];
  const swatchRows = modes
    .map(([mode, c]) => {
      const roles = [
        ['background', c.background], ['surface', c.surface], ['text1', c.text1],
        ['text2', c.text2], ['accent', c.accent], ['border', c.border],
      ] as const;
      return `<div class="mode-block"><div class="mode-tag mono">${mode}</div><div class="swatches">${roles.map(([n, v]) => swatch(n, v)).join('')}</div></div>`;
    })
    .join('');
  const accents = brand.accents.length > 1 ? `<div class="sub">palette</div><div class="chips">${brand.accents.map((a) => chip(a)).join('')}</div>` : '';
  const states = Object.keys(brand.states).length
    ? `<div class="sub">states</div><div class="chips">${Object.entries(brand.states).map(([s, v]) => chip(v, s)).join('')}</div>`
    : '';
  const hover = brand.accentHover ? `<div class="sub">accent hover</div><div class="chips">${chip(brand.accentHover)}</div>` : '';
  return panel('Color', swatchRows + accents + states + hover);
}

function swatch(name: string, value: string): string {
  return `<div class="sw"><span class="sw-chip" style="background:${esc(value)}"></span><span class="sw-name">${name}</span><span class="sw-val mono">${esc(value)}</span></div>`;
}
function chip(value: string, label?: string): string {
  return `<div class="pchip"><span class="sw-chip sm" style="background:${esc(value)}"></span><span class="mono">${label ? label + ' ' : ''}${esc(value)}</span></div>`;
}

function accessibility(brand: BrandModel): string {
  const rows = (Object.entries(brand.accessibility) as [Mode, ContrastCheck[]][])
    .flatMap(([mode, checks]) =>
      (checks || []).map(
        (ck) => `<tr><td class="mono dim">${mode}</td><td>${esc(ck.pair)}</td><td class="mono num">${ck.ratio.toFixed(2)}</td><td>${levelBadges(ck.passes)}</td></tr>`,
      ),
    )
    .join('');
  if (!rows) return '';
  return panel('Accessibility (WCAG)', `<table class="tbl"><thead><tr><th>mode</th><th>pair</th><th class="num">ratio</th><th>passes</th></tr></thead><tbody>${rows}</tbody></table>`);
}
function levelBadges(passes: string[]): string {
  if (passes.length === 0) return `<span class="badge bad">fail</span>`;
  const best = passes.includes('AAA') ? 'ok' : passes.includes('AA') ? 'ok' : 'warn';
  return passes.map((p) => `<span class="badge ${best}">${p}</span>`).join(' ');
}

function typography(brand: BrandModel): string {
  const t = brand.typography;
  const specs = [specimen('display', t.display), specimen('body', t.body), t.mono ? specimen('mono', t.mono) : '', t.label ? specimen('label', t.label) : ''].join('');
  const headings = t.headings && Object.keys(t.headings).length > 0
    ? `<div class="sub">heading scale</div><div class="hscale">${Object.entries(t.headings).map(([lvl, h]) => `<div class="hrow"><span class="mono dim hlvl">${lvl}</span><span class="hsize" style="font-family:${cssFam(t.display.family)};font-size:${Math.min(h.size, 42)}px;font-weight:${h.weight}">${lvl.toUpperCase()}</span><span class="mono dim">${h.size}px · w${h.weight}</span></div>`).join('')}</div>`
    : '';
  const ladder = t.weights.length > 1
    ? `<div class="sub">weight ladder</div><div class="wladder">${t.weights.map((w) => `<div class="wrow"><span class="mono dim">${w}</span><span class="wsample" style="font-family:${cssFam(t.body.family)};font-weight:${w}">Grumpy wizards make toxic brew</span></div>`).join('')}</div>`
    : '';
  const scale = t.scale.length ? `<div class="sub">size scale${t.scaleRatio ? ` · ratio ${t.scaleRatio}` : ''}${t.measure ? ` · measure ${t.measure} char/line` : ''}</div><div class="chips">${t.scale.map((s) => `<span class="pchip mono">${s}px</span>`).join('')}</div>` : '';
  const files = t.fontFiles && t.fontFiles.length ? `<div class="sub">font files</div><ul class="files mono">${t.fontFiles.slice(0, 6).map((f) => `<li>${esc(shortUrl(f))}</li>`).join('')}</ul>` : '';
  return panel('Typography', specs + headings + ladder + scale + files);
}

function specimen(label: string, role: TypographyRole): string {
  const tracked = role.letterSpacing && role.letterSpacing !== '0';
  const meta = [
    `${role.size}px`, `w${role.weight}`, role.lineHeight ? `lh ${role.lineHeight}` : '', tracked ? `ls ${role.letterSpacing}` : '',
    role.transform ?? '', role.style ?? '', role.stretch ? `stretch ${role.stretch}` : '', role.numeric ?? '', role.featureSettings ? `feat ${role.featureSettings}` : '',
    role.variationSettings ? `axes ${role.variationSettings}` : '', role.opticalSizing ? `opsz ${role.opticalSizing}` : '', role.wordSpacing ? `word ${role.wordSpacing}` : '',
  ].filter(Boolean).join(' · ');
  const css = [
    `font-family:${cssFam(role.family)}`,
    `font-size:${Math.min(role.size, 52)}px`,
    `font-weight:${role.weight}`,
    tracked ? `letter-spacing:${role.letterSpacing}` : '',
    role.transform ? `text-transform:${role.transform}` : '',
    role.style ? `font-style:${role.style}` : '',
    role.stretch ? `font-stretch:${role.stretch}` : '',
    role.numeric ? `font-variant-numeric:${role.numeric}` : '',
    role.featureSettings ? `font-feature-settings:${role.featureSettings}` : '',
    role.variationSettings ? `font-variation-settings:${role.variationSettings}` : '',
    role.opticalSizing ? `font-optical-sizing:${role.opticalSizing}` : '',
    role.wordSpacing ? `word-spacing:${role.wordSpacing}` : '',
  ].filter(Boolean).join(';');
  return `<div class="spec"><div class="spec-head"><span class="mono dim">${label}</span><span class="mono">${esc(role.family)} · ${esc(meta)}</span></div><div class="spec-line" style="${css}">Ag ${esc(role.family)}</div></div>`;
}

function scales(brand: BrandModel): string {
  const space = brand.spacing.length
    ? `<div class="sub">spacing</div><div class="bars">${brand.spacing.filter((s) => s > 0).map((s) => `<div class="bar"><span class="bar-fill" style="width:${Math.min(s, 128)}px"></span><span class="mono">${s}</span></div>`).join('')}</div>`
    : '';
  const radii = brand.radii.length
    ? `<div class="sub">radius</div><div class="chips">${brand.radii.filter((r) => r >= 0).map((r) => `<div class="rad"><span class="rad-box" style="border-radius:${Math.min(r, 24)}px"></span><span class="mono">${r}</span></div>`).join('')}</div>`
    : '';
  const containers = brand.containers.length ? `<div class="sub">containers</div><div class="chips">${brand.containers.map((c) => `<span class="pchip mono">${c}px</span>`).join('')}</div>` : '';
  return panel('Space & Shape', space + radii + containers);
}

function elevation(brand: BrandModel): string {
  if (!brand.shadows.length) return '';
  const boxes = brand.shadows.map((s, i) => `<div class="shadow-box" style="box-shadow:${esc(s)}"><span class="mono dim">${i}</span></div>`).join('');
  return panel('Elevation', `<div class="shadows">${boxes}</div>`);
}

function gradients(brand: BrandModel): string {
  if (!brand.gradients.length) return '';
  const g = brand.gradients.map((grad) => `<div class="grad" style="background:${esc(grad)}"></div>`).join('');
  return panel('Gradients', `<div class="grads">${g}</div>`);
}

function motionSection(motion: MotionModel): string {
  const durs = Object.entries(motion.primitives.duration).map(([n, t]) => `<span class="pchip mono">${n} ${t.value}ms</span>`).join('');
  const eases = Object.entries(motion.primitives.easing)
    .map(([name, tok]) => {
      if (tok.kind === 'bezier') return `<div class="ease"><div class="mono dim">${name}</div>${easeCurve(tok.control)}<div class="mono small">cubic-bezier(${tok.control.join(', ')})</div></div>`;
      return `<div class="ease"><div class="mono dim">${name}</div><div class="spring">spring</div><div class="mono small">k ${tok.stiffness} · c ${tok.damping}</div></div>`;
    })
    .join('');
  const stag = Object.keys(motion.primitives.stagger).length ? `<div class="sub">stagger</div><div class="chips">${Object.entries(motion.primitives.stagger).map(([n, t]) => `<span class="pchip mono">${n} ${t.value}ms</span>`).join('')}</div>` : '';
  return panel('Motion', `<div class="sub">duration</div><div class="chips">${durs}</div>${stag}<div class="sub">easing</div><div class="eases">${eases}</div>`);
}

function easeCurve(c: readonly number[]): string {
  const w = 84;
  const h = 84;
  const x1 = c[0] * w;
  const y1 = (1 - c[1]) * h;
  const x2 = c[2] * w;
  const y2 = (1 - c[3]) * h;
  return `<svg class="curve" viewBox="-6 -6 ${w + 12} ${h + 12}" width="${w}" height="${h}"><line x1="0" y1="${h}" x2="${w}" y2="0" class="diag"/><path d="M0 ${h} C ${x1} ${y1} ${x2} ${y2} ${w} 0" class="cv"/></svg>`;
}

function footer(design: DesignModel): string {
  return `<footer class="foot"><span class="mono">measured by understudy</span><span class="mono dim">${esc(design.capturedAt)}</span></footer>`;
}

// --------------------------------------------------------------------------

function panel(title: string, body: string): string {
  return `<section class="panel"><h2 class="mono">${title}</h2>${body}</section>`;
}

function logoMarkup(brand: BrandModel): string {
  const logo = brand.logo!;
  if (logo.kind === 'svg' && logo.svg) {
    const clean = logo.svg.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '');
    return `<span class="logo"><img alt="logo" src="data:image/svg+xml;utf8,${encodeURIComponent(clean)}"/></span>`;
  }
  if (logo.kind === 'img' && logo.src) return `<span class="logo"><img alt="logo" src="${esc(logo.src)}"/></span>`;
  return '';
}

function cssFam(family: string): string {
  return /\s/.test(family) ? `"${esc(family)}", sans-serif` : `${esc(family)}, sans-serif`;
}
function otherMode(m: Mode): Mode {
  return m === 'light' ? 'dark' : 'light';
}
function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.hostname + url.pathname.replace(/.*\//, '/…/');
  } catch {
    return u;
  }
}
function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function style(): string {
  const light = '--bg:#f7f7f8;--panel:#ffffff;--ink:#17181c;--muted:#6b6d76;--line:#e7e7ec;--faint:#f0f0f3;--accent:#0d9488;--ok:#15803d;--warn:#b45309;--bad:#b91c1c;';
  const dark = '--bg:#0c0d10;--panel:#141519;--ink:#e9e9ee;--muted:#8a8c95;--line:#24262c;--faint:#1a1c21;--accent:#2dd4bf;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;';
  return `<style>
:root{${light}--mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color-scheme:light dark;}
@media(prefers-color-scheme:dark){:root{${dark}}}
:root[data-theme="light"]{${light}}
:root[data-theme="dark"]{${dark}}
*{box-sizing:border-box}
.report{max-width:1040px;margin:0 auto;padding:40px 24px 64px;font-family:var(--sans);color:var(--ink);background:var(--bg);line-height:1.5}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.dim{color:var(--muted)}.small{font-size:11px}.num{text-align:right}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
h1{font-size:34px;margin:2px 0 4px;letter-spacing:-.02em;text-wrap:balance}
h2{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 16px;font-weight:600}
.src{color:var(--muted);text-decoration:none;font-size:13px}.src:hover{color:var(--accent)}
.logo img{height:30px;width:auto;max-width:150px;display:block}
.brand-hero{position:relative;margin-top:4px;padding:44px 40px;border-radius:14px;background:var(--b-bg);color:var(--b-fg);border:1px solid var(--b-border);overflow:hidden}
.bh-top{display:flex;align-items:center;gap:14px;margin-bottom:20px}
.bh-eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--b-accent)}
.bh-name{font-family:var(--b-display);font-weight:var(--b-display-w);font-size:clamp(38px,7vw,68px);line-height:1.02;letter-spacing:-.02em;margin:0 0 10px;color:var(--b-fg);text-wrap:balance}
.bh-src{color:var(--b-fg2);text-decoration:none;font-size:14px}.bh-src:hover{color:var(--b-accent)}
.bh-cta{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:26px}
.bh-btn{background:var(--b-accent);color:var(--b-on-accent);padding:10px 20px;border-radius:9px;font-weight:600;font-size:14px}
.bh-btn.ghost{background:transparent;color:var(--b-fg);border:1px solid var(--b-accent)}
.bh-swatch{color:var(--b-accent);font-size:12px;padding:6px 11px;border:1px solid var(--b-accent);border-radius:999px}
.bh-sig{display:flex;align-items:center;gap:10px;margin-top:26px}
.bh-sig-band{height:18px;width:180px;border-radius:5px;display:block;border:1px solid rgba(128,128,128,.25)}
.bh-sig-label{font-size:10px;color:var(--b-fg2);letter-spacing:.1em;text-transform:uppercase}
.metabar{display:flex;flex-wrap:wrap;gap:12px 26px;padding:18px 6px 0}
.metabar>div{display:flex;flex-direction:column;gap:2px}
.mk{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.metabar .mono{font-size:15px}
.panel{margin-top:36px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:24px}
.mode-block{margin-bottom:16px}.mode-tag{font-size:11px;color:var(--muted);margin-bottom:8px}
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.sw{display:flex;align-items:center;gap:9px;padding:7px;border:1px solid var(--line);border-radius:7px}
.sw-chip{width:26px;height:26px;border-radius:5px;border:1px solid rgba(128,128,128,.28);flex:none}
.sw-chip.sm{width:16px;height:16px}
.sw-name{font-size:12px;flex:1}.sw-val{font-size:11px;color:var(--muted)}
.sub{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:18px 0 8px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.pchip{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border:1px solid var(--line);border-radius:999px;font-size:12px}
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th{text-align:left;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:0 10px 8px;font-weight:600}
.tbl td{padding:8px 10px;border-top:1px solid var(--line)}
.badge{display:inline-block;font-family:var(--mono);font-size:10px;padding:2px 6px;border-radius:4px;color:#fff}
.badge.ok{background:var(--ok)}.badge.warn{background:var(--warn)}.badge.bad{background:var(--bad)}
.spec{padding:14px 0;border-bottom:1px solid var(--line)}
.spec-head{display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:8px}
.spec-line{line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wladder{display:flex;flex-direction:column;gap:9px;margin-bottom:4px}
.wrow{display:flex;align-items:baseline;gap:14px}
.wrow .mono{width:34px;flex:none;font-size:11px}
.wsample{font-size:19px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hscale{display:flex;flex-direction:column;gap:8px}
.hrow{display:flex;align-items:baseline;gap:14px}
.hlvl{width:24px;flex:none}
.hsize{flex:1;line-height:1.05;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.files{margin:6px 0 0;padding-left:16px;font-size:11px;color:var(--muted)}
.bars{display:flex;flex-direction:column;gap:5px}
.bar{display:flex;align-items:center;gap:10px;font-size:11px}
.bar-fill{height:12px;background:var(--accent);border-radius:2px;opacity:.55;flex:none}
.rad{display:inline-flex;flex-direction:column;align-items:center;gap:5px;font-size:11px}
.rad-box{width:34px;height:34px;background:var(--faint);border:1.5px solid var(--accent)}
.shadows{display:flex;flex-wrap:wrap;gap:20px}
.shadow-box{width:78px;height:60px;background:var(--panel);border:1px solid var(--line);border-radius:8px;display:flex;align-items:flex-end;justify-content:flex-end;padding:5px;font-size:10px}
.grads{display:flex;flex-wrap:wrap;gap:12px}.grad{width:150px;height:64px;border-radius:8px;border:1px solid var(--line)}
.eases{display:flex;flex-wrap:wrap;gap:18px}
.ease{display:flex;flex-direction:column;gap:6px;font-size:11px}
.curve{background:var(--faint);border-radius:6px}
.curve .diag{stroke:var(--line);stroke-width:1.5}
.curve .cv{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linecap:round}
.spring{width:84px;height:84px;background:var(--faint);border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--accent);font-family:var(--mono);font-size:11px}
.foot{margin-top:36px;padding-top:18px;border-top:1px solid var(--line);display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}
@media(max-width:640px){.head{flex-direction:column}h1{font-size:26px}}
</style>`;
}
