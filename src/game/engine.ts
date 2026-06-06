// ============================================================
//  OC Jump — Game Engine
//  A polished "Jump Jump" game with canvas rendering,
//  charge-based jumping, perfect landing rewards, and
//  custom character image support.
// ============================================================

// ---------- Types ----------

export interface PlatformDef {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  compression: number;
  opacity: number;
  glowAlpha: number;
  wallHeight: number;
  wallWidth: number;
  moveRange: number;
  moveSpeed: number;
  movePhase: number;
}

export interface ParticleDef {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  opacity: number;
  life: number;
  maxLife: number;
}

export interface ScorePopupDef {
  x: number;
  y: number;
  text: string;
  color: string;
  opacity: number;
  life: number;
  maxLife: number;
  scale: number;
  fontSize: number;
  rainbow: boolean;
}

export type GameState = 'menu' | 'playing' | 'gameover';
export type JumpPhase = 'idle' | 'charging' | 'airborne' | 'recovering';

// ---------- Palette ----------

const BG_COLOR = '#f5f0eb';

const PLAT_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFD93D', '#C9B1FF', '#FF9A9E', '#A8D8EA',
  '#F3B664', '#95E1D3',
];

const CHAR_BODY  = '#FF6B6B';
const CHAR_DARK  = '#E05555';
const CHAR_BELLY = '#FFB4B4';

// ---------- Physics / Design constants ----------

const CHAR_SIZE       = 32;
const GRAVITY         = 2200;
const MAX_CHARGE      = 2.0;
const MIN_V0          = 350;
const MAX_V0          = 1050;
const PLAT_H          = 26;
const MIN_PLAT_W      = 20;
const MAX_PLAT_W      = 100;
const MIN_GAP         = 120;
const MAX_GAP         = 260;
const MAX_DY          = 25;
const CAM_SMOOTH      = 5;
const PERFECT_R       = 0.22;
const GOOD_R          = 0.42;
const SQUASH_SPEED    = 14;
const SQUASH_DECAY    = 10;
const LAND_FORGIVE    = 6;   // extra pixels of horizontal forgiveness for landing

// ---------- Helpers ----------

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const rand = (lo: number, hi: number) => Math.random() * (hi - lo) + lo;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

function hexHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}
const darken  = (hex: string, n: number) => { const [h,s,l] = hexHsl(hex); return `hsl(${h},${s}%,${Math.max(0,l-n)}%)`; };
const lighten = (hex: string, n: number) => { const [h,s,l] = hexHsl(hex); return `hsl(${h},${s}%,${Math.min(100,l+n)}%)`; };

// ============================================================
//  GameEngine
// ============================================================

// ---------- Audio ----------

class SFX {
  private ctx: AudioContext | null = null;

  private ensure() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', freqEnd?: number) {
    const c = this.ensure();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (freqEnd) o.frequency.linearRampToValueAtTime(freqEnd, c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start(); o.stop(c.currentTime + dur);
  }

  jump() {
    this.tone(440, 0.12, 0.15, 'sine', 660);
  }

  land() {
    this.tone(180, 0.1, 0.12, 'triangle', 100);
  }

  perfect() {
    const c = this.ensure();
    const t = c.currentTime;
    // two-note chime
    this.tone(880, 0.15, 0.12, 'sine');
    setTimeout(() => this.tone(1100, 0.2, 0.10, 'sine'), 80);
  }

  combo(level: number) {
    // ascending arpeggio, more notes at higher combos
    const notes = [523, 659, 784, 880, 1047]; // C5 E5 G5 A5 C6
    const count = Math.min(level, 5);
    for (let i = 0; i < count; i++) {
      setTimeout(() => this.tone(notes[i], 0.12, 0.09, 'sine'), i * 55);
    }
  }

  miss() {
    this.tone(300, 0.3, 0.12, 'sawtooth', 80);
  }
}

const sfx = new SFX();

export class GameEngine {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;

  // state
  state: GameState = 'menu';
  jumpPhase: JumpPhase = 'idle';
  score = 0;
  combo = 0;
  bestScore = 0;

  // player
  px = 0; py = 0;
  vx = 0; vy = 0;
  pScaleX = 1; pScaleY = 1;
  tScaleX = 1; tScaleY = 1;
  rotation = 0;
  jumpAngle = 0;

  // charge
  charge = 0;
  charging = false;
  chargeDots: { angle: number; dist: number; size: number }[] = [];

  // world
  platforms: PlatformDef[] = [];
  particles: ParticleDef[] = [];
  popups: ScorePopupDef[] = [];
  currentIdx = 0;

  // camera
  camX = 0; camY = 0;
  camTargetX = 0; camTargetY = 0;
  shakeX = 0; shakeY = 0; shakeInt = 0;

  // fade
  fadeAlpha = 0;

  // shockwave ring (death effect)
  ringRadius = 0;
  ringAlpha = 0;

  // death flash
  deathFlash = 0;

  // tutorial hint timer (seconds since game start)
  hintTimer = 0;

  // track previous frame's feet position for top-crossing detection
  prevFeetY = 0;
  smallStreak = 0;
  movingCount = 0;

  // input
  inputDown = false;

  // character image
  charImg: HTMLImageElement | null = null;

