import { useState } from 'react';
import { setBgm, setSe, settings, unlock } from './sound';

export function SoundToggle() {
  const [s, setS] = useState({ ...settings });
  return (
    <div className="sound-toggle">
      <button
        aria-label="BGM"
        className={s.bgm ? 'on' : ''}
        onClick={() => {
          unlock();
          setBgm(!s.bgm);
          setS({ ...settings });
        }}
      >
        ♪ BGM
      </button>
      <button
        aria-label="効果音"
        className={s.se ? 'on' : ''}
        onClick={() => {
          unlock();
          setSe(!s.se);
          setS({ ...settings });
        }}
      >
        🔔 効果音
      </button>
    </div>
  );
}
