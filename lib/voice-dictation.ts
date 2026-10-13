import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useEffect, useRef, useState } from 'react';

import { voiceFailureMessage, voiceMissedSpeech } from '@/lib/voice-locale';

type VoiceDictationOptions = {
  locale: string;
  blocked: boolean;
  onTranscript: (text: string) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

export function useVoiceDictation({
  locale,
  blocked,
  onTranscript,
  onNotice,
  onError,
}: VoiceDictationOptions) {
  const [listening, setListening] = useState(false);
  const [holding, setHolding] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const holdingRef = useRef(false);
  const startedRef = useRef(false);
  const transcriptRef = useRef('');
  const failedRef = useRef(false);
  const missedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localeRef = useRef(locale);
  const blockedRef = useRef(blocked);
  const onTranscriptRef = useRef(onTranscript);
  const onNoticeRef = useRef(onNotice);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    localeRef.current = locale;
    blockedRef.current = blocked;
    onTranscriptRef.current = onTranscript;
    onNoticeRef.current = onNotice;
    onErrorRef.current = onError;
  }, [locale, blocked, onTranscript, onNotice, onError]);

  function clearTimer() {
    if (!timerRef.current) return;
    clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function beginTimer() {
    clearTimer();
    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed((value) => value + 1);
    }, 1000);
  }

  useSpeechRecognitionEvent('start', () => {
    if (!holdingRef.current) ExpoSpeechRecognitionModule.stop();
  });

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    transcriptRef.current = text;
    setTranscript(text);
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (voiceMissedSpeech(event.error)) {
      missedRef.current = true;
      return;
    }
    const message = voiceFailureMessage(event.error);
    if (!message) return;
    failedRef.current = true;
    onErrorRef.current(message);
  });

  useSpeechRecognitionEvent('end', () => {
    startedRef.current = false;
    holdingRef.current = false;
    clearTimer();
    setHolding(false);
    setListening(false);
    const text = transcriptRef.current.trim();
    const failed = failedRef.current;
    const missed = missedRef.current;
    transcriptRef.current = '';
    failedRef.current = false;
    missedRef.current = false;
    setTranscript('');
    if (failed) return;
    if (text) {
      onTranscriptRef.current(text);
      return;
    }
    if (missed) onNoticeRef.current('No se entendió la voz.');
  });

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (!startedRef.current) return;
      ExpoSpeechRecognitionModule.abort();
    };
  }, []);

  async function pressIn() {
    if (blockedRef.current || holdingRef.current || startedRef.current) return;
    holdingRef.current = true;
    setHolding(true);
    failedRef.current = false;
    missedRef.current = false;
    transcriptRef.current = '';
    setTranscript('');

    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        holdingRef.current = false;
        setHolding(false);
        onNoticeRef.current('Este teléfono no tiene reconocimiento de voz.');
        return;
      }
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!holdingRef.current) return;
      if (!permission.granted) {
        holdingRef.current = false;
        setHolding(false);
        onNoticeRef.current('Hermes Go necesita el micrófono para dictar.');
        return;
      }
      startedRef.current = true;
      setListening(true);
      beginTimer();
      ExpoSpeechRecognitionModule.start({
        lang: localeRef.current,
        interimResults: true,
      });
    } catch {
      startedRef.current = false;
      holdingRef.current = false;
      setHolding(false);
      setListening(false);
      clearTimer();
      onErrorRef.current('No se pudo dictar el mensaje.');
    }
  }

  function pressOut() {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setHolding(false);
    if (!startedRef.current) return;
    ExpoSpeechRecognitionModule.stop();
  }

  return { listening, holding, transcript, elapsed, pressIn, pressOut };
}
