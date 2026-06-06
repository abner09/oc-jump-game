import { useEffect, useRef, useCallback } from 'react';
import { GameEngine, type GameState } from '@/game/engine';

interface Props {
  engine: React.MutableRefObject<GameEngine | null>;
  onScore: (s: number) => void;
  onCombo: (c: number) => void;
  onState: (s: GameState) => void;
  onCharge: (r: number) => void;
}

export default function GameCanvas({ engine, onScore, onCombo, onState, onCharge }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  const setup = useCallback(() => {
    if (!ref.current || engine.current) return;
    const e = new GameEngine();
    e.onScore = onScore;
    e.onCombo = onCombo;
    e.onState = onState;
    e.onCharge = onCharge;
    e.init(ref.current);
    engine.current = e;
  }, [engine, onScore, onCombo, onState, onCharge]);

  useEffect(() => {
    setup();
    const onResize = () => engine.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      engine.current?.destroy();
      engine.current = null;
    };
  }, [setup]);

  return (
    <canvas
      ref={ref}
      className="absolute inset-0 w-full h-full"
      style={{ touchAction: 'none' }}
    />
  );
}
