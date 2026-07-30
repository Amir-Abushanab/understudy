/**
 * Report render test: a design model renders to self-contained HTML with the
 * expected sections and no injected scripts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BrandModel, LogoAsset } from '../brand/types.js';
import type { MotionModel } from '../analyze/model.js';
import type { DesignModel } from './design-model.js';
import { toBrandReport } from './report.js';

function design(logo?: LogoAsset): DesignModel {
  const motion: MotionModel = {
    meta: { source: 'https://example.com', capturedAt: 't', confidence: 0.8, passes: ['scroll'] },
    primitives: {
      duration: { base: { value: 240, provenance: 'measured' } },
      easing: { standard: { kind: 'bezier', control: [0, 0, 0.58, 1], provenance: 'measured' } },
      stagger: {},
    },
    semantic: {},
    choreography: [],
    personality: { archetype: 'premium', evidence: [] },
    observed: { samples: 100, rejected: 0, notes: '' },
  };
  const brand: BrandModel = {
    mode: 'light',
    colors: { light: { background: '#ffffff', surface: '#f5f5f5', text1: '#111111', text2: '#666666', accent: '#5b5bff', border: '#e5e5e5' } },
    accents: ['#5b5bff', '#22c55e'],
    states: { success: '#22c55e' },
    typography: {
      display: { family: 'Inter', size: 48, weight: 700, lineHeight: 1.1, letterSpacing: '0' },
      body: { family: 'Inter', size: 16, weight: 400, lineHeight: 1.5, letterSpacing: '0' },
      families: ['Inter'], scale: [16, 48], weights: [400, 700], fontFaces: [],
    },
    spacing: [0, 8, 16, 24], radii: [0, 8], borderWidths: [1], containers: [1200],
    shadows: ['0 1px 2px rgba(0,0,0,0.1)'], gradients: ['linear-gradient(135deg, #5b5bff, #22c55e)'],
    accessibility: { light: [{ pair: 'text1-on-background', ratio: 17.4, passes: ['AA-large', 'AA', 'AAA'] }] },
    provenance: { states: 'inferred' }, sampled: 100, challenged: false, confidence: 0.8,
    ...(logo ? { logo } : {}),
  };
  return { name: 'Test', source: 'https://example.com', capturedAt: 't', brand, motion };
}

test('report: renders the brand model as self-contained HTML', () => {
  const html = toBrandReport(design());
  assert.match(html, /<main class="report">/);
  assert.match(html, /Color/);
  assert.match(html, /Typography/);
  assert.match(html, /Motion/);
  assert.match(html, /#5b5bff/, 'accent swatch present');
  assert.match(html, /cubic-bezier\(0, 0, 0.58, 1\)/, 'easing rendered');
  assert.match(html, /AAA/, 'accessibility badges rendered');
});

test('report: meta bar has icons, percentage confidences, tooltips where they help, and cited provenance', () => {
  const html = toBrandReport(design());
  assert.match(html, /80%/, 'confidence rendered as a percentage, not a raw decimal');
  assert.match(html, /class="mi-ic"/, 'meta cells carry inline icons');
  assert.match(html, /class="mi tip"[^>]*data-tip="[^"]+"/, 'meta cells carry a tooltip hint');
  assert.match(html, /elements understudy read/i, 'the sampled count is explained');
  assert.match(
    html,
    /class="provenance"[\s\S]*measured live from[\s\S]*example\.com/i,
    'provenance cites the live source',
  );

  // A dual-mode brand: "dark + light" is self-evident, so the mode cell carries
  // no tooltip and there are fewer tooltips than cells.
  const themed = design();
  themed.brand.colors = {
    ...themed.brand.colors,
    dark: { background: '#0a0a0a', surface: '#161616', text1: '#f5f5f5', text2: '#aaaaaa', accent: '#5b5bff', border: '#222222' },
  };
  const themedHtml = toBrandReport(themed);
  const icons = (themedHtml.match(/class="mi-ic"/g) ?? []).length;
  const tips = (themedHtml.match(/data-tip="/g) ?? []).length;
  assert.ok(tips < icons, 'a self-evident dual-mode cell stays plain (no tooltip)');
});

test('report: individual colors, gradients, and settings are click-to-copy', () => {
  const html = toBrandReport(design());
  assert.match(html, /class="sw copyable color-cell"[^>]*data-copy-value="oklch\(/, 'a color swatch copies its color (OKLCH by default)');
  assert.match(html, /class="grad copyable color-cell"[^>]*data-copy-value="linear-gradient\(135deg, oklch\(/, 'a gradient copies its value with stops re-notated to OKLCH');
  assert.match(html, /data-copy-value="16px"/, 'a type-scale value copies');
  assert.match(html, /querySelectorAll\('\[data-copy-value\]'\)/, 'click-to-copy handler is wired');
});

test('report: colors default to OKLCH, with a header switch to hex/rgb/hsl', () => {
  const html = toBrandReport(design());
  // The accent #5b5bff (91,91,255) renders in OKLCH by default...
  assert.match(html, /class="sw-val mono color-val">oklch\(/, 'a swatch shows OKLCH by default');
  assert.match(html, /data-copy-value="oklch\(/, 'copy value defaults to OKLCH');
  // ...while carrying every notation for in-place re-notation.
  assert.match(html, /data-hex="#5b5bff"/, 'hex notation embedded on the cell');
  assert.match(html, /data-rgb="rgb\(91, 91, 255\)"/, 'rgb notation embedded on the cell');
  assert.match(html, /data-hsl="hsl\(/, 'hsl notation embedded on the cell');
  // The header switch, OKLCH active by default.
  assert.match(html, /data-set-cfmt="oklch"[^>]*aria-current="true"/, 'OKLCH is the active default');
  assert.match(html, /data-set-cfmt="hex"/, 'hex is a switch option');
  assert.match(html, /data-set-cfmt="rgb"/, 'rgb is a switch option');
  assert.match(html, /data-set-cfmt="hsl"/, 'hsl is a switch option');
  assert.match(html, /function setCfmt/, 're-notation handler is wired');
  // Gradients re-notate too: the band carries a stops-in-OKLCH variant, and each
  // stop is its own re-notating chip.
  assert.match(html, /class="grad copyable color-cell"[^>]*data-oklch="linear-gradient\(135deg, oklch\(/, 'gradient band has an OKLCH-stop variant');
  assert.match(html, /class="grad-stops"><div class="pchip copyable color-cell"/, 'gradient stops render as re-notating chips');
});

test('report: switcher slides via clip-path and copy feedback crossfades through blur', () => {
  const html = toBrandReport(design());
  // The notation switcher: a single accent thumb, moved by clip-path.
  assert.match(html, /<span class="cfmt-thumb" aria-hidden="true">/, 'switcher has a sliding thumb');
  assert.match(html, /function moveThumb/, 'thumb is repositioned on switch');
  assert.match(html, /thumb\.style\.clipPath='inset\(/, 'the thumb slides via clip-path');
  assert.match(html, /\.cfmt-ready \.cfmt-thumb\{transition:clip-path/, 'clip-path is transitioned');
  // Copy feedback: label swap and toast both crossfade through a blur.
  assert.match(html, /function swapLabel/, 'copy label swaps behind a blur');
  assert.match(html, /\.blurring\{opacity:0;filter:blur\(/, 'copy button blur crossfade CSS');
  assert.match(html, /\.copied-toast\{[^}]*filter:blur/, 'copied toast crossfades through blur');
  // Both honor reduced-motion.
  assert.match(html, /prefers-reduced-motion:reduce/, 'animations respect reduced-motion');
});

test('report: type specimens apply styling (single-quoted family) and easings are playable', () => {
  const d = design();
  d.brand.typography.display = { ...d.brand.typography.display, family: 'Mona Sans' };
  const html = toBrandReport(d);
  assert.match(html, /style="font-family:'Mona Sans'/, 'multi-word family is single-quoted so the inline style actually applies');
  assert.doesNotMatch(html, /style="font-family:"Mona Sans"/, 'no attribute-breaking double quotes');
  assert.match(html, /class="ease playable" data-ease="cubic-bezier/, 'a bezier easing is playable');
  assert.match(html, /class="ease-play"><span class="ease-dot">/, 'play track + dot rendered');
  assert.match(html, /dot\.animate/, 'play handler animates the dot with the easing');
});

test('report: a font on Google Fonts links to its specimen; unknown families stay plain', () => {
  const html = toBrandReport(design()); // fixture family is Inter, which is on Google Fonts
  assert.match(
    html,
    /<a class="fam-link" href="https:\/\/fonts\.google\.com\/specimen\/Inter"[^>]*target="_blank"[^>]*>Inter<span class="fam-ext"/,
    'a Google Fonts family links to its specimen, opening in a new tab',
  );
  assert.match(html, /\.fam-link\{/, 'font-link styling is present');

  const d = design();
  d.brand.typography.display = { ...d.brand.typography.display, family: 'Acme Private Sans' };
  d.brand.typography.body = { ...d.brand.typography.body, family: 'Acme Private Sans' };
  const plain = toBrandReport(d);
  assert.doesNotMatch(plain, /fam-link[^<]*Acme Private Sans/, 'a family not in any catalog is never linked');
});

test('report: the heading scale keeps the real size hierarchy (no flat clamp)', () => {
  const d = design();
  d.brand.typography.headings = { h1: { size: 64, weight: 700 }, h2: { size: 40, weight: 600 }, h3: { size: 22, weight: 600 } };
  const html = toBrandReport(d);
  // 64px and 40px must render at clearly different sizes -- they used to both
  // land at ~42px under the old Math.min(size, 42) clamp.
  assert.match(html, /class="hsize"[^>]*font-size:64px[^>]*>H1</, 'the largest heading renders at its true size');
  assert.match(html, /class="hsize"[^>]*font-size:40px[^>]*>H2</, 'a distinct mid heading stays distinct');
  assert.doesNotMatch(html, /class="hsize"[^>]*font-size:42px/, 'nothing collapses to the old 42px clamp');
  assert.match(html, />64px · w700</, 'labels still show the true measured px');

  // Oversized headings scale together to fit, preserving the ratio.
  d.brand.typography.headings = { h1: { size: 144, weight: 700 }, h2: { size: 72, weight: 600 } };
  const big = toBrandReport(d);
  assert.match(big, /class="hsize"[^>]*font-size:72px[^>]*>H1</, '144px caps at 72');
  assert.match(big, /class="hsize"[^>]*font-size:36px[^>]*>H2</, '72px scales to 36, keeping the 2:1 ratio');
  assert.match(big, /heading scale · scaled to fit/, 'discloses that the sample sizes were scaled');
});

test('report: a dual-mode brand gets a light/dark switch, one mode at a time', () => {
  const d = design();
  d.brand.colors = {
    ...d.brand.colors,
    dark: { background: '#0d1117', surface: '#161b22', text1: '#f0f6fc', text2: '#8b949e', accent: '#58a6ff', border: '#30363d' },
  };
  d.brand.accessibility = {
    ...d.brand.accessibility,
    dark: [{ pair: 'text1-on-background', ratio: 15, passes: ['AA-large', 'AA', 'AAA'] }],
  };
  const html = toBrandReport(d);
  assert.match(html, /<main class="report" data-brand-mode="light">/, 'report root carries the active brand mode');
  assert.match(html, /class="bh-mode"[\s\S]*?data-set-mode="light"[\s\S]*?data-set-mode="dark"/, 'hero has a light/dark switch');
  assert.match(html, /class="mode-block" data-mode="dark"/, 'palette blocks are mode-tagged for hiding');
  assert.match(html, /\[data-brand-mode="light"\] \[data-mode="dark"\]\{display:none\}/, 'CSS hides the inactive mode');
  assert.doesNotMatch(toBrandReport(design()), /data-set-mode="/, 'a single-mode brand has no switch button');
});

test('report: inlines an SVG logo so currentColor stays visible', () => {
  const html = toBrandReport(design({ kind: 'svg', svg: '<svg viewBox="0 0 10 10"><path fill="currentColor" d="M0 0h10v10H0z"/></svg>' }));
  assert.match(html, /<span class="logo"><svg/, 'SVG logo is inlined, not wrapped in an <img>');
  assert.doesNotMatch(html, /data:image\/svg\+xml/, 'no data-URI <img> that would collapse currentColor to black');
  // A fill-less monochrome logo (colored by the site's own CSS, which does not
  // travel) defaults to currentColor so it follows the hero foreground per mode.
  assert.match(html, /\.logo svg\{fill:currentColor\}/, 'inlined logo inherits the hero foreground');
});

test('report: inlines fonts and a raster logo from the assets map', () => {
  const d = design({ kind: 'img', src: 'https://cdn.example.com/logo.png' });
  d.brand.typography.fontFaces = [
    { family: 'Foo', src: 'https://cdn.example.com/foo.woff2', weight: '400', style: 'normal' },
  ];
  const assets = new Map([
    ['https://cdn.example.com/foo.woff2', 'data:font/woff2;base64,AAA'],
    ['https://cdn.example.com/logo.png', 'data:image/png;base64,BBB'],
  ]);
  const html = toBrandReport(d, { assets });
  assert.match(html, /src:url\("data:font\/woff2;base64,AAA"\)/, 'font inlined from the assets map');
  assert.match(html, /<img alt="logo" src="data:image\/png;base64,BBB"/, 'raster logo inlined from the assets map');
  assert.doesNotMatch(html, /cdn\.example\.com/, 'no external URL remains once assets cover them');

  // With no assets the report still renders, referencing the URLs (degrades, never breaks).
  assert.match(toBrandReport(d), /cdn\.example\.com\/foo\.woff2/, 'falls back to the URL without an assets map');
});

test('report: export panel — downloads, copy buttons, format picker, and highlighting', () => {
  const html = toBrandReport(design());
  assert.match(html, /<h2 class="mono">Export<\/h2>/, 'export panel present');
  assert.match(html, /download="tailwind\.config\.js"/, 'Tailwind download');
  assert.match(html, /download="brand\.css"/, 'CSS variables download');
  assert.match(html, /download="design-tokens\.json"/, 'DTCG download');
  assert.match(html, /href="data:text\/javascript;charset=utf-8,/, 'Tailwind is an inline data: download');
  // copy affordances
  assert.match(html, /data-copy="tailwind"/, 'per-format copy button');
  assert.match(html, /id="xport"[^>]*data-fmt="tailwind"/, 'top split-button');
  assert.match(html, /class="xport-menu"/, 'format dropdown');
  assert.match(html, /navigator\.clipboard/, 'clipboard copy script present');
  // syntax highlighting applied to the code blocks
  assert.match(html, /id="code-tailwind"/, 'code block has a stable id');
  assert.match(html, /class="h-key"/, 'keys highlighted');
  assert.match(html, /class="h-num"/, 'numbers highlighted');
});

test('report: strips scripts and on* handlers from an injected logo SVG', () => {
  const evil: LogoAsset = { kind: 'svg', svg: '<svg onload="alert(1)"><script>alert(2)</script><rect fill="#f00"/></svg>' };
  const html = toBrandReport(design(evil));
  // The report ships its own controlled copy/dropdown script, so assert the
  // INJECTED logo script and handler specifically are stripped.
  assert.ok(!/alert\(/.test(html), 'injected script body is stripped');
  assert.ok(!/onload=/i.test(html), 'injected inline handler is stripped');
  assert.ok(!/<script[^>]*>\s*alert/i.test(html), 'no logo-injected script survives');
});
