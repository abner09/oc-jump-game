import { useState, useRef, type ChangeEvent } from 'react';
import type { GameEngine, GameState } from '@/game/engine';

interface Props {
  engine: React.MutableRefObject<GameEngine | null>;
  score: number;
  combo: number;
  state: GameState;
  chargeRatio: number;
}

export default function GameUI({ engine, score, combo, state, chargeRatio }: Props) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !engine.current) return;
    setUploading(true);
    try {
      await engine.current.loadCharFile(file);
    } catch { /* ignore */ }
    setUploading(false);
  };

  // ---- Menu ----
  if (state === 'menu') {
    return (
      <div className="game-overlay">
        <div className="glass-panel p-10 text-center max-w-sm mx-4 animate-fadeIn">
          <div className="text-5xl mb-3 animate-float">
            <span role="img" aria-label="bounce">&#x1F389;</span>
          </div>
          <h1 className="text-3xl font-extrabold text-foreground mb-2 tracking-tight">
            OC 跳一跳
          </h1>
          <p className="text-muted-foreground mb-6 text-sm leading-relaxed">
            按住屏幕蓄力，松手跳跃！<br />
            跳得越准，分数越高！
          </p>

          <button
            onClick={() => fileRef.current?.click()}
            className="btn-ghost mb-4 w-full text-sm"
            disabled={uploading}
          >
            {uploading ? '上传中…' : '导入你的 OC 角色（可选）'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFile}
            className="hidden"
          />

          <button
            className="btn-primary w-full animate-pulse-glow"
            onClick={() => engine.current?.startGame()}
          >
            开始游戏
          </button>

          <p className="text-xs text-muted-foreground mt-4 opacity-60">
            支持空格键 / 鼠标 / 触屏操作
          </p>
        </div>
      </div>
    );
  }

  // ---- Ready (tap to start) ---- REMOVED — game starts directly

  // ---- Playing HUD ----
  if (state === 'playing') {
    const layers = engine.current?.currentIdx ?? 0;
    return (
      <div className="absolute inset-0 pointer-events-none z-10">
        {/* Score */}
        <div className="absolute top-6 left-1/2 -translate-x-1/2 text-center">
          <div className="score-display text-4xl font-extrabold text-foreground/80 animate-scorePopIn" key={score}>
            {score}
          </div>
          {layers > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5 score-display">{layers} 层</p>
          )}
        </div>

        {/* Combo */}
        {combo >= 2 && (() => {
          let label = `COMBO x${combo}`;
          let size = 'text-xs';
          let bg = 'linear-gradient(135deg, #FFD93D, #FF6B6B)';
          let shadow = '0 2px 12px rgba(255,107,107,0.3)';
          if (combo >= 8) {
            label = `LEGENDARY x${combo}`;
            size = 'text-lg';
            bg = 'linear-gradient(135deg, #FF6B6B, #FFD93D, #6BCB77, #4D96FF, #C9B1FF, #FF69B4)';
            shadow = '0 4px 24px rgba(255,107,107,0.5)';
          } else if (combo >= 6) {
            label = `AMAZING x${combo}`;
            size = 'text-base';
            bg = 'linear-gradient(135deg, #FF69B4, #FF1493)';
            shadow = '0 4px 20px rgba(255,20,147,0.4)';
          } else if (combo >= 4) {
            label = `GREAT x${combo}`;
            size = 'text-sm';
            bg = 'linear-gradient(135deg, #FF8C00, #FFD93D)';
            shadow = '0 3px 16px rgba(255,140,0,0.4)';
          }
          return (
            <div className="absolute top-20 left-1/2 -translate-x-1/2">
              <div
                className={`animate-scorePopIn px-4 py-1.5 rounded-full font-extrabold text-white ${size}`}
                style={{ background: bg, boxShadow: shadow }}
                key={combo}
              >
                {label}
              </div>
            </div>
          );
        })()}

        {/* Import button (top-right) */}
        <div className="absolute top-4 right-4 pointer-events-auto">
          <button
            onClick={() => fileRef.current?.click()}
            className="btn-ghost text-xs px-3 py-1.5 opacity-60 hover:opacity-100 transition-opacity"
          >
            换角色
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
        </div>
      </div>
    );
  }

  // ---- Game Over ----
  if (state === 'gameover') {
    const layers = engine.current?.currentIdx ?? 0;
    return (
      <div className="game-overlay">
        <div className="glass-panel p-8 text-center max-w-xs mx-4 animate-slideUp">
          <p className="text-sm font-medium text-muted-foreground mb-1">游戏结束</p>
          <div className="score-display text-5xl font-extrabold text-foreground mb-2">
            {score}
          </div>

          <div className="flex justify-center gap-6 mb-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-foreground">{layers}</p>
              <p className="text-xs text-muted-foreground">跳过平台</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-foreground">{engine.current?.bestScore ?? 0}</p>
              <p className="text-xs text-muted-foreground">最佳纪录</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 mt-3">
            <button
              className="btn-primary w-full"
              onClick={() => engine.current?.startGame()}
            >
              再来一局
            </button>
            <button
              className="btn-ghost w-full text-sm"
              onClick={() => {
                const e = engine.current;
                if (e) { e.state = 'menu'; e.onState?.('menu'); }
              }}
            >
              返回主页
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
