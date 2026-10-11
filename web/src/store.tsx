import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { callBank, type BankData, type CardTier, type Result } from './nui';
import { play, type SoundName } from './sound';
import { makeT, type T } from './i18n';

interface BankCtx {
  data: BankData;
  cfg: BankData['config'];
  /**
   * Runs a bank callback; on success the returned data replaces local state.
   * Failures always buzz; pass `sound` for the success cue.
   */
  act: (event: string, payload: unknown, sound?: SoundName) => Promise<Result>;
  money: (n: number, opts?: { sign?: boolean }) => string;
  /** Translated UI string (config/locales/<code>.json -> "ui"). */
  t: T;
  /** Intl locale for numbers and dates, e.g. 'de-DE'. */
  locale: string;
  /** A card type's name: the server owner's, or the language file's. */
  tierName: (tier: CardTier) => string;
}

const Ctx = createContext<BankCtx | null>(null);

export function safeLocale(l?: string) {
  try {
    return Intl.NumberFormat.supportedLocalesOf(l ?? '').length ? l! : 'en-US';
  } catch {
    return 'en-US';
  }
}

/** Whole-unit currency formatter; "+" only when asked, "−" for negatives. */
export function moneyFormat(locale: string, currency = 'USD') {
  let f: Intl.NumberFormat;
  try {
    f = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 });
  } catch {
    // A typo'd currency code in config.lua shouldn't take the whole UI down.
    f = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  }
  return (n: number, opts?: { sign?: boolean }) => (opts?.sign && n > 0 ? '+' : n < 0 ? '−' : '') + f.format(Math.abs(n));
}

export function BankProvider({ data, setData, children }: { data: BankData; setData: (d: BankData) => void; children: ReactNode }) {
  const act = useCallback(
    async (event: string, payload: unknown, sound?: SoundName) => {
      const r = await callBank(event, payload);
      if (r.ok) {
        setData(r.data);
        if (sound) play(sound);
      } else play('error');
      return r;
    },
    [setData],
  );

  const currency = data.config.currency;
  const locale = safeLocale(data.config.locale);
  const money = useMemo(() => moneyFormat(locale, currency), [currency, locale]);

  const t = useMemo(() => makeT(data.ui), [data.ui]);
  const tierName = (tier: CardTier) => data.config.cards.tiers[tier].name.trim() || t('tier_' + tier);

  return <Ctx.Provider value={{ data, cfg: data.config, act, money, t, locale, tierName }}>{children}</Ctx.Provider>;
}

export function useBank() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useBank outside BankProvider');
  return c;
}

export const isIncoming = (type: string) => ['deposit', 'transfer_in', 'paycheck', 'interest', 'loan'].includes(type);

/** Strips everything but digits; keeps amounts as whole dollars like GTA money. */
export const parseAmount = (s: string) => Number(s.replace(/\D/g, '').slice(0, 9)) || 0;
