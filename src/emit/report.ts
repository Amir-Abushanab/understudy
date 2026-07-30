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
import { toBrandCss, toTailwindConfig, toDesignTokens } from './tokens.js';

const EMPTY_ASSETS: ReadonlyMap<string, string> = new Map();

/** Render the report. Pass `opts.assets` (a URL -> data: URI map from
 * collectReportAssets) to inline fonts and a raster logo for a self-contained,
 * CSP-safe page; without it the report references the assets by URL. */
export function toBrandReport(design: DesignModel, opts: { assets?: ReadonlyMap<string, string> } = {}): string {
  const { brand, motion } = design;
  const assets = opts.assets ?? EMPTY_ASSETS;
  // A dual-mode brand shows one mode at a time, switched via the hero control;
  // data-brand-mode drives the hero, palette, and accessibility display.
  const dual = Object.keys(brand.colors).length > 1;
  return [
    fontFaceStyle(brand, assets),
    style(),
    heroVarsCss(brand),
    `<main class="report"${dual ? ` data-brand-mode="${brand.mode}"` : ''}>`,
    brandHero(design, assets),
    metaBar(design),
    exportBar(),
    rationaleSection(design),
    palette(brand), accessibility(brand), typography(brand), scales(brand), elevation(brand), gradients(brand), motionSection(motion),
    exportsSection(design),
    footer(design),
    exportScript(),
    `</main>`,
  ].join('\n');
}

// --------------------------------------------------------------------------

/** The hero wears the captured brand: its background, accent, display font, and
 * logo, so the report opens by rendering the extraction as itself. */
