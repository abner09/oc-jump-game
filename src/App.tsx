import { useState, useRef, useCallback } from 'react';
import GameCanvas from '@/components/GameCanvas';
import GameUI from '@/components/GameUI';
import { GameEngine, type GameState } from '@/game/engine';

function App() {
  const engineRef = useRef<GameEngine | null>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [gameState, setGameState] = useState<GameState>('menu');
  const [chargeRatio, setChargeRatio] = useState(0);

  const onScore = useCallback((s: number) => setScore(s), []);
  const onCombo = useCallback((c: number) => setCombo(c), []);
  const onState = useCallback((s: GameState) => setGameState(s), []);
  const onCharge = useCallback((r: number) => setChargeRatio(r), []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-background">
      <GameCanvas
        engine={engineRef}
        onScore={onScore}
        onCombo={onCombo}
        onState={onState}
        onCharge={onCharge}
      />
      <GameUI
        engine={engineRef}
        score={score}
        combo={combo}
        state={gameState}
        chargeRatio={chargeRatio}
      />
    </div>
  );
}

export default App;