  // bg deco
  bgDots: { x: number; y: number; r: number; o: number; sp: number }[] = [];

  // timing
  rafId = 0;
  lastT = 0;

  // callbacks
  onScore?: (s: number) => void;
  onCombo?: (c: number) => void;
  onState?: (s: GameState) => void;
  onCharge?: (r: number) => void;

  // disposers
  private unbind: (() => void) | null = null;

  // ---- bootstrap ----

  init(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    this.buildBg();
    this.spawnFirstPlatform();
    this.resetPlayer();
    this.bindInput();
    this.lastT = performance.now();
    this.loop();
  }

  private buildBg() {
    this.bgDots = [];
    for (let i = 0; i < 60; i++) {
      this.bgDots.push({
        x: rand(-600, 6000), y: rand(-400, 2000),
        r: rand(2, 10), o: rand(0.02, 0.07), sp: rand(0.1, 0.4),
      });
    }
  }

  resize() {
    const dpr = devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
  }

  private scale() {
    const dpr = devicePixelRatio || 1;
    const cssW = this.canvas.width / dpr;
    // Smaller denominator on mobile = bigger render scale = bigger everything
    //   375px phone portrait: 375/180 = 2.08  → char 67px (17.8% of screen)
    //   667px phone landscape: 667/300 = 2.22
    //   1200px desktop: min(1200,800)/400 = 2.0 (unchanged)
    const denom = cssW < 500 ? 180 : cssW < 700 ? 300 : 400;
    return Math.min(cssW, 800) / denom;
  }

  // ---- input ----

