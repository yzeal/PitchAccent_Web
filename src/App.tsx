import React, { useState, useRef } from 'react'
import Footer from './components/Footer'
import Recorder from './components/Recorder'
import PitchGraphWithControls from './components/PitchGraph'
import './App.css'
import { PitchDetector } from 'pitchy'

// Median filter for smoothing
function medianFilter(arr: (number | null)[], windowSize: number): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < arr.length; i++) {
    const window: number[] = []
    for (let j = Math.max(0, i - Math.floor(windowSize / 2)); j <= Math.min(arr.length - 1, i + Math.floor(windowSize / 2)); j++) {
      if (arr[j] !== null && !isNaN(arr[j]!)) window.push(arr[j]!)
    }
    if (window.length > 0) {
      window.sort((a, b) => a - b)
      result.push(window[Math.floor(window.length / 2)])
    } else {
      result.push(null)
    }
  }
  return result
}

const MIN_PITCH = 60
const MAX_PITCH = 500
const MIN_CLARITY = 0.8
const MEDIAN_FILTER_SIZE = 5

// Type definitions
interface AudioContextType extends AudioContext {
  decodeAudioData: (arrayBuffer: ArrayBuffer) => Promise<AudioBuffer>;
}

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

const App: React.FC = () => {
  // User pitch data
  const [userPitchData, setUserPitchData] = useState<{ times: number[]; pitches: (number | null)[] }>({ times: [], pitches: [] })
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [userAudioUrl, setUserAudioUrl] = useState<string | undefined>(undefined)

  // Native pitch data
  const [nativePitchData, setNativePitchData] = useState<{ times: number[]; pitches: (number | null)[] }>({ times: [], pitches: [] })
  const [nativeMediaUrl, setNativeMediaUrl] = useState<string | null>(null)
  const [nativeMediaType, setNativeMediaType] = useState<'audio' | 'video' | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nativeVideoRef = useRef<HTMLVideoElement>(null)

  // Loop selection and delay state
  const [loopStart, setLoopStart] = useState(0)
  const [loopEnd, setLoopEnd] = useState(0)
  const [loopDelay, setLoopDelay] = useState(0)
  const [loopYFit, setLoopYFit] = useState<[number, number] | null>(null)
  const draggingRef = useRef(false)

  // Native playback time tracking
  const [nativePlaybackTime, setNativePlaybackTime] = useState(0);
  const [userPlaybackTime, setUserPlaybackTime] = useState(0);
  const userAudioRef = useRef<HTMLAudioElement>(null);
  const userAudioPlayingRef = useRef(false);

  // Extract pitch from user recording when audioBlob changes
  React.useEffect(() => {
    if (!audioBlob) return;
    const extract = async () => {
      try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)() as AudioContextType;
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const frameSize = 2048;
        const hopSize = 256;
        const detector = PitchDetector.forFloat32Array(frameSize);
        const pitches: (number | null)[] = [];
        const times: number[] = [];
        for (let i = 0; i + frameSize < channelData.length; i += hopSize) {
          const frame = channelData.slice(i, i + frameSize);
          const [pitch, clarity] = detector.findPitch(frame, sampleRate);
          if (pitch >= MIN_PITCH && pitch <= MAX_PITCH && clarity >= MIN_CLARITY) {
            pitches.push(pitch);
          } else {
            pitches.push(null);
          }
          times.push(i / sampleRate);
        }
        const smoothed = medianFilter(pitches, MEDIAN_FILTER_SIZE);
        setUserPitchData({ times, pitches: smoothed });
      } catch (error) {
        console.error('Error extracting pitch:', error);
        setUserPitchData({ times: [], pitches: [] });
      }
    };
    extract();
  }, [audioBlob]);

  // Pitch extraction for audio blobs
  const extractPitchFromAudioBlob = async (blob: Blob) => {
    try {
      const arrayBuffer = await blob.arrayBuffer()
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)() as AudioContextType
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
      const channelData = audioBuffer.getChannelData(0)
      const sampleRate = audioBuffer.sampleRate
      const frameSize = 2048
      const hopSize = 256
      const detector = PitchDetector.forFloat32Array(frameSize)
      const pitches: (number | null)[] = []
      const times: number[] = []
      for (let i = 0; i + frameSize < channelData.length; i += hopSize) {
        const frame = channelData.slice(i, i + frameSize)
        const [pitch, clarity] = detector.findPitch(frame, sampleRate)
        if (pitch >= MIN_PITCH && pitch <= MAX_PITCH && clarity >= MIN_CLARITY) {
          pitches.push(pitch)
        } else {
          pitches.push(null)
        }
        times.push(i / sampleRate)
      }
      const smoothed = medianFilter(pitches, MEDIAN_FILTER_SIZE)
      setNativePitchData({ times, pitches: smoothed })
    } catch (error) {
      console.error('Error extracting pitch from audio:', error);
      setNativePitchData({ times: [], pitches: [] })
    }
  }

  // Handle file input change
  const handleNativeFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setNativeMediaUrl(url)
    if (file.type.startsWith('audio/')) {
      setNativeMediaType('audio')
      await extractPitchFromAudioBlob(file)
    } else if (file.type.startsWith('video/')) {
      setNativeMediaType('video')
      try {
        const arrayBuffer = await file.arrayBuffer()
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)() as AudioContextType
        const videoBuffer = await audioCtx.decodeAudioData(arrayBuffer).catch(() => null)
        if (videoBuffer) {
          const channelData = videoBuffer.getChannelData(0)
          const sampleRate = videoBuffer.sampleRate
          const frameSize = 2048
          const hopSize = 256
          const detector = PitchDetector.forFloat32Array(frameSize)
          const pitches: (number | null)[] = []
          const times: number[] = []
          for (let i = 0; i + frameSize < channelData.length; i += hopSize) {
            const frame = channelData.slice(i, i + frameSize)
            const [pitch, clarity] = detector.findPitch(frame, sampleRate)
            if (pitch >= MIN_PITCH && pitch <= MAX_PITCH && clarity >= MIN_CLARITY) {
              pitches.push(pitch)
            } else {
              pitches.push(null)
            }
            times.push(i / sampleRate)
          }
          const smoothed = medianFilter(pitches, MEDIAN_FILTER_SIZE)
          setNativePitchData({ times, pitches: smoothed })
        } else {
          setNativePitchData({ times: [], pitches: [] })
        }
      } catch (error) {
        console.error('Error extracting pitch from video:', error);
        setNativePitchData({ times: [], pitches: [] })
      }
    } else {
      setNativeMediaType(null)
      setNativePitchData({ times: [], pitches: [] })
    }
  }

  // Ensure video is seeked to 0.01 and loaded when a new video is loaded (robust for short files)
  React.useEffect(() => {
    if (nativeMediaType === 'video' && nativeVideoRef.current) {
      const video = nativeVideoRef.current;
      const onLoaded = () => {
        video.currentTime = 0.01;
      };
      video.addEventListener('loadedmetadata', onLoaded);
      video.load();
      return () => video.removeEventListener('loadedmetadata', onLoaded);
    }
  }, [nativeMediaUrl, nativeMediaType]);

  // Update loop end when native media is loaded
  React.useEffect(() => {
    const duration = nativePitchData.times.length > 0 ? nativePitchData.times[nativePitchData.times.length - 1] : 0
    setLoopStart(0)
    setLoopEnd(duration)
  }, [nativePitchData.times])

  // --- Native playback time tracking ---
  React.useEffect(() => {
    const media = nativeVideoRef.current;
    if (!media) return;
    let raf: number | null = null;
    const update = () => {
      setNativePlaybackTime(media.currentTime || 0);
      raf = requestAnimationFrame(update);
    };
    if (!media.paused) {
      raf = requestAnimationFrame(update);
    }
    const onPlay = () => {
      raf = requestAnimationFrame(update);
    };
    const onPause = () => {
      if (raf) cancelAnimationFrame(raf);
    };
    media.addEventListener('play', onPlay);
    media.addEventListener('pause', onPause);
    return () => {
      media.removeEventListener('play', onPlay);
      media.removeEventListener('pause', onPause);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [nativeMediaUrl, nativeMediaType]);

  // --- Native media loop segment logic ---
  React.useEffect(() => {
    const media = nativeVideoRef.current;
    if (!media) return;
    let timeout: NodeJS.Timeout | null = null;
    if (
      !media.paused &&
      loopEnd > loopStart &&
      nativePlaybackTime >= loopEnd
    ) {
      media.pause();
      timeout = setTimeout(() => {
        media.currentTime = loopStart;
        media.play();
      }, loopDelay);
    }
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [nativePlaybackTime, loopStart, loopEnd, loopDelay]);

  // --- User recording playback time tracking ---
  React.useEffect(() => {
    const audio = userAudioRef.current;
    if (!audio) return;
    let raf: number | null = null;
    const update = () => {
      setUserPlaybackTime(audio.currentTime || 0);
      if (!audio.paused) {
        raf = requestAnimationFrame(update);
      }
    };
    const onPlay = () => {
      userAudioPlayingRef.current = true;
      raf = requestAnimationFrame(update);
    };
    const onPause = () => {
      userAudioPlayingRef.current = false;
      if (raf) cancelAnimationFrame(raf);
    };
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [userPitchData.times, audioBlob]);

  // On initial load or when nativePitchData changes, fit y axis to full pitch curve
  React.useEffect(() => {
    if (!nativePitchData.pitches.length) return;
    const pitches = nativePitchData.pitches.filter(p => p !== null) as number[];
    if (pitches.length > 0) {
      let minPitch = Math.min(...pitches);
      let maxPitch = Math.max(...pitches);
      minPitch = Math.floor(minPitch - 20);
      maxPitch = Math.ceil(maxPitch + 20);
      minPitch = Math.max(0, minPitch);
      maxPitch = Math.min(600, maxPitch);
      if (maxPitch - minPitch < 200) {
        const center = (maxPitch + minPitch) / 2;
        minPitch = Math.max(0, Math.floor(center - 100));
        maxPitch = Math.min(600, Math.ceil(center + 100));
      }
      if (maxPitch - minPitch > 600) {
        const center = (maxPitch + minPitch) / 2;
        minPitch = Math.max(0, Math.floor(center - 300));
        maxPitch = Math.min(600, Math.ceil(center + 300));
      }
      setLoopYFit([minPitch, maxPitch]);
    }
  }, [nativePitchData.pitches]);

  // Function to fit y axis to the current loop region
  function fitYAxisToLoop() {
    if (!nativePitchData.times.length) return;
    const startIdx = nativePitchData.times.findIndex(t => t >= loopStart);
    const endIdx = nativePitchData.times.findIndex(t => t >= loopEnd);
    const pitches = nativePitchData.pitches.slice(
      startIdx >= 0 ? startIdx : 0,
      endIdx > 0 ? endIdx : nativePitchData.pitches.length
    ).filter(p => p !== null) as number[];
    if (pitches.length > 0) {
      let minPitch = Math.min(...pitches);
      let maxPitch = Math.max(...pitches);
      minPitch = Math.floor(minPitch - 20);
      maxPitch = Math.ceil(maxPitch + 20);
      minPitch = Math.max(0, minPitch);
      maxPitch = Math.min(600, maxPitch);
      if (maxPitch - minPitch < 200) {
        const center = (maxPitch + minPitch) / 2;
        minPitch = Math.max(0, Math.floor(center - 100));
        maxPitch = Math.min(600, Math.ceil(center + 100));
      }
      if (maxPitch - minPitch > 600) {
        const center = (maxPitch + minPitch) / 2;
        minPitch = Math.max(0, Math.floor(center - 300));
        maxPitch = Math.min(600, Math.ceil(center + 300));
      }
      setLoopYFit([minPitch, maxPitch]);
    } else {
      // If region is empty, fit to full pitch curve
      const allPitches = nativePitchData.pitches.filter(p => p !== null) as number[];
      if (allPitches.length > 0) {
        let minPitch = Math.min(...allPitches);
        let maxPitch = Math.max(...allPitches);
        minPitch = Math.floor(minPitch - 20);
        maxPitch = Math.ceil(maxPitch + 20);
        minPitch = Math.max(0, minPitch);
        maxPitch = Math.min(600, maxPitch);
        if (maxPitch - minPitch < 200) {
          const center = (maxPitch + minPitch) / 2;
          minPitch = Math.max(0, Math.floor(center - 100));
          maxPitch = Math.min(600, Math.ceil(center + 100));
        }
        if (maxPitch - minPitch > 600) {
          const center = (maxPitch + minPitch) / 2;
          minPitch = Math.max(0, Math.floor(center - 300));
          maxPitch = Math.min(600, Math.ceil(center + 300));
        }
        setLoopYFit([minPitch, maxPitch]);
      }
    }
  }

  React.useEffect(() => {
    if (!audioBlob) {
      setUserAudioUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(audioBlob);
    setUserAudioUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [audioBlob]);

  return (
    <div className="App" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="container">
        <h1 className="chorusing-title">Chorusing Drill</h1>
        <main style={{ flex: 1, padding: '1rem 0', width: '100%' }}>
          {/* Native Recording Section */}
          <section style={{ marginBottom: '1rem' }}>
            <input
              type="file"
              accept="audio/*,video/*"
              style={{ display: 'none' }}
              ref={fileInputRef}
              onChange={handleNativeFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: '8px 20px',
                borderRadius: 4,
                border: 'none',
                background: '#388e3c',
                color: '#fff',
                fontWeight: 500,
                cursor: 'pointer',
                marginBottom: '0.75rem',
                fontSize: '1rem'
              }}
            >
              Load Native Recording
            </button>
            {nativeMediaUrl && nativeMediaType === 'audio' && (
              <audio
                src={nativeMediaUrl}
                controls
                style={{
                  width: '100%',
                  marginBottom: '0.75rem',
                  maxWidth: '100%'
                }}
                ref={nativeVideoRef as any}
              />
            )}
            {nativeMediaUrl && nativeMediaType === 'video' && (
              <video
                ref={nativeVideoRef}
                src={nativeMediaUrl}
                controls
                playsInline
                loop
                style={{
                  width: '100%',
                  maxHeight: '180px',
                  marginBottom: '0.75rem',
                  maxWidth: '100%'
                }}
              />
            )}
            {/* Loop selection and delay controls (moved above the curve) */}
            {nativePitchData.times.length > 0 && (
              <div style={{ margin: '0.5rem 0 0.5rem 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ width: '100%', maxWidth: 400, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12 }}>Loop region:</span>
                  <input
                    type="range"
                    min={0}
                    max={nativePitchData.times[nativePitchData.times.length - 1]}
                    step={0.01}
                    value={loopStart}
                    onChange={e => {
                      const newStart = Number(e.target.value);
                      setLoopStart(newStart);
                      if (newStart > loopEnd) setLoopEnd(newStart);
                    }}
                    onMouseDown={() => { draggingRef.current = true; }}
                    onTouchStart={() => { draggingRef.current = true; }}
                    onMouseUp={() => {
                      draggingRef.current = false;
                      fitYAxisToLoop();
                    }}
                    onTouchEnd={() => {
                      draggingRef.current = false;
                      fitYAxisToLoop();
                    }}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: 12 }}>{loopStart.toFixed(2)}s</span>
                  <input
                    type="range"
                    min={0}
                    max={nativePitchData.times[nativePitchData.times.length - 1]}
                    step={0.01}
                    value={loopEnd}
                    onChange={e => {
                      const newEnd = Number(e.target.value);
                      setLoopEnd(newEnd);
                      if (newEnd < loopStart) setLoopStart(newEnd);
                    }}
                    onMouseDown={() => { draggingRef.current = true; }}
                    onTouchStart={() => { draggingRef.current = true; }}
                    onMouseUp={() => {
                      draggingRef.current = false;
                      fitYAxisToLoop();
                    }}
                    onTouchEnd={() => {
                      draggingRef.current = false;
                      fitYAxisToLoop();
                    }}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: 12 }}>{loopEnd.toFixed(2)}s</span>
                  <button
                    onClick={() => {
                      const duration = nativePitchData.times.length > 0 ? nativePitchData.times[nativePitchData.times.length - 1] : 0;
                      setLoopStart(0);
                      setLoopEnd(duration);
                    }}
                    title="Reset Loop Region"
                    style={{
                      padding: '2px 6px',
                      borderRadius: '50%',
                      border: 'none',
                      background: 'transparent',
                      color: '#1976d2',
                      fontSize: '1.1rem',
                      cursor: 'pointer',
                      minWidth: 0,
                      minHeight: 0,
                      lineHeight: 1,
                      marginLeft: 8,
                    }}
                  >
                    ↺
                  </button>
                </div>
                <div style={{ width: '100%', maxWidth: 400, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12 }}>Loop delay (ms):</span>
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    step={50}
                    value={loopDelay}
                    onChange={e => setLoopDelay(Number(e.target.value))}
                    style={{ width: 60 }}
                  />
                </div>
              </div>
            )}
            <PitchGraphWithControls
              times={nativePitchData.times}
              pitches={nativePitchData.pitches}
              label="Native Pitch (Hz)"
              color="#388e3c"
              loopStart={loopStart}
              loopEnd={loopEnd}
              yFit={loopYFit}
              playbackTime={nativePlaybackTime}
            />
          </section>

          {/* User Recording Section */}
          <section>
            <PitchGraphWithControls
              times={userPitchData.times}
              pitches={userPitchData.pitches}
              label="Your Pitch (Hz)"
              color="#1976d2"
              playbackTime={userPlaybackTime}
            />
            <Recorder
              onRecordingComplete={(_, blob: Blob) => setAudioBlob(blob)}
              audioUrl={userAudioUrl}
              audioRef={userAudioRef}
              showPlayer={true}
            />
          </section>
        </main>
        <Footer />
      </div>
      <style>{`
        .pitch-graph-container {
          touch-action: pinch-zoom pan-x pan-y;
        }
        @media (max-width: 768px) {
          .container {
            width: 100vw;
            overflow-x: hidden;
            box-sizing: border-box;
            padding-left: max(2vw, env(safe-area-inset-left));
            padding-right: max(2vw, env(safe-area-inset-right));
          }
          .pitch-graph-container {
            touch-action: none;
            height: 80px !important;
            min-height: 80px !important;
            max-height: 80px !important;
            width: 100% !important;
            max-width: 100% !important;
            box-sizing: border-box;
            padding: 0;
            margin: 0;
          }
          .chorusing-title {
            font-size: 1.3rem;
            margin-bottom: 0.5rem;
          }
          .container, main, section, .pitch-graph-container, .chorusing-title {
            font-size: 0.95rem;
          }
          button, input, select {
            font-size: 0.95rem !important;
            padding: 4px 8px !important;
          }
        }
        body {
          overflow-x: hidden;
        }
      `}</style>
    </div>
  )
}

export default App
