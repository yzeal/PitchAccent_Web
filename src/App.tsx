import React, { useState, useRef } from 'react'
import Header from './components/Header'
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

  // --- Native media loop playback logic ---
  React.useEffect(() => {
    const media = nativeVideoRef.current;
    if (!media || !nativeMediaUrl) return;
    let timeout: NodeJS.Timeout | null = null;

    const onTimeUpdate = () => {
      if (media.currentTime >= loopEnd && loopEnd > loopStart) {
        media.pause();
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          media.currentTime = loopStart;
          media.play();
        }, loopDelay);
      }
    };

    // Always seek to loopStart if user presses play and currentTime is outside loop
    const onPlay = () => {
      if (media.currentTime < loopStart || media.currentTime > loopEnd) {
        media.currentTime = loopStart;
      }
    };

    media.addEventListener('timeupdate', onTimeUpdate);
    media.addEventListener('play', onPlay);

    // If loop region changes, and media is playing, jump to new loopStart
    if (media.currentTime < loopStart || media.currentTime > loopEnd) {
      media.currentTime = loopStart;
    }

    return () => {
      media.removeEventListener('timeupdate', onTimeUpdate);
      media.removeEventListener('play', onPlay);
      if (timeout) clearTimeout(timeout);
    };
  }, [nativeMediaUrl, loopStart, loopEnd, loopDelay, nativeMediaType]);

  return (
    <div className="App" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="container">
        <Header />
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
                    onChange={e => setLoopStart(Number(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: 12 }}>{loopStart.toFixed(2)}s</span>
                  <input
                    type="range"
                    min={0}
                    max={nativePitchData.times[nativePitchData.times.length - 1]}
                    step={0.01}
                    value={loopEnd}
                    onChange={e => setLoopEnd(Number(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: 12 }}>{loopEnd.toFixed(2)}s</span>
                  <button
                    style={{ fontSize: 12, padding: '2px 8px', marginLeft: 8 }}
                    onClick={() => {
                      setLoopStart(0)
                      setLoopEnd(nativePitchData.times[nativePitchData.times.length - 1])
                    }}
                  >Reset</button>
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
            />
          </section>

          {/* User Recording Section */}
          <section>
            <PitchGraphWithControls
              times={userPitchData.times}
              pitches={userPitchData.pitches}
              label="Your Pitch (Hz)"
              color="#1976d2"
            />
            <Recorder onRecordingComplete={(_, blob) => setAudioBlob(blob)} />
          </section>
        </main>
        <Footer />
      </div>
    </div>
  )
}

export default App
