import React, { useState } from 'react'
import Header from './components/Header'
import Footer from './components/Footer'
import Recorder from './components/Recorder'
import PitchGraph from './components/PitchGraph'
import './App.css'

const App: React.FC = () => {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  return (
    <div className="App" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="container">
        <Header />
        <main style={{ flex: 1, padding: '2rem 0', width: '100%' }}>
          {/* Controls and graph will go here */}
          <section style={{ marginBottom: '2rem' }}>
            <h2>Record and Playback</h2>
            <Recorder onRecordingComplete={(url, blob) => { setAudioUrl(url); setAudioBlob(blob); }} />
          </section>
          <section>
            <h2>Pitch Graph</h2>
            <PitchGraph audioBlob={audioBlob} />
          </section>
        </main>
        <Footer />
      </div>
    </div>
  )
}

export default App
