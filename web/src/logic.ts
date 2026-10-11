import type { BankConfig, CreditBand, TierConfig } from './nui';

/* Pure helpers: no React, no DOM. Checked by logic.check.ts. */

export function creditBand(score: number, bands: CreditBand[]): CreditBand & { index: number } {
  let index = 0;
  bands.forEach((b, i) => score >= b.min && (index = i));
  return { ...bands[index], index };
}

export interface LoanQuote {
  rate: number;
  interest: number;
  total: number;
  daily: number;
}

/** Simple interest over the whole term, paid in equal daily instalments. */
export function quoteLoan(amount: number, planRate: number, termDays: number, adjust: number): LoanQuote {
  const rate = Math.max(0, planRate + adjust);
  const interest = Math.round((amount * rate) / 100);
  const total = amount + interest;
  return { rate, interest, total, daily: Math.ceil(total / Math.max(termDays, 1)) };
}

export function borrowLimit(totalBalance: number, cfg: BankConfig['loans']) {
  return Math.max(0, Math.floor(totalBalance * cfg.balanceMultiplier));
}

/* ---------- branding: one accent hex -> every token the CSS needs ---------- */

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

const luminance = ([r, g, b]: number[]) => {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

export function accentTokens(hex: string): Record<string, string> | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const mix = (t: number) => rgb.map((v) => Math.round(v + (255 - v) * t)).join(', ');
  // Dark ink on bright accents, light ink on dark ones.
  const ink = luminance(rgb) > 0.35 ? '#0b0d06' : '#f4f6f2';
  return {
    '--accent': `rgb(${r}, ${g}, ${b})`,
    '--accent-hover': `rgb(${mix(0.25)})`,
    '--accent-dim': `rgba(${r}, ${g}, ${b}, 0.14)`,
    '--accent-grid': `rgba(${r}, ${g}, ${b}, 0.16)`,
    '--accent-ink': ink,
  };
}

/* ---------- card look: one colour, or a picture, per tier ---------- */

export interface CardLook {
  /** Gradient, top left to bottom right. */
  bg: [string, string];
  ink: string;
  edge: string;
  bright: boolean;
  /** URL of the front picture, or ''. */
  image: string;
  hideText: boolean;
  /** For the flat previews (swatches, order dialog). */
  style: { background: string; color: string };
}

export function cardLook(tier: Pick<TierConfig, 'cardColor' | 'image' | 'hideText'>): CardLook {
  const rgb = hexToRgb(tier.cardColor) ?? [48, 52, 47];
  const bright = luminance(rgb) > 0.35;
  const shade = (k: number) => `rgb(${rgb.map((v) => Math.round(v * k)).join(', ')})`;
  // Bright cards fade less, or gold turns to mud.
  const bg: [string, string] = [shade(1), shade(bright ? 0.6 : 0.4)];
  const ink = bright ? '#1d1607' : '#eceeea';
  // A bare file name is in the resource's images/ folder, two levels up from web/dist/.
  const image = /^https:\/\//.test(tier.image) ? tier.image : tier.image && `../../images/${tier.image}`;
  return {
    bg,
    ink,
    edge: shade(bright ? 0.7 : 0.5),
    bright,
    image,
    hideText: !!image && tier.hideText,
    style: { background: image ? `center / cover url("${image}")` : `linear-gradient(135deg, ${bg[0]}, ${bg[1]})`, color: ink },
  };
}

/* ---------- formatting ---------- */

export const cardExpiry = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
};

const DAY = 86_400_000;
export const daysUntil = (ms: number) => Math.ceil((ms - Date.now()) / DAY);

export function timeUntil(ms: number) {
  const diff = ms - Date.now();
  if (diff <= 0) return 'now';
  const h = Math.floor(diff / 3_600_000);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${Math.floor((diff % 3_600_000) / 60_000)}m`;
}
