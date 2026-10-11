import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import gsap from 'gsap';
import type { BankConfig, Card } from '../nui';
import { cardExpiry, cardLook, type CardLook } from '../logic';

/* One WebGL card, built once while the UI loads (see card-stage.ts) and reused by the
 * Cards tab and the ATM. It only renders while one of them is on screen. */

const W = 3.37; // ISO card, 85.6 x 54 mm
const H = 2.125;
const D = 0.035;
const R = 0.16;

type Tiers = BankConfig['cards']['tiers'];

// Colours come from the config (cardLook); how metallic each tier shines stays fixed.
const METAL = { standard: 0.2, premium: 0.35, gold: 0.75 } as const;

// Tier pictures, loaded once. One that fails (missing file, a host without CORS headers)
// resolves to null and the card keeps its colour.
const art = new Map<string, Promise<HTMLImageElement | null>>();
function loadArt(src: string) {
  let p = art.get(src);
  if (!p) {
    p = new Promise((done) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // WebGL refuses a texture drawn from a tainted canvas
      img.onload = () => done(img);
      img.onerror = () => done(null);
      img.src = src;
    });
    art.set(src, p);
  }
  return p;
}

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function faceGeometry(shape: THREE.Shape) {
  const g = new THREE.ShapeGeometry(shape, 12);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + W / 2) / W, (pos.getY(i) + H / 2) / H);
  return g;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const DISPLAY = '"Archivo Variable", sans-serif';
const MONO = '"JetBrains Mono Variable", monospace';

