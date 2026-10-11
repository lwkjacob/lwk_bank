import { useEffect, useState, type FormEvent } from 'react';
import type { Card, CardTier } from '../nui';
import { useBank } from '../store';
import { HoldButton, Icon } from '../fx';
import { cardExpiry, cardLook, daysUntil } from '../logic';
import { Dialog, ErrorLine, Progress, SubmitButton, Toggle, useAction } from '../ui';
import { Card3D } from '../atm/Card3D';
import { AccountPills } from './Overview';
import type { SectionProps } from './Bank';

const TIERS: CardTier[] = ['standard', 'premium', 'gold'];

export function Cards({ active, accountId, setAccountId }: SectionProps) {
  const { data, cfg, t } = useBank();
  const [cardId, setCardId] = useState(data.cards[0]?.id);
  const [ordering, setOrdering] = useState(false);
  const card = data.cards.find((c) => c.id === cardId) ?? data.cards[0];

  useEffect(() => {
    if (card && card.id !== cardId) setCardId(card.id);
  }, [card, cardId]);

  // The 3D card itself is prebuilt at startup (card-stage.ts); mounting it only paints the
  // card face. Do that right away on a first visit, otherwise quietly after the bank opens,
  // then keep it and just pause it while another tab is in front.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) return;
    const go = () => setReady(true);
    if (active) return go();
    // Not during the ~1.5s opening animation.
    let idle = 0;
    const wait = setTimeout(() => (idle = requestIdleCallback(go, { timeout: 3000 })), 2000);
    return () => {
      clearTimeout(wait);
      cancelIdleCallback(idle);
    };
  }, [active, ready]);

  const activeCount = data.cards.filter((c) => c.status === 'active').length;
  const full = data.cards.length >= cfg.cards.maxCards;

  return (
    <div className="panel cards">
      <div className="cards-main">
        <div className="cards-stage" data-reveal>
          {card ? (
            ready ? <Card3D card={card} bankName={cfg.bankName} accent={cfg.accent} tiers={cfg.cards.tiers} running={active} /> : null
          ) : (
            <div className="empty-state">
              <Icon name="card" size={2} />
              <p>{t('no_cards')}</p>
            </div>
          )}
          <span className="mono muted cards-hint">{t('card_hint')}</span>
        </div>

        <div className="card-strip" data-reveal>
          {data.cards.map((c) => (
            <button key={c.id} className="card-chip" aria-pressed={c.id === card?.id} onClick={() => setCardId(c.id)}>
              <span className="card-swatch" style={cardLook(cfg.cards.tiers[c.tier]).style} aria-hidden="true" />
              <span className="mono">··{c.last4}</span>
              <span className={`dot is-${c.status}`} aria-label={t('status_' + c.status)} />
            </button>
          ))}
          <button className="card-chip card-chip-add" onClick={() => setOrdering(true)} disabled={full} title={full ? t('card_limit_reached', { count: cfg.cards.maxCards }) : undefined}>
            <Icon name="plus" /> {t('order_card')}
          </button>
        </div>
      </div>

      <aside className="cards-side">
        <div className="section-head" data-reveal>
          <span className="mono muted">
            {t('cards_count', { n: data.cards.length, max: cfg.cards.maxCards, active: activeCount, maxActive: cfg.cards.maxActive })}
          </span>
        </div>
        {card ? <CardDetails key={card.id} card={card} /> : <p className="empty-note">{t('cards_empty_note')}</p>}
      </aside>

      {ordering && <OrderDialog accountId={accountId} setAccountId={setAccountId} onClose={() => setOrdering(false)} />}
    </div>
  );
}

