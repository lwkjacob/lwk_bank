import { useEffect, useRef, useState, type FormEvent } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { fetchNui, type Card } from '../nui';
import { parseAmount, useBank } from '../store';
import { Brand, CountUp, Icon, Scramble } from '../fx';
import { Card3D, type Card3DHandle } from './Card3D';
import { play } from '../sound';
import { cardLook } from '../logic';

type Step = 'card' | 'pin' | 'menu';
const QUICK = [100, 200, 500, 1_000, 2_500];

export function Atm({ onClose }: { onClose: () => void }) {
  const { data, t } = useBank();
  const root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>('card');
  const [cardId, setCardId] = useState(data.cards.find((c) => c.status === 'active')?.id ?? data.cards[0]?.id);
  const card = data.cards.find((c) => c.id === cardId);

  useGSAP(
    () => {
      gsap.fromTo('[data-step] [data-in]', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.7, stagger: 0.05, ease: 'power3.out', delay: step === 'card' ? 0.5 : 0.1, overwrite: true, clearProps: 'opacity,transform' });
    },
    { scope: root, dependencies: [step] },
  );

  return (
    <div ref={root} className="atm">
      <header className="hud hud-top">
        <Brand name={data.config.bankName} suffix={t('atm_suffix')} />

        <div className="mono muted" data-hud>
          <Scramble text={t(step === 'card' ? 'atm_select_card' : step === 'pin' ? 'atm_verify_pin' : 'atm_menu')} key={step} />
        </div>
        <button className="mono esc" onClick={onClose} data-hud>
          <kbd>Esc</kbd> {t(step === 'card' ? 'close' : 'eject_card')}
        </button>
      </header>

      <div className="atm-shell" data-stage>
        {!card ? (
          <div className="atm-empty" data-step>
            <Icon name="card" size={2.5} />
            <h2 data-in>{t('no_bank_card')}</h2>
            <p className="muted" data-in>
              {t('need_card', { bank: data.config.bankName })}
            </p>
            <div data-in>
              <button className="btn btn-ghost" onClick={onClose}>
                {t('close')}
              </button>
            </div>
          </div>
        ) : step === 'card' ? (
          <CardStep cards={data.cards} card={card} setCardId={setCardId} onInserted={() => setStep('pin')} />
        ) : step === 'pin' ? (
          <PinStep card={card} onOk={() => setStep('menu')} />
        ) : (
          <MenuStep card={card} onDone={() => (play('cardOut'), onClose())} />
        )}
      </div>
    </div>
  );
}

/* ---------- 1. choose + insert card ---------- */