function brandHero(design: DesignModel, assets: ReadonlyMap<string, string>): string {
  const { brand } = design;
  const c = brand.colors[brand.mode];
  if (!c) return '';
  const themed = Object.keys(brand.colors).length > 1;
  const logo = brand.logo ? logoMarkup(brand, assets) : '';
  const grad = brand.gradients[0]
    ? `<div class="bh-sig"><span class="bh-sig-band" style="background:${esc(brand.gradients[0])}"></span><span class="bh-sig-label mono">signature gradient${themed ? ' · theme-aware' : ''}</span></div>`
    : '';
  // The label style, rendered as the eyebrow when the brand has one.
  const eyebrow = brand.typography.label
    ? `<span class="bh-eyebrow" style="letter-spacing:${brand.typography.label.letterSpacing};${brand.typography.label.transform ? `text-transform:${brand.typography.label.transform}` : ''}">measured brand identity</span>`
    : `<span class="bh-eyebrow">measured brand identity</span>`;
  return `
<header class="brand-hero">
  <div class="bh-top"><div class="bh-brand">${logo}${eyebrow}</div>${modeSwitch(brand)}</div>
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

/** A light/dark switch for a dual-mode brand, wearing the brand's own colors.
 * Empty for a single-mode brand. */
function modeSwitch(brand: BrandModel): string {
  const has = brand.colors;
  if (Object.keys(has).length < 2) return '';
  const btn = (m: Mode): string =>
    has[m] ? `<button type="button" class="bh-mode-btn" data-set-mode="${m}"${m === brand.mode ? ' aria-current="true"' : ''}>${m}</button>` : '';
  return `<div class="bh-mode" role="group" aria-label="Brand color mode">${btn('light')}${btn('dark')}</div>`;
}

/** Hero brand variables as CSS. A single-mode brand's hero is fixed to its mode;
 * a dual-mode brand's hero follows the mode switch (data-brand-mode), so the whole
 * report shows one mode at a time rather than both stacked. */
function heroVarsCss(brand: BrandModel): string {
  const primary = brand.colors[brand.mode];
  if (!primary) return '';
  const disp = brand.typography.display;
  const vars = (c: ColorTokens): string =>
    `--b-bg:${c.background};--b-fg:${c.text1};--b-fg2:${c.text2};--b-accent:${c.accent};--b-on-accent:${readableText(c.accent)};--b-border:${c.border}`;
  const rules = [`.brand-hero{${vars(primary)};--b-display:${cssFam(disp.family)};--b-display-w:${disp.weight}}`];
  const { light, dark } = brand.colors;
  if (light && dark) {
    rules.push(`.report[data-brand-mode="light"] .brand-hero{${vars(light)}}`);
    rules.push(`.report[data-brand-mode="dark"] .brand-hero{${vars(dark)}}`);
  }
  return `<style>${rules.join('')}</style>`;
}

/** Neutral instrument meta strip below the brand hero. Each cell carries an icon,
 * a plain-language tooltip (dotted underline signals the hint), and cites where
 * the value comes from. Confidences read as percentages. */
function metaBar(design: DesignModel): string {
  const { brand, motion } = design;
  const themed = Object.keys(brand.colors).length > 1;
  const pct = (n: number): string => `${Math.round(n * 100)}%`;
  const from = host(design.source);
  const when = design.capturedAt.slice(0, 10);

  // Self-evident cells (mode, sampled) carry no tip and no underline; only the
  // metrics that genuinely need explaining do.
  const items: { icon: string; label: string; value: string; tip?: string; warn?: boolean }[] = [
    {
      icon: 'mode', label: 'mode',
      value: brand.mode + (themed ? ' + ' + otherMode(brand.mode) : ''),
      // Dual-mode ("dark + light") is self-evident. A single mode is not: explain
      // that both schemes were emulated and the site rendered the same in each.
      tip: themed
        ? undefined
        : `understudy emulated both light and dark, but ${from} renders the same under each, so it has a single ${brand.mode} mode. No separate light/dark theme was found on the page.`,
    },
    {
      icon: 'brand', label: 'brand conf',
      value: pct(brand.confidence),
      tip: `How sure understudy is about the extracted brand: how many elements it sampled, whether clear surface and text roles emerged, and internal cross-checks. 0 to 100%. Measured from ${from}.`,
    },
    {
      icon: 'motion', label: 'motion conf',
      value: pct(motion.meta.confidence),
      tip: `Confidence in the measured motion: sample count, how cleanly the timing curves fit, and agreement between the sampled motion and the page's declared CSS or WAAPI timing. 0 to 100%.`,
    },
    {
      icon: 'archetype', label: 'motion archetype',
      value: motion.personality.archetype,
      tip: `A personality label inferred from the measured motion (median duration, easing bias, any overshoot). Derived from measurement, not declared by the site.`,
    },
    {
      icon: 'sampled', label: 'sampled',
      value: brand.sampled.toLocaleString('en-US'),
      tip: `The number of distinct on-page elements understudy read computed styles from to build this model. More elements means a fuller, higher-confidence picture. Read live from ${from}.`,
    },
  ];
  if (brand.challenged) {
    items.push({
      icon: 'warning', label: 'warning', value: 'challenge page', warn: true,
      tip: `The site served a bot or challenge screen instead of real content, so this brand read is unreliable. Treat every value with suspicion.`,
    });
  }

  const cell = (m: (typeof items)[number]): string => {
    const attrs = m.tip ? ` class="mi tip" data-tip="${esc(m.tip)}" tabindex="0"` : ' class="mi"';
    return `<div${attrs}>` +
      `<span class="mk">${icon(m.icon)}<span>${m.label}</span></span>` +
      `<span class="mono mv${m.warn ? ' warnv' : ''}">${esc(m.value)}</span></div>`;
  };

  const source = `<a class="src" href="${esc(design.source)}">${esc(from)}</a>`;
  return `<div class="metabar">${items.map(cell).join('')}</div>
    <p class="provenance">Measured live from ${source} on ${esc(when)}. The Feel is synthesized from the cited sources.</p>`;
}

