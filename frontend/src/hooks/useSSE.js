import { useState, useCallback, useRef } from 'react';

export function useSSE(apiBase = 'http://localhost:8000') {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [activeTask, setActiveTask] = useState('');
  const [liveLogText, setLiveLogText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const activeJobIdRef = useRef(null);

  const startStream = useCallback(async (endpoint, payload, taskName, onComplete) => {
    setIsProcessing(true);
    setProgressPercent(2);
    setActiveTask(taskName);
    setLiveLogText('Connecting to engine...');
    setErrorMessage('');

    try {
      const response = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || 'Request failed. Check stash_error_log.txt.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.replace('data: ', ''));

              if (eventData.job_id) {
                activeJobIdRef.current = eventData.job_id;
              }

              if (eventData.type === 'start') {
                if (eventData.message) setLiveLogText(eventData.message);
              } else if (eventData.type === 'progress') {
                if (eventData.percent !== undefined) setProgressPercent(eventData.percent);
                if (eventData.text) setLiveLogText(eventData.text);
              } else if (eventData.type === 'complete') {
                setProgressPercent(100);
                if (onComplete) onComplete(eventData.result);
              } else if (eventData.type === 'error') {
                setErrorMessage(eventData.message || 'Processing failed.');
              }
            } catch (e) {
              console.error('SSE parse error:', e);
            }
          }
        }
      }
    } catch (err) {
      setErrorMessage(err.message || 'Connection error with engine.');
    } finally {
      setIsProcessing(false);
      activeJobIdRef.current = null;
    }
  }, [apiBase]);

  const stopStream = useCallback(async () => {
    try {
      const jobId = activeJobIdRef.current;
      await fetch(`${apiBase}/api/stop-process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId })
      });
      setIsProcessing(false);
      setLiveLogText('Process cancelled by user.');
    } catch (err) {
      console.error('Failed to stop process:', err);
    }
  }, [apiBase]);

  return {
    isProcessing,
    progressPercent,
    activeTask,
    liveLogText,
    errorMessage,
    startStream,
    stopStream,
    setErrorMessage
  };
}
