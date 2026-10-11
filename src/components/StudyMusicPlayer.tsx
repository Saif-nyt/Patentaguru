import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, Music, SkipForward, SkipBack, Sparkles } from 'lucide-react';

interface Soundscape {
  id: number;
  title: string;
  subtitle: string;
  type: OscillatorType;
  frequencies: number[];
  filterFreq: number;
  lfoRate: number;
}

const SOUNDSCAPES: Soundscape[] = [
  {
    id: 1,
    title: '432Hz Alpha Focus Drone',
    subtitle: 'Deep Reading & Concentration',
    type: 'sine',
    frequencies: [108.0, 216.0, 271.74, 324.0, 432.0], // 432Hz harmonic series
    filterFreq: 750,
    lfoRate: 0.1,
  },
  {
    id: 2,
    title: '528Hz Solfeggio Clarity Pad',
    subtitle: 'Memory Retention & Calming Waves',
    type: 'sine',
    frequencies: [132.0, 264.0, 396.0, 528.0, 660.0], // Solfeggio harmonics
    filterFreq: 950,
    lfoRate: 0.07,
  },
  {
    id: 3,
    title: 'Calm Lofi Horizon (Dmin9)',
    subtitle: 'Warm Acoustic Harmonic Ambience',
    type: 'triangle',
    frequencies: [146.83, 220.0, 293.66, 349.23, 440.0], // D minor 9 focus chord
    filterFreq: 600,
    lfoRate: 0.15,
  },
  {
    id: 4,
    title: 'Zen River Sanctuary',
    subtitle: 'Gentle Flow & Breathing Focus',
    type: 'sine',
    frequencies: [164.81, 196.0, 246.94, 329.63, 392.0], // E minor pentatonic
    filterFreq: 850,
    lfoRate: 0.12,
  },
  {
    id: 5,
    title: 'Midnight Starlight Swell',
    subtitle: 'Night Time Quiet Memory Processing',
    type: 'sine',
    frequencies: [138.59, 207.65, 277.18, 369.99, 440.0], // F#m7 swell
    filterFreq: 700,
    lfoRate: 0.08,
  },
];

const TRACK_DURATION_SECONDS = 300; // 5 minutes rotation