  private bindInput() {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); this.down(); }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); this.up(); }
    };
    const md = () => this.down();
    const mu = () => this.up();
    const ts = (e: TouchEvent) => { e.preventDefault(); this.down(); };
    const te = (e: TouchEvent) => { e.preventDefault(); this.up(); };

    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    this.canvas.addEventListener('mousedown', md);
    this.canvas.addEventListener('mouseup', mu);
    this.canvas.addEventListener('mouseleave', mu);
    this.canvas.addEventListener('touchstart', ts, { passive: false });
    this.canvas.addEventListener('touchend', te, { passive: false });
    this.canvas.addEventListener('touchcancel', te, { passive: false });

    this.unbind = () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      this.canvas.removeEventListener('mousedown', md);
      this.canvas.removeEventListener('mouseup', mu);
      this.canvas.removeEventListener('mouseleave', mu);
      this.canvas.removeEventListener('touchstart', ts);
      this.canvas.removeEventListener('touchend', te);
      this.canvas.removeEventListener('touchcancel', te);
    };
  }

  private down() {
    if (this.state === 'menu') { this.startGame(); return; }
    if (this.state === 'gameover') return;
    if (this.state === 'playing' && this.jumpPhase === 'idle') {
      this.charging = true;
      this.inputDown = true;
      this.charge = 0;
      this.jumpPhase = 'charging';
    }
  }

  private up() {
    if (this.state === 'playing' && this.jumpPhase === 'charging') {
      this.charging = false;
      this.inputDown = false;
      this.doJump();
    }
  }

  // ---- game control ----

  startGame() {
    this.score = 0; this.combo = 0;
    this.platforms = []; this.particles = []; this.popups = [];
    this.currentIdx = 0; this.fadeAlpha = 0; this.hintTimer = 0;
    this.ringRadius = 0; this.ringAlpha = 0; this.deathFlash = 0;
    this.smallStreak = 0;
    this.movingCount = 0;
    this.spawnFirstPlatform();
    this.resetPlayer();
    this.state = 'playing';
    this.onScore?.(0); this.onCombo?.(0); this.onState?.('playing');
  }

  private resetPlayer() {
    const p = this.platforms[0];
    this.px = p.x; this.py = p.y - CHAR_SIZE;
    this.vx = 0; this.vy = 0;
    this.pScaleX = 1; this.pScaleY = 1;
    this.tScaleX = 1; this.tScaleY = 1;
    this.rotation = 0; this.jumpPhase = 'idle';
    this.charge = 0; this.charging = false;
    this.chargeDots = [];
    this.prevFeetY = this.py + CHAR_SIZE;
    this.camX = this.px; this.camY = this.py;
    this.camTargetX = this.camX; this.camTargetY = this.camY;
  }

  setCharImg(img: HTMLImageElement) { this.charImg = img; }

  loadCharFile(file: File): Promise<void> {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => {
        const img = new Image();
        img.onload = () => { this.charImg = img; res(); };
        img.onerror = () => rej(new Error('img'));
        img.src = r.result as string;
      };
      r.onerror = () => rej(new Error('file'));
      r.readAsDataURL(file);
    });
  }

  // ---- jump physics ----

  private doJump() {
    const next = this.platforms[this.currentIdx + 1];
    if (!next) return;

    const cur = this.platforms[this.currentIdx];
    const dx = next.x - cur.x;
    const dy = (next.y - CHAR_SIZE) - (cur.y - CHAR_SIZE);

    // ideal angle based on height difference
    const baseAngle = Math.PI / 5; // ~36 deg
    const angleAdj = clamp(dy / 300, -0.4, 0.4);
    this.jumpAngle = clamp(baseAngle - angleAdj, Math.PI / 8, Math.PI / 2.5);

    // compute v0 needed to reach target distance
    const cosA = Math.cos(this.jumpAngle);
    const sinA = Math.sin(this.jumpAngle);
    const h0 = CHAR_SIZE;
    const hL = CHAR_SIZE + dy; // height at landing (from platform surface)
    const disc = Math.max(0.01, sinA * sinA + 2 * GRAVITY * (h0 - hL) / (MAX_V0 * MAX_V0));
    const v0Perfect = Math.abs(cosA) > 0.01
      ? Math.abs(dx) * Math.sqrt(GRAVITY / (2 * disc)) / Math.abs(cosA)
      : MAX_V0;
    const v0Clamped = clamp(v0Perfect, MIN_V0, MAX_V0);

    // charge ratio with ease-out curve
    const ratio = easeOut(clamp(this.charge / MAX_CHARGE, 0, 1));
    const v0 = MIN_V0 + ratio * (v0Clamped - MIN_V0);

    this.vx = v0 * cosA;
    this.vy = -v0 * sinA;
    this.jumpPhase = 'airborne';
    this.charge = 0;
    this.chargeDots = [];

    // jump stretch
    this.tScaleX = 0.75;
    this.tScaleY = 1.35;

    // dust
    this.emitDust(this.px, this.py + CHAR_SIZE, 6, '#ccc');
    sfx.jump();
  }

  // ---- platform gen ----

  private spawnFirstPlatform() {
    this.platforms.push({
      x: 0, y: 300, width: 110, height: PLAT_H,
      color: PLAT_COLORS[0], compression: 0, opacity: 1, glowAlpha: 0,
      wallHeight: 0, wallWidth: 0,
      moveRange: 0, moveSpeed: 0, movePhase: 0,
    });
    this.spawnNext();
  }

  private spawnNext() {
    const prev = this.platforms[this.platforms.length - 1];

    // stretched difficulty curve: 0→1 over 250 layers
    const diff = clamp(this.currentIdx / 250, 0, 1);
    // hardcore phase: extra ramp from layer 150 to 350
    const hardcore = clamp((this.currentIdx - 150) / 200, 0, 1);

    // varied gap
    const r = Math.random();
    let gapFactor: number;
    if (r < 0.80) {
      gapFactor = rand(0, 0.65);
    } else {
      gapFactor = rand(0.65, 1.0);
    }
    gapFactor = clamp(gapFactor + diff * 0.12 + hardcore * 0.08, 0, 1);
    const gap = lerp(MIN_GAP, MAX_GAP, gapFactor);

    // --- platform width ---
    const baseShrink = diff * (0.2 + Math.random() * 0.5);
    let w = lerp(MAX_PLAT_W, MIN_PLAT_W, clamp(baseShrink, 0, 1));

    // small platform chance with anti-streak protection
    //   if last 2 were small, force a normal one
    let smallChance = 0.15 + diff * 0.50 + hardcore * 0.15;
    if (this.smallStreak >= 2) smallChance *= 0.15;  // strongly discourage 3rd small in a row
    const isSmall = Math.random() < smallChance;

    if (isSmall) {
      const hardcoreBonus = hardcore > 0 ? hardcore * hardcore * 0.4 : 0;
      const shrink = clamp(diff * diff * rand(0.5, 1.2) + hardcoreBonus, 0, 1);
      w = lerp(MAX_PLAT_W, MIN_PLAT_W, clamp(shrink, 0, 1));
      this.smallStreak++;
    } else {
      this.smallStreak = 0;
    }

    // --- wall obstacle (异形板) ---
    // appears after layer 100, frequency and size scale with hardcore
    let wallH = 0, wallW = 0;
    const wallChance = this.currentIdx > 100
      ? 0.05 + hardcore * 0.35
      : 0;
    if (Math.random() < wallChance) {
      wallH = lerp(8, 24, hardcore * rand(0.4, 1.0));
      wallW = lerp(6, 14, hardcore * rand(0.3, 1.0));
    }

    // --- moving platform ---
    // 50-100: 3, 100-200: 8, 200-300: 10, 300-400: 12, ...
    let moveRange = 0, moveSpeed = 0, movePhase = 0;
    if (this.currentIdx > 50) {
      const section = Math.floor((this.currentIdx - 50) / 100);
      const budget = section === 0 ? 3 : 8 + section * 2;
      if (this.movingCount < budget) {
        const chance = (budget - this.movingCount) / Math.max(1, 100 - ((this.currentIdx - 50) % 100));
        if (Math.random() < chance) {
          moveRange = rand(18, 32);
          moveSpeed = lerp(0.6, 1.4, section / 5) * rand(0.8, 1.2);
          movePhase = Math.random() * Math.PI * 2;
          this.movingCount++;
        }
      }
    }

    const dy = rand(-MAX_DY, MAX_DY);
    const y = clamp(prev.y + dy, 140, 540);

    this.platforms.push({
      x: prev.x + gap, y, width: w, height: PLAT_H,
      color: PLAT_COLORS[this.platforms.length % PLAT_COLORS.length],
      compression: 0, opacity: 0, glowAlpha: 0,
      wallHeight: wallH, wallWidth: wallW,
      moveRange, moveSpeed, movePhase,
    });
  }

  // ---- particles ----

  private emit(x: number, y: number, n: number, colors: string[], size: [number,number], speed: [number,number], life: number, grav = 600) {
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + rand(-0.4, 0.4);
      const s = rand(speed[0], speed[1]);
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - rand(40, 120),
        color: colors[Math.floor(Math.random() * colors.length)],
        size: rand(size[0], size[1]), opacity: 1, life: 0, maxLife: life + rand(-0.1, 0.1),
      });
    }
    // add gravity to particles
    for (const p of this.particles) (p as any)._g = grav;
  }

  private emitDust(x: number, y: number, n: number, color: string) {
    for (let i = 0; i < n; i++) {
      const a = Math.PI + rand(-0.9, 0.9);
      const s = rand(40, 130);
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30,
        color, size: rand(2, 5), opacity: 0.7, life: 0, maxLife: rand(0.25, 0.45),
      });
    }
  }

  private emitPerfect(x: number, y: number) {
    this.emit(x, y, 20, ['#FFD93D','#FFF3B0','#FFE066','#FFF8DC'], [3,8], [120,320], 0.85, 500);
  }

  private emitNice(x: number, y: number) {
    this.emit(x, y, 10, ['#6BCB77','#A8E6CF','#DCEDC1'], [2,5], [80,200], 0.6, 500);
  }

  private emitGood(x: number, y: number) {
    this.emit(x, y, 5, ['#4D96FF','#B8D4E3'], [2,4], [60,140], 0.4, 500);
  }

  private addPopup(x: number, y: number, text: string, color: string, fontSize = 17, rainbow = false) {
    this.popups.push({ x, y, text, color, opacity: 1, life: 0, maxLife: 1.2, scale: 1.4, fontSize, rainbow });
  }

  private emitComboExplosion(x: number, y: number, count: number, isRainbow: boolean) {
    const colors = isRainbow
      ? ['#FF6B6B','#FFD93D','#6BCB77','#4D96FF','#C9B1FF','#FF9A9E','#4ECDC4']
      : ['#FFD93D','#FFF3B0','#FFE066','#FF8C00','#FFA500'];
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + rand(-0.3, 0.3);
      const s = rand(100, 380);
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - rand(60, 180),
        color: colors[Math.floor(Math.random() * colors.length)],
        size: rand(3, 9), opacity: 1, life: 0, maxLife: rand(0.6, 1.2),
      });
    }
  }

  private emitCharBurst(x: number, y: number) {
    const charColors = [CHAR_BODY, CHAR_DARK, CHAR_BELLY, '#FFD4D4', '#FF8A8A'];

    // large character fragments — slow, heavy
    for (let i = 0; i < 18; i++) {
      const a = (Math.PI * 2 * i) / 18 + rand(-0.5, 0.5);
      const s = rand(160, 420);
      this.particles.push({
        x: x + rand(-4, 4), y: y + rand(-4, 4),
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - rand(120, 280),
        color: charColors[Math.floor(Math.random() * charColors.length)],
        size: rand(5, 13), opacity: 1, life: 0, maxLife: rand(0.8, 1.5),
      });
    }

    // small fast sparks radiating outward
    for (let i = 0; i < 14; i++) {
      const a = (Math.PI * 2 * i) / 14 + rand(-0.3, 0.3);
      const s = rand(300, 600);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - rand(80, 200),
        color: Math.random() > 0.4 ? '#fff' : CHAR_BODY,
        size: rand(1.5, 4), opacity: 1, life: 0, maxLife: rand(0.3, 0.7),
      });
    }

    // dark trailing fragments (character outline / shading pieces)
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 * i) / 8 + rand(-0.6, 0.6);
      const s = rand(80, 200);
      this.particles.push({
        x: x + rand(-6, 6), y: y + rand(-6, 6),
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - rand(60, 150),
        color: CHAR_DARK,
        size: rand(6, 16), opacity: 0.9, life: 0, maxLife: rand(1.0, 1.8),
      });
    }
  }

  // ---- landing ----

  private tryLand(): boolean {
    const next = this.platforms[this.currentIdx + 1];
    if (!next) return false;
    if (this.vy <= 0) return false;  // must be falling

    // horizontal: character center with forgiveness margin
    const dx = Math.abs(this.px - next.x);
    if (dx > next.width / 2 + LAND_FORGIVE) return false;

    const feetY = this.py + CHAR_SIZE;

    // --- wall top landing ---
    // if platform has a wall and character center is within wall x range,
    // landing on the wall top is valid (but only base score)
    let landedOnWall = false;
    if (next.wallHeight > 0) {
      const wallLeft = next.x - next.width / 2;
      const wallRight = wallLeft + next.wallWidth;
      if (this.px >= wallLeft - 2 && this.px <= wallRight + 2) {
        const wallTop = next.y - next.wallHeight;
        if (this.prevFeetY < wallTop + 2 && feetY >= wallTop) {
          // land on wall top
          this.py = wallTop - CHAR_SIZE;
          landedOnWall = true;
        } else if (this.prevFeetY >= wallTop + 2) {
          // already past the wall top, character falls through
          return false;
        } else {
          // hasn't reached wall top yet
          return false;
        }
      }
    }

    // --- normal platform landing (only if not on wall) ---
    if (!landedOnWall) {
      const platTop = next.y;
      if (this.prevFeetY >= platTop + 2) return false;
      if (feetY < platTop) return false;
      this.py = next.y - CHAR_SIZE;
    }

    // common landing setup
    this.px = this.px;
    this.vy = 0; this.vx = 0;
    this.jumpPhase = 'idle';
    this.rotation = 0;
    this.currentIdx++;

    // squash
    this.tScaleX = 1.3;
    this.tScaleY = 0.7;

    // platform compress
    next.compression = 7;

    // --- scoring ---
    if (landedOnWall) {
      // wall landing: only base score, no combo
      this.combo = 0;
      this.score += 1;
      this.addPopup(this.px, next.y - next.wallHeight - 40, '+1', '#999');
      sfx.land();
      this.shakeInt = 2;
    } else {
      // normal platform landing with full scoring
      const ratio = dx / (next.width / 2);
      const isPerfect = ratio < PERFECT_R;
      const isGood = ratio < GOOD_R;

      if (isPerfect) {
        this.combo++;
        const pts = 4 + Math.min(this.combo, 8);
        this.score += pts;
        next.glowAlpha = 1;

        // escalating combo tiers
        if (this.combo >= 8) {
          this.addPopup(next.x, next.y - 60, `LEGENDARY x${this.combo}!`, '#FF6B6B', 28, true);
          this.emitComboExplosion(next.x, next.y - 20, 40, true);
          this.shakeInt = 18;
          sfx.combo(this.combo);
        } else if (this.combo >= 6) {
          this.addPopup(next.x, next.y - 56, `AMAZING x${this.combo}!`, '#FF69B4', 24, false);
          this.emitComboExplosion(next.x, next.y - 20, 30, false);
          this.shakeInt = 14;
          sfx.combo(this.combo);
        } else if (this.combo >= 4) {
          this.addPopup(next.x, next.y - 52, `GREAT x${this.combo}!`, '#FF8C00', 21, false);
          this.emitComboExplosion(next.x, next.y - 20, 22, false);
          this.shakeInt = 12;
          sfx.combo(this.combo);
        } else if (this.combo >= 2) {
          this.addPopup(next.x, next.y - 50, 'PERFECT!', '#FFD93D', 19, false);
          this.emitPerfect(next.x, next.y - 8);
          this.shakeInt = 10;
          sfx.perfect();
        } else {
          this.addPopup(next.x, next.y - 48, 'PERFECT', '#FFD93D', 17, false);
          this.emitPerfect(next.x, next.y - 8);
          this.shakeInt = 10;
          sfx.perfect();
        }
      } else if (isGood) {
        this.combo = 0;
        this.score += 2;
        this.addPopup(next.x, next.y - 45, 'NICE!', '#6BCB77');
        this.emitNice(next.x, next.y - 8);
        this.shakeInt = 4;
        sfx.land();
      } else {
        this.combo = 0;
        this.score += 1;
        this.addPopup(next.x, next.y - 40, '+1', '#4D96FF');
        this.emitGood(next.x, next.y - 8);
        sfx.land();
        this.shakeInt = 2;
      }
    }

    this.onScore?.(this.score);
    this.onCombo?.(this.combo);

    // bounce mini
    setTimeout(() => { if (this.jumpPhase === 'idle') { this.tScaleX = 0.92; this.tScaleY = 1.1; } }, 90);
    setTimeout(() => { if (this.jumpPhase === 'idle') { this.tScaleX = 1; this.tScaleY = 1; } }, 200);

    this.spawnNext();
    return true;
  }

  private die() {
    this.state = 'gameover';
    this.bestScore = Math.max(this.bestScore, this.score);

    // dramatic character explosion
    const cx = this.px;
    const cy = this.py + CHAR_SIZE / 2;
    this.emitCharBurst(cx, cy);

    // shockwave ring
    this.ringRadius = 8;
    this.ringAlpha = 1.0;

    // white death flash
    this.deathFlash = 0.6;

    // big screen shake
    this.shakeInt = 24;

    sfx.miss();
    this.onState?.('gameover');
  }

  // ---- update ----

  private update(dt: number) {
    if (this.state === 'menu') {
      this.updateCam(dt);
      return;
    }
    if (this.state !== 'playing') {
      if (this.state === 'gameover') {
        this.fadeAlpha = Math.min(this.fadeAlpha + dt * 2.5, 0.55);
        // shockwave ring expansion
        if (this.ringAlpha > 0.01) {
          this.ringRadius += dt * 320;
          this.ringAlpha = lerp(this.ringAlpha, 0, dt * 3.5);
        } else {
          this.ringAlpha = 0;
        }
        // death flash decay
        if (this.deathFlash > 0.01) this.deathFlash = lerp(this.deathFlash, 0, dt * 6);
        else this.deathFlash = 0;
        this.updateParts(dt);
        this.updatePopups(dt);
        this.updateCam(dt);
      }
      return;
    }

    // hint timer
    this.hintTimer += dt;

    // charging
    if (this.jumpPhase === 'charging') {
      this.charge = Math.min(this.charge + dt, MAX_CHARGE);
      const r = this.charge / MAX_CHARGE;
      this.tScaleX = 1 + r * 0.38;
      this.tScaleY = 1 - r * 0.30;
      const cp = this.platforms[this.currentIdx];
      if (cp) cp.compression = r * 5;

      // orbiting dots
      const t = performance.now() / 1000;
      this.chargeDots = [];
      const nd = 3 + Math.floor(r * 5);
      for (let i = 0; i < nd; i++) {
        this.chargeDots.push({
          angle: t * 3 + (Math.PI * 2 * i) / nd,
          dist: 22 + r * 16,
          size: 1.5 + r * 2,
        });
      }
      this.onCharge?.(r);
    } else {
      this.onCharge?.(0);
    }

    // airborne
    if (this.jumpPhase === 'airborne') {
      // save feet position before physics step
      this.prevFeetY = this.py + CHAR_SIZE;

      this.vy += GRAVITY * dt;
      this.px += this.vx * dt;
      this.py += this.vy * dt;

      // tilt
      const target = clamp(Math.atan2(this.vy, this.vx) * 0.25, -0.5, 0.5);
      this.rotation = lerp(this.rotation, target, dt * 6);

      // land check
      if (this.tryLand()) { /* landed */ }

      // fell
      if (this.py > this.camY + 700) {
        this.jumpPhase = 'idle';
        this.die();
      }
    }

    // squash/stretch lerp
    this.pScaleX = lerp(this.pScaleX, this.tScaleX, dt * SQUASH_SPEED);
    this.pScaleY = lerp(this.pScaleY, this.tScaleY, dt * SQUASH_SPEED);
    this.tScaleX = lerp(this.tScaleX, 1, dt * SQUASH_DECAY);
    this.tScaleY = lerp(this.tScaleY, 1, dt * SQUASH_DECAY);

    // platform compression + movement
    for (const p of this.platforms) {
      if (p.compression > 0.1) p.compression = lerp(p.compression, 0, dt * 12);
      else p.compression = 0;
      if (p.opacity < 1) p.opacity = Math.min(p.opacity + dt * 3, 1);
      if (p.glowAlpha > 0.01) p.glowAlpha = lerp(p.glowAlpha, 0, dt * 3);
      else p.glowAlpha = 0;
      // horizontal oscillation
      if (p.moveRange > 0) {
        if ((p as any)._baseX === undefined) (p as any)._baseX = p.x;
        p.movePhase += p.moveSpeed * dt;
        p.x = (p as any)._baseX + Math.sin(p.movePhase) * p.moveRange;
      }
    }

    // character rides moving platform when standing
    if (this.jumpPhase === 'idle' || this.jumpPhase === 'charging') {
      const cp = this.platforms[this.currentIdx];
      if (cp && cp.moveRange > 0) {
        this.px = cp.x;
      }
    }

    this.updateParts(dt);
    this.updatePopups(dt);
    this.updateCam(dt);

    // shake
    if (this.shakeInt > 0.3) {
      this.shakeX = rand(-1, 1) * this.shakeInt;
      this.shakeY = rand(-1, 1) * this.shakeInt;
      this.shakeInt = lerp(this.shakeInt, 0, dt * 16);
    } else { this.shakeX = 0; this.shakeY = 0; this.shakeInt = 0; }
  }

  private updateParts(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      const g = (p as any)._g ?? 600;
      p.vy += g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life += dt;
      p.opacity = Math.max(0, 1 - p.life / p.maxLife);
      if (p.life >= p.maxLife) this.particles.splice(i, 1);
    }
  }

  private updatePopups(dt: number) {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.y -= 45 * dt;
      p.life += dt;
      const r = p.life / p.maxLife;
      p.opacity = r > 0.65 ? Math.max(0, 1 - (r - 0.65) / 0.35) : 1;
      p.scale = r < 0.15 ? lerp(1.4, 1, r / 0.15) : 1;
      if (p.life >= p.maxLife) this.popups.splice(i, 1);
    }
  }

  private updateCam(dt: number) {
    if (this.state === 'playing' || this.state === 'gameover') {
      const next = this.platforms[this.currentIdx + 1];
      const lookAhead = next
        ? this.px + (next.x - this.px) * 0.35
        : this.px + 80;
      this.camTargetX = lookAhead;
      this.camTargetY = this.py + 60;
    }
    const s = CAM_SMOOTH * dt;
    this.camX = lerp(this.camX, this.camTargetX, s);
    this.camY = lerp(this.camY, this.camTargetY, s);
  }

  // ---- render ----

  private render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const sc = this.scale();

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2, h * 0.48);
    ctx.scale(sc, sc);
    ctx.translate(-this.camX + this.shakeX, -this.camY + this.shakeY);

    this.drawBg(ctx);
    // only render nearby platforms
    const viewW = w / sc + 200;
    for (const p of this.platforms) {
      if (Math.abs(p.x - this.camX) < viewW) this.drawPlat(ctx, p);
    }
    this.drawParts(ctx);
    if (this.state !== 'gameover') this.drawChar(ctx);
    if (this.jumpPhase === 'charging') this.drawCharge(ctx);
    this.drawPopups(ctx);

    // shockwave ring (death effect, drawn in world space)
    if (this.ringAlpha > 0.01) {
      ctx.save();
      ctx.strokeStyle = `rgba(255,107,107,${this.ringAlpha * 0.7})`;
      ctx.lineWidth = 4 + (1 - this.ringAlpha) * 6;
      ctx.beginPath();
      ctx.arc(this.px, this.py + CHAR_SIZE / 2, this.ringRadius, 0, Math.PI * 2);
      ctx.stroke();
      // inner white ring
      ctx.strokeStyle = `rgba(255,255,255,${this.ringAlpha * 0.5})`;
      ctx.lineWidth = 2 + (1 - this.ringAlpha) * 3;
      ctx.beginPath();
      ctx.arc(this.px, this.py + CHAR_SIZE / 2, this.ringRadius * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    // tutorial hint (first 4 seconds)
    if (this.state === 'playing' && this.hintTimer < 4) {
      const alpha = this.hintTimer < 3 ? 0.5 : 0.5 * (1 - (this.hintTimer - 3));
      if (alpha > 0.01) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = '500 14px "Inter",system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#666';
        ctx.fillText('按住蓄力 · 松手跳跃', w / 2, h * 0.82);
        ctx.restore();
      }
    }

    // game-over fade
    if (this.state === 'gameover' && this.fadeAlpha > 0.01) {
      ctx.fillStyle = `rgba(245,240,235,${this.fadeAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }

    // death flash (white screen flash on character explosion)
    if (this.deathFlash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${this.deathFlash})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  private drawBg(ctx: CanvasRenderingContext2D) {
    for (const d of this.bgDots) {
      const px = d.x - this.camX * d.sp;
      const py = d.y - this.camY * d.sp;
      ctx.beginPath();
      ctx.arc(px + this.camX, py + this.camY, d.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,190,180,${d.o})`;
      ctx.fill();
    }
  }

  private drawPlat(ctx: CanvasRenderingContext2D, p: PlatformDef) {
    const { x, y, width: pw, height: ph, color, compression: comp, opacity, glowAlpha } = p;
    const cy = y + comp;
    const topH = ph * 0.55;
    const sideH = ph * 0.45;
    const iso = 7;

    ctx.save();
    ctx.globalAlpha = opacity;

    // glow
    if (glowAlpha > 0.01) {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 20 * glowAlpha;
      ctx.fillStyle = color;
      ctx.globalAlpha = opacity * glowAlpha * 0.4;
      this.roundRect(ctx, x - pw / 2 - 4, cy - 4, pw + 8, topH + 8, 8);
      ctx.fill();
      ctx.restore();
    }

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    this.roundRect(ctx, x - pw / 2 + 3, cy + 4, pw, topH + sideH, 6);
    ctx.fill();

    // side (darker)
    ctx.fillStyle = darken(color, 18);
    this.roundRect(ctx, x - pw / 2, cy + topH - 2, pw, sideH + 2, 5);
    ctx.fill();

    // top face (gradient)
    const g = ctx.createLinearGradient(x - pw / 2, cy, x + pw / 2, cy + topH);
    g.addColorStop(0, lighten(color, 8));
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    this.roundRect(ctx, x - pw / 2, cy, pw, topH, 5);
    ctx.fill();

    // highlight line
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    this.roundRect(ctx, x - pw / 2 + 4, cy + 2, pw - 8, 3, 2);
    ctx.fill();

    // center dot indicator
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(x, cy + topH / 2, 3, 0, Math.PI * 2);
    ctx.fill();

    // wall obstacle (异形板)
    if (p.wallHeight > 0 && p.wallWidth > 0) {
      const wx = x - pw / 2;
      const wy = cy - p.wallHeight;
      // wall body (darker shade of platform color)
      ctx.fillStyle = darken(color, 30);
      this.roundRect(ctx, wx, wy, p.wallWidth, p.wallHeight, 3);
      ctx.fill();
      // wall top highlight
      ctx.fillStyle = darken(color, 15);
      this.roundRect(ctx, wx, wy, p.wallWidth, 3, 2);
      ctx.fill();
      // wall edge line
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(wx + p.wallWidth - 1, wy + 2, 1, p.wallHeight - 2);
    }

    // moving platform indicator (左右移动箭头)
    if (p.moveRange > 0) {
      const arrowY = cy + topH / 2;
      const arrowSize = 4;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      // left arrow
      const lx = x - pw / 2 + 8;
      ctx.beginPath();
      ctx.moveTo(lx - arrowSize, arrowY);
      ctx.lineTo(lx + arrowSize * 0.6, arrowY - arrowSize * 0.7);
      ctx.lineTo(lx + arrowSize * 0.6, arrowY + arrowSize * 0.7);
      ctx.closePath();
      ctx.fill();
      // right arrow
      const rx = x + pw / 2 - 8;
      ctx.beginPath();
      ctx.moveTo(rx + arrowSize, arrowY);
      ctx.lineTo(rx - arrowSize * 0.6, arrowY - arrowSize * 0.7);
      ctx.lineTo(rx - arrowSize * 0.6, arrowY + arrowSize * 0.7);
      ctx.closePath();
      ctx.fill();
      // subtle connecting line
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lx + arrowSize * 0.6 + 2, arrowY);
      ctx.lineTo(rx - arrowSize * 0.6 - 2, arrowY);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawChar(ctx: CanvasRenderingContext2D) {
    const x = this.px;
    const y = this.py;
    const s = CHAR_SIZE;

    // shadow — drawn without squash/stretch so it stays grounded
    const curPlat = this.platforms[this.currentIdx];
    const surfaceY = (curPlat?.y ?? this.py) - (curPlat?.wallHeight ?? 0);
    const shadowScale = clamp(1 - (this.py - surfaceY) / 300, 0.3, 1);
    ctx.fillStyle = `rgba(0,0,0,${0.06 * shadowScale})`;
    ctx.beginPath();
    ctx.ellipse(x, surfaceY + 3, s * 0.45 * shadowScale, 3.5 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(x, y + s);
    ctx.rotate(this.rotation);
    ctx.scale(this.pScaleX, this.pScaleY);

    if (this.charImg) {
      const ratio = this.charImg.width / this.charImg.height;
      let dw = s * 1.8, dh = s * 1.8;
      if (ratio > 1) dh = dw / ratio; else dw = dh * ratio;
      ctx.drawImage(this.charImg, -dw / 2, -dh + 2, dw, dh);
    } else {
      this.drawDefaultChar(ctx, s);
    }

    ctx.restore();
  }

  private drawDefaultChar(ctx: CanvasRenderingContext2D, s: number) {
    const r = s / 2;

    // body
    ctx.fillStyle = CHAR_BODY;
    ctx.beginPath(); ctx.arc(0, -r, r, 0, Math.PI * 2); ctx.fill();

    // shading
    const g = ctx.createRadialGradient(-r * 0.3, -r * 1.3, 0, 0, -r, r * 1.1);
    g.addColorStop(0, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, CHAR_DARK);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, -r, r, 0, Math.PI * 2); ctx.fill();

    // belly
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath(); ctx.ellipse(0, -r * 0.65, r * 0.55, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();

    // eyes
    const ey = -r * 1.08;
    const esp = r * 0.33;
    const esz = this.jumpPhase === 'charging' ? r * 0.13 : r * 0.17;

    ctx.fillStyle = '#2C3E50';
    ctx.beginPath(); ctx.arc(-esp, ey, esz, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc( esp, ey, esz, 0, Math.PI * 2); ctx.fill();

    // eye highlights
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-esp - esz * 0.3, ey - esz * 0.3, esz * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc( esp - esz * 0.3, ey - esz * 0.3, esz * 0.42, 0, Math.PI * 2); ctx.fill();

    // mouth
    ctx.strokeStyle = '#2C3E50';
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (this.jumpPhase === 'airborne') {
      // excited open mouth
      ctx.fillStyle = '#2C3E50';
      ctx.arc(0, -r * 0.72, r * 0.12, 0, Math.PI);
      ctx.fill();
    } else {
      ctx.arc(0, -r * 0.78, r * 0.13, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }

    // blush
    ctx.fillStyle = 'rgba(255,140,140,0.25)';
    ctx.beginPath(); ctx.ellipse(-esp - r * 0.1, -r * 0.9, r * 0.13, r * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse( esp + r * 0.1, -r * 0.9, r * 0.13, r * 0.08, 0, 0, Math.PI * 2); ctx.fill();
  }

  private drawCharge(ctx: CanvasRenderingContext2D) {
    const r = this.charge / MAX_CHARGE;
    const cx = this.px;
    const cy = this.py + CHAR_SIZE / 2;

    // ring
    ctx.strokeStyle = `rgba(255,107,107,${0.25 + r * 0.45})`;
    ctx.lineWidth = 2 + r * 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, 20 + r * 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * r);
    ctx.stroke();

    // dots
    for (const d of this.chargeDots) {
      const dx = cx + Math.cos(d.angle) * d.dist;
      const dy = cy + Math.sin(d.angle) * d.dist * 0.55;
      ctx.fillStyle = `rgba(255,107,107,${0.4 + r * 0.4})`;
      ctx.beginPath(); ctx.arc(dx, dy, d.size, 0, Math.PI * 2); ctx.fill();
    }
  }

  private drawParts(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawPopups(ctx: CanvasRenderingContext2D) {
    for (const p of this.popups) {
      ctx.save();
      ctx.globalAlpha = p.opacity;
      ctx.translate(p.x, p.y);
      ctx.scale(p.scale, p.scale);
      ctx.font = `bold ${p.fontSize}px "Inter",system-ui,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // white outline
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 4;
      ctx.strokeText(p.text, 0, 0);

      if (p.rainbow) {
        // rainbow gradient fill
        const tw = ctx.measureText(p.text).width;
        const grad = ctx.createLinearGradient(-tw / 2, 0, tw / 2, 0);
        grad.addColorStop(0, '#FF6B6B');
        grad.addColorStop(0.2, '#FFD93D');
        grad.addColorStop(0.4, '#6BCB77');
        grad.addColorStop(0.6, '#4D96FF');
        grad.addColorStop(0.8, '#C9B1FF');
        grad.addColorStop(1, '#FF69B4');
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = p.color;
      }
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ---- game loop ----

  private loop = () => {
    const now = performance.now();
    const dt = Math.min((now - this.lastT) / 1000, 0.05);
    this.lastT = now;
    this.update(dt);
    this.render();
    this.rafId = requestAnimationFrame(this.loop);
  };

  // ---- cleanup ----

  destroy() {
    cancelAnimationFrame(this.rafId);
    this.unbind?.();
  }
}