/** Small monoline instrument icons, inline so the report stays self-contained. */
function icon(name: string): string {
  const a = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  const svg = (inner: string): string => `<svg class="mi-ic" viewBox="0 0 24 24" ${a} aria-hidden="true">${inner}</svg>`;
  switch (name) {
    case 'mode':
      return svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 000-17z" fill="currentColor" stroke="none"/>');
    case 'brand':
      return svg('<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="12" cy="12" r="3.1" fill="currentColor" stroke="none"/>');
    case 'motion':
      return svg('<path d="M2.5 12h4l2.2-5.6L13 18.2l2.2-6.2H21.5"/>');
    case 'archetype':
      return svg('<path d="M4 4.5h6.4l9.1 9.1-6.4 6.4-9.1-9.1V4.5z"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/>');
    case 'sampled':
      return svg('<g fill="currentColor" stroke="none"><circle cx="7" cy="7" r="1.5"/><circle cx="12" cy="7" r="1.5"/><circle cx="17" cy="7" r="1.5"/><circle cx="7" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="17" cy="12" r="1.5"/><circle cx="7" cy="17" r="1.5"/><circle cx="12" cy="17" r="1.5"/><circle cx="17" cy="17" r="1.5"/></g>');
    case 'warning':
      return svg('<path d="M12 4.5L21 20H3L12 4.5z"/><path d="M12 10.5v4"/><circle cx="12" cy="17.4" r="0.6" fill="currentColor" stroke="none"/>');
    default:
      return '';
  }
}

function host(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
}

/** Inject @font-face for the brand fonts so the real face loads where the CSP
 * allows external URLs (local report file). In the sandboxed Artifact the CSP
 * blocks them and the fallback stack renders; harmless either way. */