export const StudyMusicPlayer: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState<boolean>(() => {
    try {
      return localStorage.getItem('patente_study_music') === 'true';
    } catch {
      return false;
    }
  });

  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(0);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(TRACK_DURATION_SECONDS);
  const [showControls, setShowControls] = useState<boolean>(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const activeNodesRef = useRef<{ oscs: OscillatorNode[]; gains: GainNode[]; lfos: OscillatorNode[] }>({
    oscs: [],
    gains: [],
    lfos: [],
  });

  const currentTrack = SOUNDSCAPES[currentTrackIndex];

  // Stop currently playing active nodes with gentle fade out
  const stopActiveNodes = useCallback((fadeSeconds = 1.5) => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const { oscs, gains, lfos } = activeNodesRef.current;

    gains.forEach((g) => {
      try {
        g.gain.setTargetAtTime(0.0001, ctx.currentTime, fadeSeconds / 3);
      } catch {}
    });

    setTimeout(() => {
      oscs.forEach((osc) => {
        try {
          osc.stop();
          osc.disconnect();
        } catch {}
      });
      lfos.forEach((lfo) => {
        try {
          lfo.stop();
          lfo.disconnect();
        } catch {}
      });
    }, fadeSeconds * 1000);

    activeNodesRef.current = { oscs: [], gains: [], lfos: [] };
  }, []);

  // Play a specific soundscape by index
  const playSoundscape = useCallback((index: number) => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContextClass();
      }

      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }

      const ctx = audioCtxRef.current;

      // Master gain if not yet created
      if (!masterGainRef.current) {
        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(0.08, ctx.currentTime);
        masterGain.connect(ctx.destination);
        masterGainRef.current = masterGain;
      }

      // Stop existing notes
      stopActiveNodes(2);

      const track = SOUNDSCAPES[index];
      const newOscs: OscillatorNode[] = [];
      const newGains: GainNode[] = [];
      const newLfos: OscillatorNode[] = [];

      // Create filter
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(track.filterFreq, ctx.currentTime);
      filter.connect(masterGainRef.current);

      track.frequencies.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();

        osc.type = track.type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);

        // Gentle volume ramp up
        const targetVol = 0.018 / (idx === 0 ? 1 : 1.3);
        oscGain.gain.setValueAtTime(0.0001, ctx.currentTime);
        oscGain.gain.setTargetAtTime(targetVol, ctx.currentTime + 0.1, 1.2);

        // Gentle subtle vibrato/lfo
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.setValueAtTime(track.lfoRate + Math.random() * 0.05, ctx.currentTime);
        lfoGain.gain.setValueAtTime(0.008, ctx.currentTime);
        lfo.connect(oscGain.gain);
        lfo.start();

        osc.connect(oscGain);
        oscGain.connect(filter);
        osc.start();

        newOscs.push(osc);
        newGains.push(oscGain);
        newLfos.push(lfo);
      });

      activeNodesRef.current = { oscs: newOscs, gains: newGains, lfos: newLfos };
    } catch (err) {
      console.warn('Study music audio error:', err);
    }
  }, [stopActiveNodes]);

  // Toggle play / pause
  const togglePlay = () => {
    if (!isPlaying) {
      playSoundscape(currentTrackIndex);
      setIsPlaying(true);
      setSecondsRemaining(TRACK_DURATION_SECONDS);
      try {
        localStorage.setItem('patente_study_music', 'true');
      } catch {}
    } else {
      stopActiveNodes(0.5);
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        try {
          audioCtxRef.current.suspend();
        } catch {}
      }
      setIsPlaying(false);
      try {
        localStorage.setItem('patente_study_music', 'false');
      } catch {}
    }
  };

  // Next Track
  const handleNextTrack = () => {
    const nextIdx = (currentTrackIndex + 1) % SOUNDSCAPES.length;
    setCurrentTrackIndex(nextIdx);
    setSecondsRemaining(TRACK_DURATION_SECONDS);
    if (isPlaying) {
      playSoundscape(nextIdx);
    }
  };

  // Prev Track
  const handlePrevTrack = () => {
    const prevIdx = (currentTrackIndex - 1 + SOUNDSCAPES.length) % SOUNDSCAPES.length;
    setCurrentTrackIndex(prevIdx);
    setSecondsRemaining(TRACK_DURATION_SECONDS);
    if (isPlaying) {
      playSoundscape(prevIdx);
    }
  };

  // 5-Minute Auto-rotation timer
  useEffect(() => {
    if (!isPlaying) return;

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          // Trigger next track after 5 minutes!
          handleNextTrack();
          return TRACK_DURATION_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isPlaying, currentTrackIndex]);

  // Auto-ducking when Italian speech synthesis is speaking
  useEffect(() => {
    const handleSpeechCheck = () => {
      if (!masterGainRef.current || !audioCtxRef.current) return;
      const ctx = audioCtxRef.current;
      if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
        masterGainRef.current.gain.setTargetAtTime(0.008, ctx.currentTime, 0.1); // fade down during quiz reading
      } else {
        masterGainRef.current.gain.setTargetAtTime(isPlaying ? 0.08 : 0, ctx.currentTime, 0.4); // fade back up smoothly
      }
    };

    const interval = setInterval(handleSpeechCheck, 200);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Format seconds mm:ss
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={togglePlay}
          className={`py-2 sm:py-2.5 px-3 sm:px-3.5 rounded-xl border text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-xs ${
            isPlaying
              ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
          title={isPlaying ? 'Click to Stop Background Study Music' : 'Click to Play Relaxing Study Music (Rotates Every 5 Mins)'}
        >
          {isPlaying ? (
            <>
              <span className="flex items-center gap-0.5 h-3.5">
                <span className="w-1 h-2 bg-amber-500 rounded-full animate-bounce" />
                <span className="w-1 h-3.5 bg-amber-600 rounded-full animate-pulse" />
                <span className="w-1 h-2.5 bg-amber-500 rounded-full animate-bounce" />
              </span>
              <Volume2 className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="hidden sm:inline">Music ON ({formatTime(secondsRemaining)})</span>
            </>
          ) : (
            <>
              <Music className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="hidden sm:inline">Study Music (5 Min)</span>
            </>
          )}
        </button>

        {/* Small track info & skip controls button */}
        {isPlaying && (
          <button
            type="button"
            onClick={() => setShowControls(!showControls)}
            className="p-1.5 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-100/70 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 text-xs font-bold hover:bg-amber-200 cursor-pointer transition"
            title="Track details and manual controls"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Floating Track Information / 5-min Control Drawer */}
      {isPlaying && showControls && (
        <div className="absolute top-full right-0 mt-2 w-72 rounded-2xl bg-white dark:bg-slate-900 p-4 shadow-xl border border-slate-200 dark:border-slate-800 z-50 animate-fadeIn space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <span>Track {currentTrackIndex + 1} of {SOUNDSCAPES.length}</span>
            </span>
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
              Next in {formatTime(secondsRemaining)}
            </span>
          </div>

          <div>
            <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
              {currentTrack.title}
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {currentTrack.subtitle}
            </p>
          </div>

          {/* Progress bar to 5 minutes */}
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-amber-500 h-full rounded-full transition-all duration-1000"
              style={{
                width: `${((TRACK_DURATION_SECONDS - secondsRemaining) / TRACK_DURATION_SECONDS) * 100}%`,
              }}
            />
          </div>

          {/* Skip buttons */}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={handlePrevTrack}
              className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer flex items-center gap-1 transition"
            >
              <SkipBack className="w-3 h-3" />
              <span>Prev</span>
            </button>
            <span className="text-[10px] text-slate-400">Rotates every 5 min</span>
            <button
              type="button"
              onClick={handleNextTrack}
              className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer flex items-center gap-1 transition"
            >
              <span>Next</span>
              <SkipForward className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
