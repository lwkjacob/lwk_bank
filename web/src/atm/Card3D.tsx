import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { BankConfig, Card } from '../nui';
import { cardLook } from '../logic';
import type { CardScene } from './card-scene';
import { cardStage } from './card-stage';

export interface Card3DHandle {
  insert: () => Promise<void>;
}

/** Click to flip, move the pointer to tilt. Borrows the card canvas prebuilt at startup. */
export const Card3D = forwardRef<Card3DHandle, { card: Card; bankName: string; accent: string; tiers: BankConfig['cards']['tiers']; running?: boolean }>(function Card3D({ card, bankName, accent, tiers, running = true }, ref) {
  const holder = useRef<HTMLDivElement>(null);
  const scene = useRef<CardScene | null>(null);
  // Repaint when the card or anything printed on it changes (e.g. a renewal moves the expiry).
  const face = `${card.id}:${card.expiresAt}:${card.holder}`;
  const shown = useRef(face);
  const [failed, setFailed] = useState(false);
  const latest = useRef({ card, bankName, accent, tiers, running });
  latest.current = { card, bankName, accent, tiers, running };
  const look = cardLook(tiers[card.tier]);

  useEffect(() => {
    let dead = false;
    let canvas: HTMLCanvasElement | null = null;
    cardStage()
      .then((s) => {
        if (dead) return;
        const l = latest.current;
        canvas = s.canvas;
        canvas.onclick = () => s.scene.flip();
        canvas.setAttribute('role', 'img');
        holder.current!.appendChild(canvas);
        s.scene.show(l.card, l.bankName, l.accent, l.tiers);
        s.scene.setRunning(l.running);
        shown.current = `${l.card.id}:${l.card.expiresAt}:${l.card.holder}`;
        scene.current = s.scene;
      })
      .catch(() => !dead && setFailed(true));
    return () => {
      dead = true;
      // Hand the canvas back: stop drawing and detach. The GL context stays alive for next time.
      scene.current?.setRunning(false);
      canvas?.remove();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.setRunning(running);
  }, [running]);

  useEffect(() => {
    if (scene.current && shown.current !== face) scene.current.setCard(card);
    shown.current = face;
  }, [face, card]);

  useEffect(() => {
    holder.current?.querySelector('canvas')?.setAttribute('aria-label', `${tiers[card.tier].name || card.tier} card ending ${card.last4}. Click to flip.`);
  });

  useImperativeHandle(ref, () => ({ insert: () => scene.current?.insert() ?? Promise.resolve() }), []);

  return (
    <div className="card3d" ref={holder}>
      {failed && (
        // WebGL unavailable: flat fallback so the ATM still works.
        <div className="card-flat" style={look.style}>
          {!look.hideText && <span>{bankName}</span>}
          {!look.hideText && <span className="mono">•••• {card.last4}</span>}
        </div>
      )}
    </div>
  );
});
