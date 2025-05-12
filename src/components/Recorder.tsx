import React, { useRef, useState } from 'react';
import Button from '@mui/material/Button';

interface RecorderProps {
  onRecordingComplete?: (audioUrl: string, audioBlob: Blob) => void;
}

const getSupportedMimeType = () => {
  const mimeTypes = [
    'audio/mp4', // AAC (iOS Safari)
    'audio/mpeg', // MP3
    'audio/webm', // Opus (Chrome, Firefox)
    'audio/ogg', // Ogg Vorbis
    'audio/wav', // WAV (not always supported for MediaRecorder)
  ];
  for (const type of mimeTypes) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
};

const Recorder: React.FC<RecorderProps> = ({ onRecordingComplete }) => {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [status, setStatus] = useState<'idle' | 'recording' | 'stopped'>('idle');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startRecording = async () => {
    setError(null);
    setAudioUrl(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        if (onRecordingComplete) {
          onRecordingComplete(url, blob);
        }
      };
      recorder.start();
      setStatus('recording');
    } catch (err: any) {
      setError('Could not start recording: ' + (err.message || err));
      setStatus('idle');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && status === 'recording') {
      mediaRecorderRef.current.stop();
      setStatus('stopped');
    }
  };

  const clearRecording = () => {
    setAudioUrl(null);
    setStatus('idle');
    setError(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div>Status: <b>{status}</b></div>
      {error && <div style={{ color: 'red', fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="contained" color="primary" onClick={startRecording} disabled={status === 'recording'}>
          Record
        </Button>
        <Button variant="contained" color="secondary" onClick={stopRecording} disabled={status !== 'recording'}>
          Stop
        </Button>
        <Button variant="outlined" onClick={clearRecording} disabled={!audioUrl}>
          Clear
        </Button>
      </div>
      {audioUrl && (
        <audio src={audioUrl} controls style={{ marginTop: 16 }} />
      )}
    </div>
  );
};

export default Recorder; 