function fontFaceStyle(brand: BrandModel, assets: ReadonlyMap<string, string>): string {
  const src = (u: string): string => assets.get(u) ?? u;
  const rules: string[] = [];
  const have = new Set<string>();
  for (const f of brand.typography.fontFaces) {
    if (!f.src || !f.family) continue;
    rules.push(`@font-face{font-family:"${f.family}";src:url("${src(f.src)}");font-weight:${f.weight};font-style:${f.style};font-display:swap}`);
    have.add(norm(f.family));
  }
  const files = brand.typography.fontFiles ?? [];
  for (const role of [brand.typography.display, brand.typography.body]) {
    const key = norm(role.family);
    if (have.has(key) || key.length < 4) continue;
    const token = key.slice(0, 5);
    const match = files.find((u) => norm(u).includes(token));
    if (match) {
      rules.push(`@font-face{font-family:"${role.family}";src:url("${src(match)}");font-weight:${role.weight};font-display:swap}`);
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

function rationaleSection(design: DesignModel): string {
  const r = design.rationale;
  if (!r) return '';
  const sources = r.sources ?? [];
  const cite = (i: number): string => `<a class="cite" href="${esc(sources[i]?.url ?? '#')}">[${i + 1}]</a>`;
  const principles = (r.principles ?? [])
    .map((p) => `<li>${esc(p.claim)} ${cite(p.source)}${p.quantified ? ' <span class="qtag mono">stated number</span>' : ''}</li>`)
    .join('');
  const constraints = (r.constraints ?? []).map((c) => `<li>${esc(c)}</li>`).join('');
  const divergences =
    r.divergences && r.divergences.length > 0
      ? `<div class="sub">divergences (documented vs measured)</div><table class="tbl"><tbody>${r.divergences
          .map((d) => `<tr><td class="mono">${esc(d.token)}</td><td class="mono">${esc(String(d.documented))}</td><td class="mono dim">measured ${esc(String(d.measured))}</td><td class="mono">${esc(d.resolution)}</td></tr>`)
          .join('')}</tbody></table>`
      : '';
  const srcList = sources
    .map((s, i) => `<li><span class="mono dim">[${i + 1}] tier ${s.tier}</span> <a href="${esc(s.url)}">${esc(s.title ?? shortUrl(s.url))}</a></li>`)
    .join('');
  return `<section class="panel feel">
    <h2 class="mono">Feel${r.archetype ? ` · ${esc(r.archetype)}` : ''}</h2>
    <p class="feel-summary">${esc(r.summary)}</p>
    ${r.voice ? `<p class="feel-voice"><span class="mono dim">voice</span> ${esc(r.voice)}</p>` : ''}
    ${principles ? `<div class="sub">principles</div><ul class="rlist">${principles}</ul>` : ''}
    ${constraints ? `<div class="sub">constraints (what it refuses to do)</div><ul class="rlist neg">${constraints}</ul>` : ''}
    ${divergences}
    ${srcList ? `<div class="sub">sources</div><ul class="rlist srcs">${srcList}</ul>` : ''}
  </section>`;
}

function palette(brand: BrandModel): string {
  const modes = Object.entries(brand.colors) as [Mode, ColorTokens][];
  const swatchRows = modes
    .map(([mode, c]) => {
      const roles = [
        ['background', c.background], ['surface', c.surface], ['text1', c.text1],
        ['text2', c.text2], ['accent', c.accent], ['border', c.border],
      ] as const;
      return `<div class="mode-block" data-mode="${mode}"><div class="mode-tag mono">${mode}</div><div class="swatches">${roles.map(([n, v]) => swatch(n, v)).join('')}</div></div>`;
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
        (ck) => `<tr data-mode="${mode}"><td class="mono dim">${mode}</td><td>${esc(ck.pair)}</td><td class="mono num">${ck.ratio.toFixed(2)}</td><td>${levelBadges(ck.passes)}</td></tr>`,
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

/** Design-token exports embedded in the page: Tailwind, CSS variables, and W3C
 * DTCG JSON, each downloadable via a data: URI (no JS) with the code viewable
 * inline. Same output as `understudy capture --tailwind / --css / --dtcg`. */
interface ExportFile { fmt: string; name: string; label: string; note: string; mime: string; code: string }

function exportFiles(design: DesignModel): ExportFile[] {
  return [
    { fmt: 'tailwind', name: 'tailwind.config.js', label: 'Tailwind', note: 'theme.extend', mime: 'text/javascript', code: toTailwindConfig(design) },
    { fmt: 'css', name: 'brand.css', label: 'CSS variables', note: ':root custom properties', mime: 'text/css', code: toBrandCss(design) },
    { fmt: 'dtcg', name: 'design-tokens.json', label: 'Design Tokens', note: 'W3C DTCG', mime: 'application/json', code: JSON.stringify(toDesignTokens(design), null, 2) },
  ];
}

function exportsSection(design: DesignModel): string {
  const block = (f: ExportFile): string => {
    const href = `data:${f.mime};charset=utf-8,${encodeURIComponent(f.code)}`;
    return `<div class="exp">
      <div class="exp-head"><span class="exp-name">${formatLogo(f.fmt)}${f.label} <span class="dim">${f.note}</span></span>` +
      `<span class="exp-actions"><button class="cp" type="button" data-copy="${f.fmt}" data-label="Copy">Copy</button>` +
      `<a class="dl mono" download="${esc(f.name)}" href="${href}">download</a></span></div>
      <details><summary class="mono dim small">view code</summary><pre id="code-${f.fmt}" class="code mono">${highlight(f.code)}</pre></details>
    </div>`;
  };
  return `<section class="panel"><h2 class="mono">Export</h2>
    <p class="dim small exp-intro">Design tokens generated from the measured model, ready to drop into a project. Same output as <span class="mono">understudy capture --tailwind / --css / --dtcg</span>.</p>
    <div class="exports">${exportFiles(design).map(block).join('')}</div></section>`;
}

/** A split-button at the top: copy the selected format, or pick another from the
 * dropdown (each shown with its logo). Reads the code from the Export panel's
 * <pre> blocks by id, so there is one source for the token text. */
function exportBar(): string {
  const items = [
    { fmt: 'tailwind', label: 'Tailwind' },
    { fmt: 'css', label: 'CSS variables' },
    { fmt: 'dtcg', label: 'W3C tokens' },
  ];
  const cur = items[0];
  return `<div class="xport" id="xport" data-fmt="${cur.fmt}">
    <button class="xport-copy" type="button" data-label="Copy tokens">Copy tokens</button>
    <button class="xport-toggle" type="button" aria-haspopup="menu" aria-label="Choose export format">
      <span class="xport-cur">${formatLogo(cur.fmt)}<span>${cur.label}</span></span>
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <div class="xport-menu" role="menu" hidden>
      ${items.map((i) => `<button type="button" role="menuitem" data-fmt="${i.fmt}"><span class="xport-lp">${formatLogo(i.fmt)}<span>${i.label}</span></span></button>`).join('')}
    </div>
  </div>`;
}

/** Recognizable inline-SVG marks for each export format (self-contained). */
function formatLogo(fmt: string): string {
  switch (fmt) {
    case 'tailwind':
      return `<svg class="flogo" viewBox="0 0 54 33" aria-hidden="true"><path fill="#38bdf8" d="M27 0c-7.2 0-11.7 3.6-13.5 10.8 2.7-3.6 5.85-4.95 9.45-4.05 2.05.51 3.52 2 5.15 3.65C30.74 13.09 33.81 16.2 40.5 16.2c7.2 0 11.7-3.6 13.5-10.8-2.7 3.6-5.85 4.95-9.45 4.05-2.05-.51-3.52-2-5.15-3.65C36.76 3.11 33.69 0 27 0zM13.5 16.2C6.3 16.2 1.8 19.8 0 27c2.7-3.6 5.85-4.95 9.45-4.05 2.05.51 3.52 2 5.15 3.65C17.24 29.29 20.31 32.4 27 32.4c7.2 0 11.7-3.6 13.5-10.8-2.7 3.6-5.85 4.95-9.45 4.05-2.05-.51-3.52-2-5.15-3.65C23.26 19.31 20.19 16.2 13.5 16.2z"/></svg>`;
    case 'css':
      return `<svg class="flogo" viewBox="0 0 32 32" aria-hidden="true"><path fill="#264de4" d="M6 3l2.15 24.1L16 29.5l7.86-2.4L26 3H6z"/><path fill="#2965f1" d="M16 5.2v22.6l6.35-1.94L24.1 5.2H16z"/><text x="16" y="20.5" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="12" font-weight="700" fill="#fff">3</text></svg>`;
    case 'dtcg':
    case 'w3c':
      return `<svg class="flogo" viewBox="0 0 46 22" aria-hidden="true"><text x="23" y="16.5" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="15" font-weight="800" letter-spacing="0.4" fill="currentColor">W3C</text></svg>`;
    default:
      return '';
  }
}

/** Single-pass tokenizer for the export code blocks (JSON, JS config, CSS). One
 * pass means a keyword inside a string is never mis-highlighted; escapes as it
 * goes so the output is safe HTML. */
function highlight(code: string): string {
  const re = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#[0-9a-fA-F]{3,8}\b)|(\b(?:true|false|null|export|default|module|exports)\b|:root)|(-?\d*\.?\d+(?:px|rem|em|%|vh|vw|deg|ms|s)?\b)|(--[A-Za-z0-9-]+|[A-Za-z_$][\w-]*)|([{}[\]()=;,:])/g;
  const key = (): boolean => /^\s*:/.test(code.slice(re.lastIndex));
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    out += esc(code.slice(last, m.index));
    let cls = 'h-pun';
    if (m[1]) cls = 'h-com';
    else if (m[2]) cls = key() ? 'h-key' : 'h-str';
    else if (m[3]) cls = 'h-color';
    else if (m[4]) cls = 'h-kw';
    else if (m[5]) cls = 'h-num';
    else if (m[6]) cls = key() ? 'h-key' : 'h-id';
    out += `<span class="${cls}">${esc(m[0])}</span>`;
    last = re.lastIndex;
  }
  out += esc(code.slice(last));
  return out;
}

/** The only script the report ships: clipboard copy (with a textarea fallback)
 * and the export dropdown. It reads token text from the Export panel's <pre>
 * blocks, so nothing is duplicated. */
function exportScript(): string {
  return `<script>(function(){
  function codeFor(f){var e=document.getElementById('code-'+f);return e?e.textContent:'';}
  function flash(b){if(!b)return;var t=b.getAttribute('data-label')||b.textContent;b.textContent='Copied';b.classList.add('ok');setTimeout(function(){b.textContent=t;b.classList.remove('ok');},1400);}
  function copy(text,b){function ok(){flash(b);}
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(ok,fb);}else{fb();}
    function fb(){var a=document.createElement('textarea');a.value=text;a.setAttribute('readonly','');a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();try{document.execCommand('copy');}catch(e){}document.body.removeChild(a);ok();}}
  document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){copy(codeFor(b.getAttribute('data-copy')),b);});});
  var root=document.getElementById('xport');
  if(root){var menu=root.querySelector('.xport-menu'),toggle=root.querySelector('.xport-toggle'),cp=root.querySelector('.xport-copy'),cur=root.querySelector('.xport-cur');
    toggle.addEventListener('click',function(e){e.stopPropagation();menu.hidden=!menu.hidden;});
    document.addEventListener('click',function(){menu.hidden=true;});
    menu.querySelectorAll('[data-fmt]').forEach(function(it){it.addEventListener('click',function(e){e.stopPropagation();root.setAttribute('data-fmt',it.getAttribute('data-fmt'));cur.innerHTML=it.querySelector('.xport-lp').innerHTML;menu.hidden=true;});});
    cp.addEventListener('click',function(){copy(codeFor(root.getAttribute('data-fmt')),cp);});}
  var report=document.querySelector('.report[data-brand-mode]');
  if(report){document.querySelectorAll('[data-set-mode]').forEach(function(b){b.addEventListener('click',function(){
    report.setAttribute('data-brand-mode',b.getAttribute('data-set-mode'));
    b.parentNode.querySelectorAll('[data-set-mode]').forEach(function(x){x.removeAttribute('aria-current');});
    b.setAttribute('aria-current','true');
  });});}
})();</script>`;
}

function footer(design: DesignModel): string {
  return `<footer class="foot"><span class="mono">measured by understudy</span><span class="mono dim">${esc(design.capturedAt)}</span></footer>`;
}

// --------------------------------------------------------------------------

function panel(title: string, body: string): string {
  return `<section class="panel"><h2 class="mono">${title}</h2>${body}</section>`;
}

function logoMarkup(brand: BrandModel, assets: ReadonlyMap<string, string>): string {
  const logo = brand.logo!;
  if (logo.kind === 'svg' && logo.svg) {
    // Inline the sanitized SVG rather than wrapping it in an <img>: an <img>
    // renders the SVG in isolation, where fill="currentColor" collapses to black
    // and vanishes on a dark hero. Inlined, currentColor follows the hero's
    // foreground (--b-fg) and stays visible in either theme.
    return `<span class="logo">${sanitizeSvg(logo.svg)}</span>`;
  }
  if (logo.kind === 'img' && logo.src) {
    return `<span class="logo"><img alt="logo" src="${esc(assets.get(logo.src) ?? logo.src)}"/></span>`;
  }
  return '';
}

/** Strip anything active or external from a captured SVG so it is safe to inline:
 * scripts, style and foreignObject blocks, event handlers, and non-internal refs. */
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\s(?:xlink:href|href)\s*=\s*"(?!#)[^"]*"/gi, '')
    .replace(/\s(?:xlink:href|href)\s*=\s*'(?!#)[^']*'/gi, '')
    .replace(/javascript:/gi, '');
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
  const light = '--bg:#f7f7f8;--panel:#ffffff;--ink:#17181c;--muted:#6b6d76;--line:#e7e7ec;--faint:#f0f0f3;--accent:#0d9488;--ok:#15803d;--warn:#b45309;--bad:#b91c1c;--h-com:#8a8c95;--h-str:#0a7d43;--h-key:#0b6e75;--h-num:#b4530a;--h-color:#8a3fb0;--h-kw:#2059c4;';
  const dark = '--bg:#0c0d10;--panel:#141519;--ink:#e9e9ee;--muted:#8a8c95;--line:#24262c;--faint:#1a1c21;--accent:#2dd4bf;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--h-com:#8a8c95;--h-str:#8fce9b;--h-key:#7fd0d0;--h-num:#e6a06a;--h-color:#cba0e0;--h-kw:#8fb4f0;';
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
.logo{display:inline-flex;color:var(--b-fg)}
.logo img,.logo svg{height:30px;width:auto;max-width:150px;display:block}
.logo svg{fill:currentColor}
.brand-hero{position:relative;margin-top:4px;padding:44px 40px;border-radius:14px;background:var(--b-bg);color:var(--b-fg);border:1px solid var(--b-border);overflow:hidden}
.bh-top{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:20px}
.bh-brand{display:inline-flex;align-items:center;gap:14px;min-width:0}
.bh-mode{display:inline-flex;gap:2px;padding:3px;border:1px solid var(--b-border);border-radius:8px;flex:none}
.bh-mode-btn{background:none;border:none;color:var(--b-fg2);font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.08em;cursor:pointer;padding:5px 12px;border-radius:6px}
.bh-mode-btn[aria-current="true"]{background:var(--b-accent);color:var(--b-on-accent)}
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
.metabar{display:flex;flex-wrap:wrap;gap:14px 30px;padding:20px 6px 0}
.mi{position:relative;display:flex;flex-direction:column;gap:3px}
.mk{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);display:inline-flex;align-items:center;gap:5px}
.mi-ic{width:13px;height:13px;flex:none;opacity:.9}
.metabar .mono{font-size:15px}
.mv{color:var(--ink);width:max-content}
.tip{cursor:help}
.tip .mv{border-bottom:1px dashed var(--muted);padding-bottom:1px}
.mv.warnv{color:var(--warn)}.tip .mv.warnv{border-bottom-color:var(--warn)}
.tip::after{content:attr(data-tip);position:absolute;left:0;top:calc(100% + 8px);z-index:30;width:max-content;max-width:270px;white-space:normal;text-align:left;background:var(--ink);color:var(--bg);font-family:var(--sans);font-size:11.5px;font-weight:400;line-height:1.45;letter-spacing:0;text-transform:none;padding:9px 11px;border-radius:7px;box-shadow:0 8px 24px rgba(0,0,0,.28);opacity:0;visibility:hidden;transform:translateY(-4px);transition:opacity .13s ease,transform .13s ease;pointer-events:none}
.tip:hover::after,.tip:focus-visible::after{opacity:1;visibility:visible;transform:translateY(0)}
.tip:focus-visible{outline:none}
.provenance{font-size:12px;color:var(--muted);margin:14px 6px 0;max-width:72ch;line-height:1.5}
.provenance .src{font-size:12px}
.panel{margin-top:36px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:24px}
.mode-block{margin-bottom:16px}.mode-tag{font-size:11px;color:var(--muted);margin-bottom:8px}
.report[data-brand-mode="light"] [data-mode="dark"]{display:none}
.report[data-brand-mode="dark"] [data-mode="light"]{display:none}
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
.feel-summary{font-size:19px;line-height:1.55;max-width:62ch;margin:0}
.feel-voice{font-size:13px;color:var(--muted);margin:12px 0 0}
.rlist{margin:6px 0 0;padding-left:20px;font-size:14px;line-height:1.6}
.rlist li{margin-bottom:5px}
.rlist.neg li::marker{content:"✕  ";color:var(--bad)}
.rlist.srcs{font-size:12px;color:var(--muted)}
.cite{color:var(--accent);text-decoration:none;font-size:11px;vertical-align:super}
.qtag{font-size:9px;color:var(--muted);border:1px solid var(--line);border-radius:3px;padding:1px 5px;margin-left:4px}
.foot{margin-top:36px;padding-top:18px;border-top:1px solid var(--line);display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}
.exp-intro{margin:0 0 16px}
.exports{display:flex;flex-direction:column;gap:12px}
.exp{border:1px solid var(--line);border-radius:8px;padding:12px 14px}
.exp-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px}
.exp-name{font-size:13px;font-weight:600}
.dl{font-size:12px;color:var(--accent);text-decoration:none;border:1px solid var(--accent);border-radius:6px;padding:5px 11px;white-space:nowrap}
.dl:hover{background:var(--accent);color:var(--panel)}
.exp details{margin-top:10px}
.exp summary{cursor:pointer;width:max-content}
.code{margin:10px 0 0;padding:12px;background:var(--faint);border-radius:6px;font-size:11.5px;line-height:1.5;overflow:auto;max-height:340px;white-space:pre}
.exp-name{display:inline-flex;align-items:center;gap:8px}
.exp-actions{display:flex;gap:8px;align-items:center;flex:none}
.cp{font-size:12px;font-family:var(--sans);color:var(--muted);background:none;border:1px solid var(--line);border-radius:6px;padding:5px 12px;cursor:pointer}
.cp:hover{border-color:var(--accent);color:var(--accent)}
.cp.ok{color:var(--ok);border-color:var(--ok)}
.flogo{height:15px;width:auto;flex:none;display:block}
.xport{position:relative;display:inline-flex;align-items:stretch;margin:20px 6px 0;border:1px solid var(--line);border-radius:9px;background:var(--panel)}
.xport-copy,.xport-toggle{background:none;border:none;color:var(--ink);font-family:var(--sans);font-size:13px;cursor:pointer;padding:9px 14px;display:inline-flex;align-items:center;gap:8px}
.xport-copy{font-weight:600;border-right:1px solid var(--line);border-radius:9px 0 0 9px}
.xport-copy:hover,.xport-toggle:hover{background:var(--faint)}
.xport-copy.ok{color:var(--ok)}
.xport-toggle{border-radius:0 9px 9px 0}
.xport-cur{display:inline-flex;align-items:center;gap:7px}
.chev{width:12px;height:12px;opacity:.55;flex:none}
.xport-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:40;min-width:200px;background:var(--panel);border:1px solid var(--line);border-radius:9px;box-shadow:0 10px 30px rgba(0,0,0,.22);padding:5px}
.xport-menu[hidden]{display:none}
.xport-menu button{display:flex;align-items:center;width:100%;background:none;border:none;color:var(--ink);font-family:var(--sans);font-size:13px;text-align:left;padding:8px 10px;border-radius:6px;cursor:pointer}
.xport-menu button:hover{background:var(--faint)}
.xport-lp{display:inline-flex;align-items:center;gap:9px}
.h-com{color:var(--h-com);font-style:italic}.h-str{color:var(--h-str)}.h-key{color:var(--h-key)}.h-num{color:var(--h-num)}.h-color{color:var(--h-color)}.h-kw{color:var(--h-kw)}.h-id{color:var(--ink)}.h-pun{color:var(--muted)}
@media(max-width:640px){.head{flex-direction:column}h1{font-size:26px}}
</style>`;
}