function CardDetails({ card }: { card: Card }) {
  const { data, cfg, money, t, tierName } = useBank();
  const { busy, error, run } = useAction();
  const [limit, setLimit] = useState(card.dailyLimit);
  const [pinOpen, setPinOpen] = useState(false);
  const acc = data.accounts.find((a) => a.id === card.accountId);
  const tierMax = cfg.cards.tiers[card.tier].dailyLimit;
  const days = daysUntil(card.expiresAt);
  const expiringSoon = days <= 14;

  useEffect(() => setLimit(card.dailyLimit), [card.dailyLimit]);

  return (
    <div className="card-details">
      <div className="card-title" data-reveal>
        <h2>
          {tierName(card.tier)} <span className="mono muted">·· {card.last4}</span>
        </h2>
        <span className={`badge is-${card.status}`}>{t('status_' + card.status)}</span>
      </div>
      <span className="mono muted" data-reveal>
        {acc?.name ?? t('unlinked')} · {card.holder}
      </span>

      {card.status === 'inactive' ? (
        <div className="callout" data-reveal>
          <p>{t('activate_hint')}</p>
          <button className="btn btn-primary" disabled={busy} onClick={() => run('cardActivate', { cardId: card.id }, 'chime')}>
            <Icon name="check" /> {t('activate_fee', { amount: money(cfg.cards.activationFee) })}
          </button>
        </div>
      ) : (
        <div className="kv" data-reveal>
          <div className="kv-row">
            <span className="mono muted">{t('spent_today')}</span>
            <span className="num">
              {money(card.spentToday)} <span className="muted">{t('of_amount', { amount: money(card.dailyLimit) })}</span>
            </span>
          </div>
          <Progress value={card.spentToday} max={card.dailyLimit} label={t('daily_spend')} tone={card.spentToday / card.dailyLimit > 0.85 ? 'warn' : undefined} />
        </div>
      )}

      {cfg.features.customCardLimits && (
        <div className="kv" data-reveal>
          <label className="kv-row" htmlFor={`limit-${card.id}`}>
            <span className="mono muted">{t('daily_limit')}</span>
            <span className="num">{money(limit)}</span>
          </label>
          <input
            id={`limit-${card.id}`}
            type="range"
            className="range"
            min={0}
            max={tierMax}
            step={Math.max(100, Math.round(tierMax / 100 / 100) * 100)}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          />
          {limit !== card.dailyLimit && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run('cardLimit', { cardId: card.id, limit }, 'chime')}>
              {t('save_limit')}
            </button>
          )}
        </div>
      )}

      <div className="kv" data-reveal>
        <div className="kv-row">
          <span className="mono muted">{t('expires')}</span>
          <span className={expiringSoon ? 'is-warn' : ''}>
            {cardExpiry(card.expiresAt)} · {days > 0 ? t('days_left', { count: days }) : t('expired')}
          </span>
        </div>
        <div className="kv-actions">
          <Toggle checked={card.autoRenew} label={t('auto_renew')} disabled={busy} onChange={(v) => run('cardAutoRenew', { cardId: card.id, enabled: v })} />
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run('cardRenew', { cardId: card.id }, 'chime')}>
            {t('renew_fee', { amount: money(cfg.cards.renewalFee) })}
          </button>
        </div>
      </div>

      <div className="kv-actions" data-reveal>
        {card.status !== 'inactive' && (
          <Toggle checked={card.status === 'blocked'} label={t('freeze_card')} disabled={busy} onChange={(v) => run('cardBlock', { cardId: card.id, blocked: v })} />
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => setPinOpen(true)}>
          <Icon name="lock" size={1} /> {t('change_pin')}
        </button>
      </div>

      <ErrorLine error={error} />

      <div className="card-danger" data-reveal>
        <HoldButton label={t('destroy_card')} onConfirm={() => run('cardDelete', { cardId: card.id })} disabled={busy} variant="danger" />
      </div>

      {pinOpen && <PinDialog card={card} onClose={() => setPinOpen(false)} />}
    </div>
  );
}

function PinDialog({ card, onClose }: { card: Card; onClose: () => void }) {
  const { t } = useBank();
  const { busy, error, setError, run } = useAction();
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const digits = (s: string) => s.replace(/\D/g, '').slice(0, 4);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pin !== again) return setError(t('err_pin_mismatch'));
    const r = await run('cardPin', { cardId: card.id, pin }, 'chime');
    if (r.ok) onClose();
  };

  return (
    <Dialog title={t('new_pin_title', { last4: card.last4 })} onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        <label className="field">
          <span className="mono muted">{t('new_pin')}</span>
          <input autoFocus className="input input-lg mono pin-input" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(digits(e.target.value))} />
        </label>
        <label className="field">
          <span className="mono muted">{t('repeat_pin')}</span>
          <input className="input input-lg mono pin-input" type="password" inputMode="numeric" value={again} onChange={(e) => setAgain(digits(e.target.value))} />
        </label>
        <ErrorLine error={error} />
        <SubmitButton busy={busy} disabled={pin.length !== 4 || again.length !== 4} icon="lock">
          {t('set_pin')}
        </SubmitButton>
      </form>
    </Dialog>
  );
}

function OrderDialog({ accountId, setAccountId, onClose }: Pick<SectionProps, 'accountId' | 'setAccountId'> & { onClose: () => void }) {
  const { cfg, money, t, tierName } = useBank();
  const { busy, error, run } = useAction();
  const [tier, setTier] = useState<CardTier>('standard');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run('cardOrder', { accountId, tier }, 'printer');
    if (r.ok) onClose();
  };

  return (
    <Dialog title={t('order_a_card')} onClose={onClose} wide>
      <form className="dialog-form" onSubmit={submit}>
        <span className="mono muted">{t('linked_account')}</span>
        <AccountPills accountId={accountId} setAccountId={setAccountId} />
        <div className="tier-grid" role="radiogroup" aria-label={t('card_type')}>
          {TIERS.map((k) => {
            const look = cardLook(cfg.cards.tiers[k]);
            return (
              <button key={k} type="button" role="radio" aria-checked={tier === k} className="tier-opt" onClick={() => setTier(k)}>
                <span className="tier-face" style={look.style} aria-hidden="true">
                  {!look.hideText && <span className="mono">{cfg.bankName}</span>}
                </span>
                <strong>{tierName(k)}</strong>
                <span className="mono muted">{t('per_day', { amount: money(cfg.cards.tiers[k].dailyLimit) })}</span>
                <span className="num">{money(cfg.cards.tiers[k].fee)}</span>
              </button>
            );
          })}
        </div>
        <p className="muted small">
          {t('order_note', { days: cfg.cards.validDays, amount: money(cfg.cards.activationFee) })}
        </p>
        <ErrorLine error={error} />
        <SubmitButton busy={busy} icon="card">
          {t('order_tier', { tier: tierName(tier), amount: money(cfg.cards.tiers[tier].fee) })}
        </SubmitButton>
      </form>
    </Dialog>
  );
}
