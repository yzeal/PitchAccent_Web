import React, { useState } from 'react'
import Header from './components/Header'
import Footer from './components/Footer'
import Recorder from './components/Recorder'
import PitchGraphWithControls from './components/PitchGraph'
import './App.css'

const App: React.FC = () => {
  // User pitch data
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [userPitchData, setUserPitchData] = useState<{ times: number[]; pitches: (number | null)[] }>({ times: [], pitches: [] });

  // Native pitch data (placeholder for now)
  const [nativePitchData, setNativePitchData] = useState<{ times: number[]; pitches: (number | null)[] }>({ times: [], pitches: [] });

  // Handler for user pitch extraction (to be called from Recorder or pitch extraction logic)
  const handleUserPitchExtracted = (times: number[], pitches: (number | null)[]) => {
    setUserPitchData({ times, pitches });
  };

  // Handler for native pitch extraction (to be implemented when file loading is added)
  const handleNativePitchExtracted = (times: number[], pitches: (number | null)[]) => {
    setNativePitchData({ times, pitches });
  };

  return (
    <div className="App" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="container">
        <Header />
        <main style={{ flex: 1, padding: '2rem 0', width: '100%' }}>
          {/* Controls and graph will go here */}
          {/* Native Recording Section */}
          <section style={{ marginBottom: '2rem' }}>
            <h2>Native Recording</h2>
            {/* TODO: Add file input and media player here */}
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
