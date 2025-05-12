import React from 'react'
import Header from './components/Header'
import Footer from './components/Footer'
import Recorder from './components/Recorder'
import './App.css'

const App: React.FC = () => {
  return (
    <div className="App" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="container">
        <Header />
        <main style={{ flex: 1, padding: '2rem 0', width: '100%' }}>
          {/* Controls and graph will go here */}
          <section style={{ marginBottom: '2rem' }}>
            <h2>Record and Playback</h2>
            <Recorder />
          </section>
          <section>
            <h2>Pitch Graph</h2>
            {/* Pitch graph placeholder */}
            <div style={{ height: 200, background: '#eee', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa' }}>
              Pitch graph will appear here
            </div>
          </section>
        </main>
        <Footer />
      </div>
    </div>
  )
}

export default App
