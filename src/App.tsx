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

const App: React.FC = () => {
  // User pitch data
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [userPitchData, setUserPitchData] = useState<{ times: number[]; pitches: (number | null)[] }>({ times: [], pitches: [] })

  // Native pitch data
  const [nativePitchData, setNativePitchData] = useState<{ times: number[]; pitches: (number | null)[] }>({ times: [], pitches: [] })
  const [nativeMediaUrl, setNativeMediaUrl] = useState<string | null>(null)
  const [nativeMediaType, setNativeMediaType] = useState<'audio' | 'video' | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nativeVideoRef = useRef<HTMLVideoElement>(null)

  // Extract pitch from user recording when audioBlob changes
  React.useEffect(() => {
    if (!audioBlob) return;
    const extract = async () => {
      try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
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
      } catch (e) {
        setUserPitchData({ times: [], pitches: [] });
      }
    };
    extract();
  }, [audioBlob]);

  // Pitch extraction for audio blobs
  const extractPitchFromAudioBlob = async (blob: Blob) => {
    try {
      const arrayBuffer = await blob.arrayBuffer()
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
      const channelData = audioBuffer.getChannelData(0) // Use first channel
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
    } catch (e) {
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
      // Extract audio from video using MediaSource Extensions (browser support required)
      try {
        // Try to decode audio from video file
        const arrayBuffer = await file.arrayBuffer()
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
        const videoBuffer = await audioCtx.decodeAudioData(arrayBuffer).catch(() => null)
        if (videoBuffer) {
          // Some browsers can decode audio from video directly
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
          // Fallback: cannot extract audio from video in browser
          setNativePitchData({ times: [], pitches: [] })
        }
      } catch (err) {
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

  return (
    <div className="App" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="container">
        <Header />
        <main style={{ flex: 1, padding: '2rem 0', width: '100%' }}>
          {/* Controls and graph will go here */}
          {/* Native Recording Section */}
          <section style={{ marginBottom: '2rem' }}>
            <h2>Native Recording</h2>
            <input
              type="file"
              accept="audio/*,video/*"
              style={{ display: 'none' }}
              ref={fileInputRef}
              onChange={handleNativeFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{ padding: '8px 20px', borderRadius: 4, border: 'none', background: '#388e3c', color: '#fff', fontWeight: 500, cursor: 'pointer', marginBottom: 16 }}
            >
              Load Native Recording
            </button>
            {nativeMediaUrl && nativeMediaType === 'audio' && (
              <audio src={nativeMediaUrl} controls style={{ width: '100%', marginBottom: 16 }} />
            )}
            {nativeMediaUrl && nativeMediaType === 'video' && (
              <video ref={nativeVideoRef} src={nativeMediaUrl} controls style={{ width: '100%', maxHeight: 240, marginBottom: 16 }} />
            )}
            <PitchGraphWithControls
              times={nativePitchData.times || []}
              pitches={nativePitchData.pitches || []}
              label="Native Pitch (Hz)"
              color="#388e3c"
            />
          </section>
          {/* User Recording Section */}
          <section style={{ marginBottom: '2rem' }}>
            <h2>User Recording</h2>
            <PitchGraphWithControls
              times={userPitchData.times || []}
              pitches={userPitchData.pitches || []}
              label="User Pitch (Hz)"
              color="#1976d2"
            />
            <Recorder onRecordingComplete={(url, blob) => { setAudioUrl(url); setAudioBlob(blob); }} />
          </section>
        </main>
        <Footer />
      </div>
    </div>
  )
}

export default App