function CardStep({ cards, card, setCardId, onInserted }: { cards: Card[]; card: Card; setCardId: (id: string) => void; onInserted: () => void }) {
  const { data, t } = useBank();
  const card3d = useRef<Card3DHandle>(null);
  const [inserting, setInserting] = useState(false);
  const blocked = card.status !== 'active';

  const insert = async () => {
    setInserting(true);
    play('cardIn');
    await card3d.current?.insert();
    onInserted();
  };

  return (
    <div className="atm-card" data-step>
      <div className="atm-stage">
        <Card3D ref={card3d} card={card} bankName={data.config.bankName} accent={data.config.accent} tiers={data.config.cards.tiers} />
        <div className={`slot-line ${inserting ? 'is-hot' : ''}`} aria-hidden="true" />
        <span className="mono muted atm-hint">{t('card_hint')}</span>
      </div>

      <div className="atm-side">
        <h2 className="atm-title" data-in>
          {t('insert_your_card')}
        </h2>
        <ul className="card-list" data-in>
          {cards.map((c) => {
            const acc = data.accounts.find((a) => a.id === c.accountId);
            return (
              <li key={c.id}>
                <button className="card-row" aria-pressed={c.id === card.id} disabled={inserting} onClick={() => setCardId(c.id)}>
                  <span className="card-swatch" style={cardLook(data.config.cards.tiers[c.tier]).style} aria-hidden="true" />
                  <span className="card-row-main">
                    <span>
                      {t('tier_' + c.tier)} · •• {c.last4}
                    </span>
                    <span className="mono muted">{acc?.name ?? t('unlinked')}</span>
                  </span>
                  {c.status !== 'active' && <span className="badge-blocked mono">{t('status_' + c.status)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="atm-actions" data-in>
          {blocked && (
            <p className="error-text">
              <Icon name="alert" size={1} /> {t(card.status === 'blocked' ? 'card_frozen_hint' : 'card_inactive_hint')}
            </p>
          )}
          <button className="btn btn-primary btn-block" disabled={blocked || inserting} onClick={insert}>
            <Icon name="card" /> {t(inserting ? 'reading_card' : 'insert_card')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 2. PIN ---------- */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

function PinStep({ card, onOk }: { card: Card; onOk: () => void }) {
  const { t } = useBank();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dots = useRef<HTMLDivElement>(null);
  const okRef = useRef(onOk);
  okRef.current = onOk;

  const press = (k: string) => {
    if (busy) return;
    // Played here, not on pointerdown, so typed digits beep too.
    play('keypad');
    setError('');
    if (k === 'clear') return setPin('');
    if (k === 'back') return setPin((p) => p.slice(0, -1));
    setPin((p) => (p.length < 4 ? p + k : p));
  };

  useEffect(() => {
    if (pin.length !== 4) return;
    let live = true;
    setBusy(true);
    fetchNui<{ ok: boolean; error?: string }>('verifyPin', { cardId: card.id, pin })
      .catch(() => ({ ok: false, error: t('card_reader_error') }))
      .then((r) => {
        if (!live) return;
        setBusy(false);
        if (r.ok) return okRef.current();
        setError(r.error ?? t('incorrect_pin'));
        setPin('');
        gsap.fromTo(dots.current, { x: -12 }, { x: 0, duration: 0.6, ease: 'elastic.out(1.2, 0.25)' });
      });
    return () => {
      live = false;
    };
  }, [pin, card.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      if (e.key === 'Backspace') press('back');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="atm-pin" data-step>
      <div className="pin-info">
        <span className="mono muted" data-in>
          {t('card_last4', { last4: card.last4 })}
        </span>
        <h2 className="atm-title" data-in>
          {t('enter_pin')}
        </h2>
        <div ref={dots} className="pin-dots" data-in role="status" aria-label={t('pin_progress', { count: pin.length })}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={i < pin.length ? 'is-on' : ''} />
          ))}
        </div>
        <p className="error-text" role="alert" data-in>
          {error && <Icon name="alert" size={1} />} {busy ? t('checking_pin') : error}
        </p>
        <span className="mono muted" data-in>
          {t('shield_keypad')}
        </span>
      </div>
      <div className="keypad" data-in>
        {KEYS.map((k) => (
          <button key={k} className={`key ${k.length > 1 ? 'key-fn' : ''}`} onClick={() => press(k)} disabled={busy} data-sound="none" aria-label={k === 'back' ? t('delete_digit') : k === 'clear' ? t('clear_pin') : k}>
            {k === 'back' ? <Icon name="left" /> : k === 'clear' ? <span className="mono">{t('clr')}</span> : k}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- 3. withdraw / deposit ---------- */

function MenuStep({ card, onDone }: { card: Card; onDone: () => void }) {
  const { data, act, money, t, locale } = useBank();
  const acc = data.accounts.find((a) => a.id === card.accountId);
  const [mode, setMode] = useState<'withdraw' | 'deposit'>('withdraw');
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cash, setCash] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (cash === null) return;
      gsap
        .timeline({ onComplete: () => setCash(null) })
        .from('.bill', { yPercent: -110, duration: 0.7, stagger: 0.09, ease: 'power3.out' })
        .from('.dispense [data-in]', { opacity: 0, y: 12, stagger: 0.06, duration: 0.5 }, 0.2)
        .to('.dispense', { opacity: 0, duration: 0.4 }, '+=1.6');
    },
    { scope: root, dependencies: [cash] },
  );

  if (!acc) return <div className="atm-empty">{t('card_not_linked')}</div>;

  const max = mode === 'withdraw' ? acc.balance : data.player.cash;
  const amount = parseAmount(raw);

  const run = async (value: number) => {
    if (!value || value > max || busy) return;
    setBusy(true);
    setError('');
    const r = await act(mode, { accountId: acc.id, amount: value, atm: true }, 'counter');
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setRaw('');
    if (mode === 'withdraw') setCash(value);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(amount);
  };

  return (
    <div ref={root} className="atm-menu" data-step>
      <div className="atm-bal">
        <span className="mono muted" data-in>
          {acc.name} · •• {card.last4}
        </span>
        <CountUp value={acc.balance} format={money} className="balance-xl" />
        <span className="muted" data-in>
          {t('cash_on_hand')} <strong className="num">{money(data.player.cash)}</strong>
        </span>
        {/* GSAP animates the wrapper: .btn's own CSS transitions would fight the tween. */}
        <div className="atm-done" data-in>
          <button className="btn btn-ghost" onClick={onDone}>
            <Icon name="card" /> {t('take_card_finish')}
          </button>
        </div>
      </div>

      <div className="atm-ops" data-in>
        <div className="seg" role="tablist" aria-label={t('operation')}>
          {(['withdraw', 'deposit'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setError('');
                setRaw('');
              }}
            >
              {t(m)}
            </button>
          ))}
        </div>

        <div className="quick-grid">
          {QUICK.map((q) => (
            <button key={q} className="quick" disabled={busy || q > max} onClick={() => run(q)}>
              <span className="num">{money(q)}</span>
            </button>
          ))}
          <button className="quick quick-max" disabled={busy || max <= 0} onClick={() => run(max)}>
            <span className="mono">{t('all')}</span>
            <span className="num">{money(max)}</span>
          </button>
        </div>

        <form className="other" onSubmit={submit}>
          <label className="search">
            <span className="sr-only">{t('other_amount')}</span>
            <span className="other-prefix" aria-hidden="true">
              {money(0).replace(/[\d\s.,]/g, '')}
            </span>
            <input className="input" inputMode="numeric" placeholder={t('other_amount')} value={amount ? amount.toLocaleString(locale) : ''} onChange={(e) => setRaw(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={!amount || amount > max || busy} aria-busy={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name={mode === 'withdraw' ? 'out' : 'in'} />}
            {t(mode)}
          </button>
        </form>
        <p className="error-text" role="alert">
          {(error || amount > max) && <Icon name="alert" size={1} />}
          {amount > max ? (mode === 'withdraw' ? t('err_not_enough') : t('err_only_cash', { amount: money(max) })) : error}
        </p>
      </div>

      {cash !== null && (
        <div className="dispense" role="status">
          <div className="dispense-slot" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="bill" style={{ ['--r' as string]: `${(i - 2) * 3}deg` }}>
                <span>$</span>
              </span>
            ))}
          </div>
          <span className="mono muted" data-in>
            {t('take_your_cash')}
          </span>
          <span className="dispense-amount num" data-in>
            {money(cash)}
          </span>
        </div>
      )}
    </div>
  );
}