function drawFace(card: Card, t: CardLook, bankName: string, accent: string, back: boolean, picture?: HTMLImageElement) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 646;
  const ctx = c.getContext('2d')!;

  if (picture) {
    // Cover the face: a picture that isn't card-shaped is cropped, not stretched.
    const k = Math.max(1024 / picture.width, 646 / picture.height);
    ctx.drawImage(picture, (1024 - picture.width * k) / 2, (646 - picture.height * k) / 2, picture.width * k, picture.height * k);
  } else {
    const g = ctx.createLinearGradient(0, 0, 1024, 646);
    g.addColorStop(0, t.bg[0]);
    g.addColorStop(1, t.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 646);

    // Fine diagonal hatching, echoing the grid floor.
    ctx.strokeStyle = t.ink;
    ctx.globalAlpha = 0.08;
    ctx.lineWidth = 2;
    for (let x = -646; x < 1024; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, 646);
      ctx.lineTo(x + 646, 0);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = t.ink;
  ctx.textBaseline = 'alphabetic';

  if (!back && !(picture && t.hideText)) {
    ctx.font = `700 46px ${DISPLAY}`;
    ctx.fillText(bankName.toUpperCase(), 72, 104);
    ctx.font = `500 22px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.fillText(card.tier.toUpperCase(), 952, 100);
    ctx.textAlign = 'left';

    // EMV chip
    const chip = ctx.createLinearGradient(80, 230, 210, 330);
    chip.addColorStop(0, '#f1d98a');
    chip.addColorStop(1, '#a8873a');
    ctx.fillStyle = chip;
    rr(ctx, 80, 228, 132, 100, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,45,10,0.45)';
    ctx.lineWidth = 3;
    [[80, 262, 212, 262], [80, 296, 212, 296], [146, 228, 146, 328]].forEach(([a, b, cx, d]) => {
      ctx.beginPath();
      ctx.moveTo(a, b);
      ctx.lineTo(cx, d);
      ctx.stroke();
    });

    // Contactless arcs
    ctx.strokeStyle = t.ink;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(250, 278, 16 + i * 14, -Math.PI / 4, Math.PI / 4);
      ctx.stroke();
    }

    ctx.fillStyle = t.ink;
    ctx.font = `500 54px ${MONO}`;
    ctx.fillText(`••••  ••••  ••••  ${card.last4}`, 72, 452);

    ctx.font = `500 20px ${MONO}`;
    ctx.globalAlpha = 0.6;
    ctx.fillText('CARD HOLDER', 72, 534);
    ctx.fillText('VALID THRU', 620, 534);
    ctx.globalAlpha = 1;
    ctx.font = `500 30px ${MONO}`;
    ctx.fillText(card.holder.toUpperCase(), 72, 578);
    ctx.fillText(cardExpiry(card.expiresAt), 620, 578);

    // Brand diamond
    ctx.save();
    ctx.translate(912, 556);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = t.bright ? t.ink : accent;
    ctx.fillRect(-26, -26, 52, 52);
    ctx.restore();
  } else if (back) {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 70, 1024, 118);
    ctx.fillStyle = 'rgba(236,238,234,0.92)';
    rr(ctx, 72, 250, 640, 86, 8);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = `500 20px ${MONO}`;
    ctx.fillText('AUTHORIZED SIGNATURE', 92, 286);
    ctx.font = `italic 500 38px ${DISPLAY}`;
    ctx.fillText(card.holder, 92, 324);
    ctx.fillStyle = t.ink;
    ctx.font = `500 26px ${MONO}`;
    ctx.fillText('CVV •••', 752, 304);
    ctx.globalAlpha = 0.6;
    ctx.font = `500 20px ${MONO}`;
    ctx.fillText(`${bankName.toUpperCase()} · PROPERTY OF THE BANK · IF FOUND RETURN TO ANY BRANCH`, 72, 560);
    ctx.globalAlpha = 1;
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export interface CardScene {
  /** Put a card on screen instantly (new branding, pose reset) and play the entrance. */
  show(card: Card, bankName: string, accent: string, tiers: Tiers): void;
  /** Swap to another card with a quick turn. */
  setCard(card: Card): void;
  /** Pause/resume rendering, e.g. while the Cards tab is out of view. */
  setRunning(on: boolean): void;
  flip(): void;
  insert(): Promise<void>;
  dispose(): void;
}

export async function createCardScene(canvas: HTMLCanvasElement, card: Card, bankName: string, accent: string, tiers: Tiers): Promise<CardScene> {
  // Canvas text needs the web fonts decoded first, or the card prints in a fallback face.
  await Promise.all([document.fonts.load(`700 46px ${DISPLAY}`), document.fonts.load(`500 30px ${MONO}`)]).catch(() => {});

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 9);

  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(3, 4, 5);
  scene.add(key);

  const shape = roundedRect(W, H, R);
  const faceGeo = faceGeometry(shape);
  const edgeGeo = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false, curveSegments: 12 });
  edgeGeo.translate(0, 0, -D / 2);

  const mat = (map?: THREE.Texture, metal = 0.3) =>
    new THREE.MeshPhysicalMaterial({ map, metalness: metal, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.18, transparent: true });

  const front = new THREE.Mesh(faceGeo, mat());
  front.position.z = D / 2 + 0.0005;
  const back = new THREE.Mesh(faceGeo, mat());
  back.rotation.y = Math.PI;
  back.position.z = -D / 2 - 0.0005;
  const edge = new THREE.Mesh(edgeGeo, mat());

  const pivot = new THREE.Group(); // pointer tilt + flip
  const body = new THREE.Group(); // idle float + insert motion
  body.add(front, back, edge);
  pivot.add(body);
  scene.add(pivot);

  let brand = { bankName, accent, tiers };
  let current = card;
  const paint = (c: Card, t: CardLook, picture?: HTMLImageElement) => {
    for (const [mesh, isBack] of [[front, false], [back, true]] as const) {
      const m = mesh.material as THREE.MeshPhysicalMaterial;
      const pic = isBack ? undefined : picture;
      m.map?.dispose();
      m.map = drawFace(c, t, brand.bankName, brand.accent, isBack, pic);
      // A picture under a metallic finish goes dark and mirror-like.
      m.metalness = pic ? 0.2 : METAL[c.tier];
      m.needsUpdate = true;
    }
    (edge.material as THREE.MeshPhysicalMaterial).color.set(t.edge);
  };
  const applyCard = (c: Card) => {
    current = c;
    const t = cardLook(brand.tiers[c.tier]);
    paint(c, t);
    // The picture goes on once it has loaded, unless another card was put up meanwhile.
    if (t.image) loadArt(t.image).then((img) => img && current === c && paint(c, t, img));
  };
  applyCard(card);

  // Pointer tilt, eased every frame.
  const tilt = { x: 0, y: 0 };
  const aim = { x: 0, y: 0 };
  const flipState = { y: 0 };
  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    aim.y = ((e.clientX - r.left) / r.width - 0.5) * 0.7;
    aim.x = ((e.clientY - r.top) / r.height - 0.5) * 0.5;
  };
  const onLeave = () => {
    aim.x = 0;
    aim.y = 0;
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // Compile every shader now, not on the first visible frame.
  renderer.compile(scene, camera);

  let floating = true;
  let running = true;
  let raf = 0;
  const clock = new THREE.Clock();
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const t = clock.getElapsedTime();
    tilt.x += (aim.x - tilt.x) * 0.08;
    tilt.y += (aim.y - tilt.y) * 0.08;
    pivot.rotation.x = tilt.x;
    pivot.rotation.y = tilt.y + flipState.y + (floating ? Math.sin(t * 0.6) * 0.08 : 0);
    if (floating) body.position.y = Math.sin(t * 1.1) * 0.06;
    renderer.render(scene, camera);
  };
  loop();

  return {
    show(c, name, color, tiers) {
      brand = { bankName: name, accent: color, tiers };
      // Reset whatever the last screen left behind (e.g. the card inside the ATM slot).
      gsap.killTweensOf([body.rotation, body.position, flipState]);
      floating = true;
      aim.x = aim.y = tilt.x = tilt.y = flipState.y = 0;
      body.rotation.set(0, 0, 0);
      body.position.set(0, 0, 0);
      resize(); // the canvas was just attached to a new screen
      applyCard(c);
      // Entrance: card spins up into place.
      gsap.from(body.rotation, { y: -Math.PI * 1.5, duration: 1.6, ease: 'expo.out' });
      gsap.from(body.position, { y: -1.5, duration: 1.4, ease: 'expo.out' });
    },
    setRunning(on) {
      if (on === running) return;
      running = on;
      cancelAnimationFrame(raf);
      if (on) loop();
    },
    setCard(c) {
      gsap
        .timeline()
        .to(body.rotation, { y: Math.PI / 2, duration: 0.25, ease: 'power2.in', onComplete: () => applyCard(c) })
        .fromTo(body.rotation, { y: -Math.PI / 2 }, { y: 0, duration: 0.6, ease: 'expo.out' });
    },
    flip() {
      gsap.to(flipState, { y: Math.round(flipState.y / Math.PI + 1) * Math.PI, duration: 0.9, ease: 'expo.out' });
    },
    insert() {
      floating = false;
      aim.x = aim.y = 0;
      return new Promise((done) => {
        gsap
          .timeline({ onComplete: () => done() })
          .to(flipState, { y: Math.round(flipState.y / (Math.PI * 2)) * Math.PI * 2, duration: 0.5, ease: 'power3.out' }, 0)
          .to(body.position, { y: 0.4, duration: 0.5, ease: 'power3.out' }, 0)
          .to(body.rotation, { x: -0.35, duration: 0.5, ease: 'power3.out' }, 0)
          .to(body.position, { y: -3.4, duration: 0.7, ease: 'power3.in' }, 0.55);
      });
    },
    dispose() {
      cancelAnimationFrame(raf);
      gsap.killTweensOf([body.rotation, body.position, flipState]);
      ro.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      for (const m of [front, back, edge]) {
        const mm = m.material as THREE.MeshPhysicalMaterial;
        mm.map?.dispose();
        mm.dispose();
      }
      faceGeo.dispose();
      edgeGeo.dispose();
      envTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
