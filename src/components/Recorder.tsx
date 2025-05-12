import React from 'react';
import { ReactMediaRecorder } from 'react-media-recorder';
import Button from '@mui/material/Button';

interface RecorderProps {
  onRecordingComplete?: (audioUrl: string, audioBlob: Blob) => void;
}

const Recorder: React.FC<RecorderProps> = ({ onRecordingComplete }) => (
  <ReactMediaRecorder
    audio
    onStop={(blobUrl, blob) => {
      if (onRecordingComplete) {
        onRecordingComplete(blobUrl, blob);
      }
    }}
    render={({ status, startRecording, stopRecording, mediaBlobUrl, clearBlobUrl }) => (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div>Status: <b>{status}</b></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="contained" color="primary" onClick={startRecording} disabled={status === 'recording'}>
            Record
          </Button>
          <Button variant="contained" color="secondary" onClick={stopRecording} disabled={status !== 'recording'}>
            Stop
          </Button>
          <Button variant="outlined" onClick={clearBlobUrl} disabled={!mediaBlobUrl}>
            Clear
          </Button>
        </div>
        {mediaBlobUrl && (
          <audio src={mediaBlobUrl} controls style={{ marginTop: 16 }} />
        )}
      </div>
    )}
  />
);

export default Recorder; 