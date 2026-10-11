import { DEFAULT_CONFIG, type Card } from '../nui';
import type { CardScene } from './card-scene';

/* The 3D card's expensive parts (three.js download/parse, WebGL context, lighting
 * environment, shader compiles) happen once, when the UI page loads: in FiveM that's
 * the loading screen. Card3D then borrows the ready canvas instead of building one. */

export interface CardStage {
  canvas: HTMLCanvasElement;
  scene: CardScene;
}

// Drawn once so the first real card only repaints the face. Never shown.
const PLACEHOLDER: Card = {
  id: 'warmup', accountId: '', tier: 'standard', last4: '0000', holder: 'Card Holder',
  expiresAt: 0, status: 'active', dailyLimit: 0, spentToday: 0, autoRenew: false,
};

let stage: Promise<CardStage> | null = null;

export function cardStage(): Promise<CardStage> {
  stage ??= import('./card-scene').then(async ({ createCardScene }) => {
    const canvas = document.createElement('canvas');
    const scene = await createCardScene(canvas, PLACEHOLDER, '', '#c8f031', DEFAULT_CONFIG.cards.tiers);
    scene.setRunning(false);
    return { canvas, scene };
  });
  return stage;
}
