import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { ArrowUpIcon, ChevronDownIcon, MicrophoneIcon, PlusIcon } from 'react-native-heroicons/outline';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AttachSheet, type AttachAction } from '@/components/attach-sheet';
import { MessageList, showableImage, type ChatLine } from '@/components/chat-message-list';
import { MessageActions } from '@/components/message-actions';
import { ModelSheet } from '@/components/model-sheet';
import type { ReasoningNote } from '@/components/reasoning-fold';
import { ConnectionDot } from '@/components/connection-dot';
import { ScreenShell } from '@/components/screen-shell';
import { Text } from '@/components/ui/text';
import { RequireConnection, useConnection, useHermesClient } from '@/contexts/connection-context';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import { useVoiceLocale } from '@/contexts/voice-locale-context';
import { formatByteSize } from '@/lib/format';
import { strings } from '@/lib/i18n';
import { useKeyboardInset } from '@/lib/keyboard-inset';
import {
  describeHermesError,
  finalAssistantReply,
  HermesError,
  messageText,
  sseEventName,
  type ChatContentPart,
  type ChatInput,
  type HermesMessage,
  type SseEvent,
} from '@/lib/hermes';
import { PickerError, pickCameraImage, pickLibraryImage } from '@/lib/pickers';
import { useVoiceDictation } from '@/lib/voice-dictation';
import {
  finishRun,
  lastMessageOf,
  rememberLastMessage,
  setRunActivity,
  startRun,
  useSessionRunning,
} from '@/lib/session-activity';
import { createSessionCache } from '@/lib/chat-cache';
import {
  advanceStatus,
  createStreamWatchdog,
  phaseAfterEvent,
  runFailureMessage,
  stopReason,
  toolNameOf,
  type StreamPhase,
  type StreamStatus,
  type StreamWatchdog,
} from '@/lib/stream-progress';
import { recoveryError, settleRun } from '@/lib/run-recovery';
import { applyStoredImages, imageFingerprint } from '@/lib/sent-image-index';
import { discardSentImage, loadSentImages, rememberSentImage, saveOutgoingImage } from '@/lib/sent-images';

type ChatSnapshot = { title: string; lines: ChatLine[] };

// Sobrevive a la pantalla: al volver a una conversación se pinta lo último visto y se
// refresca contra el servidor en segundo plano.
const chatCache = createSessionCache<ChatSnapshot>();

type PendingAttachment = {
  id: string;
  kind: 'image';
  name: string;
  sizeLabel: string;
  uri: string;
  mimeType: string;
  dataUrl?: string;
};

type PendingApproval = {
  runId: string;
  command: string;
  description: string;
  choices: string[];
};

type OutgoingMessage = {
  text: string;
  files: PendingAttachment[];
  userLineId: string;
};

/** Texto y razonamiento llegados por stream que todavía no se pintaron. */
type DeltaBuffer = { assistantId: string; text: string; reasoning: string };

/** Cada cuánto se pintan los tokens acumulados: un render por tanda en vez de uno por token. */
const DELTA_FLUSH_MS = 50;

function oneParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function visibleText(message: HermesMessage): string {
  if (!message.attachments.length) return message.text;
  return message.text
    .split('\n')
    .filter((line) => line.trim() !== '[imagen]')
    .join('\n')
    .trim();
}

function assistantLine(id: string, text: string, notes: ReasoningNote[] = []): ChatLine {
  return { id, kind: 'assistant', text, attachments: [], notes };
}

function toolNote(message: HermesMessage): ReasoningNote {
  const name = message.toolName || strings().stream.tool;
  const body = message.text.trim();
  return {
    id: message.id,
    kind: 'tool',
    text: name,
    preview: body && body !== name ? body : undefined,
  };
}

function linesFromMessages(messages: HermesMessage[]): ChatLine[] {
  const lines: ChatLine[] = [];
  let pending: ReasoningNote[] = [];

  function flushPending() {
    const first = pending[0];
    if (!first) return;
    lines.push(assistantLine(`notes-${first.id}`, '', pending));
    pending = [];
  }

  for (const message of messages) {
    if (message.role === 'user') {
      flushPending();
      const text = visibleText(message);
      if (!text && message.attachments.length === 0) continue;
      lines.push({
        id: message.id,
        kind: 'user',
        text,
        attachments: message.attachments.map((item) => ({
          label: `🖼 ${item.label}`,
          uri: item.url ?? undefined,
        })),
        notes: [],
        steer: message.steer,
      });
      continue;
    }

    if (message.role === 'tool' || (message.toolName && message.role !== 'assistant' && message.role !== 'commentary')) {
      pending.push(toolNote(message));
      continue;
    }

    if (message.role === 'commentary') {
      const text = message.text.trim() || message.reasoning.trim();
      if (text) pending.push({ id: message.id, kind: 'commentary', text });
      continue;
    }

    if (message.role === 'assistant' && message.text.trim()) {
      const notes = [...pending];
      if (message.reasoning.trim()) {
        notes.unshift({ id: `reason-${message.id}`, kind: 'reasoning', text: message.reasoning.trim() });
      }
      pending = [];
      lines.push(assistantLine(message.id, message.text, notes));
      continue;
    }

    if (message.reasoning.trim()) {
      pending.push({ id: `reason-${message.id}`, kind: 'reasoning', text: message.reasoning.trim() });
      continue;
    }

    if (message.toolName) pending.push(toolNote(message));
  }

  flushPending();
  return lines;
}

function eventText(data: Record<string, unknown>): string {
  for (const key of ['delta', 'text', 'content'] as const) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function withReasoning(line: ChatLine, chunk: string, snapshot: boolean): ChatLine {
  const index = line.notes.findIndex((note) => note.kind === 'reasoning');
  if (index === -1) {
    return { ...line, notes: [...line.notes, { id: `reason-${line.id}`, kind: 'reasoning', text: chunk }] };
  }
  const current = line.notes[index];
  if (!current || (snapshot && current.text.trim())) return line;
  return {
    ...line,
    notes: line.notes.map((note, noteIndex) =>
      noteIndex === index ? { ...note, text: snapshot ? chunk : note.text + chunk } : note,
    ),
  };
}

function withToolPreview(line: ChatLine, prefix: string, tool: string, preview: string): ChatLine {
  let target = -1;
  line.notes.forEach((note, index) => {
    if (note.kind === 'tool' && note.id.startsWith(prefix) && note.text === tool) target = index;
  });
  if (target === -1) return line;
  return {
    ...line,
    notes: line.notes.map((note, index) => (index === target ? { ...note, preview } : note)),
  };
}

function explain(error: unknown): string {
  if (error instanceof PickerError) return error.message;
  return describeHermesError(error);
}

function chipLabel(name: string, sizeLabel: string): string {
  return sizeLabel ? `🖼 ${name} · ${sizeLabel}` : `🖼 ${name}`;
}

function choiceLabel(choice: string): string {
  const labels: Record<string, string> = strings().approval.choices;
  return labels[choice] ?? choice;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export default function ChatScreen() {
  return (
    <RequireConnection>
      <ChatBody />
    </RequireConnection>
  );
}

function ChatBody() {
  const params = useLocalSearchParams<{ id: string; title?: string }>();
  const sessionId = oneParam(params.id);
  const client = useHermesClient();
  const [cached] = useState(() => chatCache.get(client, sessionId));
  const { modelForSession, supports } = useConnection();
  const { theme } = useTheme();
  const t = theme.tokens;
  const str = useStrings();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const keyboard = useKeyboardInset();
  const scrollRef = useRef<ScrollView>(null);
  const [title, setTitle] = useState(
    () => cached?.title || oneParam(params.title) || str.chat.title,
  );
  const [lines, setLines] = useState<ChatLine[]>(() => cached?.lines ?? []);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Texto a reenviar desde el aviso de error; solo se ofrece mientras se ve ese mismo error.
  const [retry, setRetry] = useState<{ error: string; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cached);
  // Solo va a la caché lo que vino del servidor o de la propia caché, nunca el estado
  // vacío de una carga fallida.
  const [synced, setSynced] = useState(Boolean(cached));
  const [sending, setSending] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [menu, setMenu] = useState<{ id: string; text: string } | null>(null);
  const [viewerUri, setViewer] = useState<string | null>(null);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [streamId, setStreamId] = useState<string | null>(null);
  // El `run_id` del turno en curso, para ofrecer corregirlo.
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const [steering, setSteering] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolCount = useRef(0);
  const runIdRef = useRef<string | null>(null);
  // Correcciones mandadas en este turno, por si Hermes las devuelve sin entregar.
  const steerIdsRef = useRef<string[]>([]);
  const queueRef = useRef<OutgoingMessage[]>([]);
  const pumpingRef = useRef(false);
  const sendSeq = useRef(0);
  const sentDuringLoad = useRef(false);
  const deltaRef = useRef<DeltaBuffer | null>(null);
  const deltaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<StreamWatchdog | null>(null);

  const runningAnywhere = useSessionRunning(sessionId);
  const backgroundRun = runningAnywhere && !sending;
  const model = modelForSession(sessionId);
  const canSend = draft.trim().length > 0 || pending.length > 0;
  // Solo texto, con el turno en marcha y sin una aprobación pendiente (Hermes no acepta
  // correcciones mientras espera tu decisión).
  const canSteer =
    supports('run_steer') && sending && liveRunId !== null && status !== null && !approval && !steering && pending.length === 0 && draft.trim().length > 0;
  const { locale: voiceLocale } = useVoiceLocale();
  const dictation = useVoiceDictation({
    locale: voiceLocale,
    blocked: sending || backgroundRun || loading || canSend,
    onTranscript: (text) => {
      void onSend(text);
    },
    onNotice: setNotice,
    onError: setError,
  });

  const [reloadKey, setReloadKey] = useState(0);
  const hadBackgroundRun = useRef(false);

  // Si la respuesta empezó en una visita anterior a este chat, al terminar recargamos.
  useEffect(() => {
    if (backgroundRun) {
      hadBackgroundRun.current = true;
      return;
    }
    if (!hadBackgroundRun.current) return;
    hadBackgroundRun.current = false;
    setReloadKey((key) => key + 1);
  }, [backgroundRun]);

  useEffect(() => {
    let cancelled = false;
    sentDuringLoad.current = false;
    const loaded = Promise.all([
      client.getSession(sessionId),
      client.getMessages(sessionId),
      loadSentImages(sessionId),
    ]);
    loaded
      .then(([session, messages, stored]) => {
        if (cancelled) return;
        setTitle(session.title);
        // Con la caché en pantalla se puede escribir antes de que llegue esta respuesta, que
        // todavía no trae ese turno: pisar las líneas borraría el mensaje en curso.
        if (!sentDuringLoad.current) {
          setLines(linesFromMessages(applyStoredImages(messages, stored)));
        }
        setSynced(true);
        rememberLastMessage(sessionId, lastMessageOf(messages), session.updatedAt);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeHermesError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, sessionId, reloadKey]);

  useEffect(() => {
    if (synced) chatCache.set(client, sessionId, { title, lines });
  }, [client, sessionId, synced, title, lines]);

  useEffect(() => {
    alive.current = true;
    return () => {
      // No cortamos el stream al salir: la respuesta sigue y la lista la muestra en curso.
      alive.current = false;
      if (copyTimer.current) clearTimeout(copyTimer.current);
      if (deltaTimer.current) clearTimeout(deltaTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!keyboard.visible) return;
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [keyboard.height, keyboard.visible]);

  function enterPhase(phase: StreamPhase | null) {
    if (!alive.current) return;
    setStatus((current) => (phase ? advanceStatus(current, phase, Date.now()) : null));
  }

  /** Como `enterPhase`, pero solo si la respuesta sigue en alguna de esas etapas. */
  function advanceFrom(kinds: StreamPhase['kind'][], phase: StreamPhase) {
    if (!alive.current) return;
    setStatus((current) =>
      current && kinds.includes(current.phase.kind) ? advanceStatus(current, phase, Date.now()) : current,
    );
  }

  function patchAssistant(assistantId: string, patch: (line: ChatLine) => ChatLine) {
    setLines((current) => {
      const existing = current.find((line) => line.id === assistantId);
      if (!existing) return [...current, patch(assistantLine(assistantId, ''))];
      return current.map((line) => (line.id === assistantId ? patch(line) : line));
    });
  }

  function flushDeltas() {
    if (deltaTimer.current) {
      clearTimeout(deltaTimer.current);
      deltaTimer.current = null;
    }
    const buffered = deltaRef.current;
    deltaRef.current = null;
    if (!buffered || !alive.current) return;
    patchAssistant(buffered.assistantId, (line) => {
      const withText = buffered.text ? { ...line, text: line.text + buffered.text } : line;
      return buffered.reasoning ? withReasoning(withText, buffered.reasoning, false) : withText;
    });
  }

  function bufferDelta(assistantId: string, kind: 'text' | 'reasoning', chunk: string) {
    if (deltaRef.current && deltaRef.current.assistantId !== assistantId) flushDeltas();
    const buffered = (deltaRef.current ??= { assistantId, text: '', reasoning: '' });
    buffered[kind] += chunk;
    deltaTimer.current ??= setTimeout(flushDeltas, DELTA_FLUSH_MS);
  }

  function applyEvent(event: SseEvent, assistantId: string) {
    if (!alive.current) return;
    const name = sseEventName(event);
    const data = event.data;
    if (typeof data.run_id === 'string' && data.run_id && data.run_id !== runIdRef.current) {
      runIdRef.current = data.run_id;
      setLiveRunId(data.run_id);
    }
    const phase = phaseAfterEvent(name, data);
    if (phase) enterPhase(phase);
    if (name === 'assistant.delta') {
      const delta = typeof data.delta === 'string' ? data.delta : '';
      if (delta) bufferDelta(assistantId, 'text', delta);
      return;
    }
    if (name === 'reasoning.delta') {
      const chunk = eventText(data);
      if (chunk) bufferDelta(assistantId, 'reasoning', chunk);
      return;
    }
    // Lo acumulado va antes que cualquier otro evento, que puede reemplazar el texto.
    flushDeltas();
    if (name === 'assistant.completed') {
      const content = messageText(data.content);
      if (content) patchAssistant(assistantId, (line) => ({ ...line, text: content }));
      return;
    }
    if (name === 'reasoning.available') {
      const chunk = eventText(data);
      if (!chunk) return;
      patchAssistant(assistantId, (line) => withReasoning(line, chunk, true));
      return;
    }
    if (name === 'assistant.commentary') {
      if (data.already_streamed === true) return;
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (!text) return;
      const id = `note-${assistantId}-${toolCount.current}`;
      toolCount.current += 1;
      patchAssistant(assistantId, (line) => ({
        ...line,
        notes: [...line.notes, { id, kind: 'commentary', text }],
      }));
      return;
    }
    if (name === 'tool.started') {
      const tool = toolNameOf(data);
      const id = `tool-${assistantId}-${toolCount.current}`;
      toolCount.current += 1;
      patchAssistant(assistantId, (line) => ({
        ...line,
        notes: [...line.notes, { id, kind: 'tool', text: tool }],
      }));
      return;
    }
    if (name === 'tool.completed' || name === 'tool.failed') {
      const preview = typeof data.preview === 'string' ? data.preview.trim() : '';
      if (!preview) return;
      const tool = toolNameOf(data);
      const prefix = `tool-${assistantId}-`;
      patchAssistant(assistantId, (line) => withToolPreview(line, prefix, tool, preview));
    }
    if (name === 'approval.request') {
      const runId = typeof data.run_id === 'string' ? data.run_id : runIdRef.current;
      if (!runId) return;
      const choices = stringList(data.choices);
      setApproval({
        runId,
        command: typeof data.command === 'string' ? data.command : '',
        description: typeof data.description === 'string' ? data.description : '',
        choices: choices.length > 0 ? choices : ['once', 'deny'],
      });
      // Mientras espera tu decisión el servidor puede no mandar nada: no es una conexión lenta.
      watchdogRef.current?.pause();
      return;
    }
    const failure = runFailureMessage(name, data);
    if (failure) {
      enterPhase(null);
      setApproval(null);
      setError(failure);
    }
    if (name === 'run.completed' || name === 'run.cancelled' || name === 'run.failed') {
      const late = typeof data.pending_steer === 'string' ? data.pending_steer.trim() : '';
      if (late) settleLateSteer(late, name === 'run.completed');
    }
    if (name === 'run.completed' || name === 'run.cancelled') {
      const reply = finalAssistantReply(data.messages);
      if (reply.reasoning) {
        patchAssistant(assistantId, (line) => withReasoning(line, reply.reasoning, true));
      }
      if (name === 'run.completed' && reply.text) {
        patchAssistant(assistantId, (line) => (line.text.trim() ? line : { ...line, text: reply.text }));
      }
      enterPhase(null);
      setApproval(null);
    }
  }

  async function deliver(message: OutgoingMessage) {
    const prose = message.text.trim();
    const imageParts: ChatContentPart[] = [];
    for (const file of message.files) {
      if (file.dataUrl) {
        imageParts.push({ type: 'image_url', image_url: { url: file.dataUrl } });
      }
    }

    const parts: ChatContentPart[] = [];
    if (prose) parts.push({ type: 'text', text: prose });
    parts.push(...imageParts);
    if (parts.length === 0) {
      setLines((current) => current.filter((line) => line.id !== message.userLineId));
      return;
    }

    const payload: ChatInput = parts.length === 1 && parts[0]?.type === 'text' ? parts[0].text : parts;
    const assistantId = `stream-${message.userLineId}`;
    const abort = new AbortController();
    abortRef.current = abort;
    runIdRef.current = null;
    steerIdsRef.current = [];
    setLiveRunId(null);
    setApproval(null);
    setStreamId(assistantId);
    setStatus(null);
    enterPhase(imageParts.length > 0 ? { kind: 'uploading', percent: null } : { kind: 'waiting' });
    startRun(sessionId, prose);
    let reply = '';
    let lost = false;
    // Al minimizar la app el sistema puede cortar el socket; Hermes detiene el turno si lo nota.
    let backgrounded = false;
    const watchdog = createStreamWatchdog({
      onSlow: (slow) => {
        if (!alive.current) return;
        setStatus((current) => (current && current.slow !== slow ? { ...current, slow } : current));
      },
      onDead: () => {
        lost = true;
        abort.abort();
      },
    });
    watchdogRef.current = watchdog;
    // Mientras la app está en segundo plano el JS se congela: ese silencio no es del servidor,
    // así que pausamos el vigía para no dar la conexión por perdida sin motivo.
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        watchdog.resume();
        return;
      }
      backgrounded = true;
      watchdog.pause();
    });
    const track = (event: SseEvent) => {
      const name = sseEventName(event);
      const data = event.data;
      if (name === 'assistant.delta' && typeof data.delta === 'string') reply += data.delta;
      else if (name === 'assistant.completed') reply = messageText(data.content) || reply;
      else if (name === 'run.completed' && !reply.trim()) reply = finalAssistantReply(data.messages).text;
      else if (name === 'tool.started') setRunActivity(sessionId, strings().stream.usingTool(toolNameOf(data)));
      else if (name === 'approval.request') setRunActivity(sessionId, strings().stream.approval);
      else if (name === 'tool.completed' || name === 'tool.failed') setRunActivity(sessionId, null);
    };
    setLines((current) => {
      const assistant = assistantLine(assistantId, '');
      const index = current.findIndex((line) => line.id === message.userLineId);
      if (index === -1) return [...current, assistant];
      return [...current.slice(0, index + 1), assistant, ...current.slice(index + 1)];
    });
    try {
      for (const file of message.files) {
        if (file.kind === 'image' && file.dataUrl) {
          await rememberSentImage(sessionId, imageFingerprint(file.dataUrl), file.uri);
        }
      }
      await client.streamChat(
        sessionId,
        payload,
        model ? { providerId: model.providerId, modelId: model.modelId } : null,
        (event) => {
          track(event);
          applyEvent(event, assistantId);
        },
        abort.signal,
        {
          onUploadProgress: (fraction) => {
            watchdog.touch();
            advanceFrom(
              ['uploading'],
              fraction < 1 ? { kind: 'uploading', percent: Math.round(fraction * 100) } : { kind: 'waiting' },
            );
          },
          onOpen: () => {
            watchdog.touch();
            advanceFrom(['uploading', 'waiting'], { kind: 'thinking' });
          },
          onData: watchdog.touch,
        },
      );
    } catch (err) {
      if (!alive.current) return;
      const aborted = abort.signal.aborted || (err instanceof HermesError && err.code === 'aborted');
      const stop = stopReason({ lost, aborted, backgrounded, describe: () => describeHermesError(err) });
      if (stop.recover) {
        // El stream se cortó con la app minimizada: preguntamos en qué quedó el turno.
        setNotice(str.chat.recovering);
        enterPhase(null);
        const runId = supports('run_status') ? runIdRef.current : null;
        const outcome = await settleRun((id) => client.getRun(id), runId, {
          keepWaiting: () => alive.current && !abort.signal.aborted,
        });
        if (!alive.current) return;
        await refreshLines();
        setNotice(null);
        // Si lo detuvo el usuario mientras esperábamos, no es un error.
        const message = abort.signal.aborted ? null : recoveryError(outcome);
        if (message) {
          setError(message);
          setRetry(prose ? { error: message, text: prose } : null);
        }
      } else if (stop.message) {
        setError(stop.message);
        setRetry(prose ? { error: stop.message, text: prose } : null);
      }
    } finally {
      appState.remove();
      watchdog.stop();
      if (watchdogRef.current === watchdog) watchdogRef.current = null;
      finishRun(sessionId, reply);
      if (!alive.current) return;
      flushDeltas();
      setStatus(null);
      setLiveRunId(null);
      setStreamId((current) => (current === assistantId ? null : current));
      setLines((current) =>
        current.filter((line) => {
          if (line.id !== assistantId || line.kind !== 'assistant' || line.text.trim()) return true;
          return line.notes.some((note) => note.text.trim() || Boolean(note.preview?.trim()));
        }),
      );
    }
  }

  /** Trae los mensajes guardados sin perder los que siguen en la cola de envío. */
  async function refreshLines() {
    try {
      const [messages, stored] = await Promise.all([client.getMessages(sessionId), loadSentImages(sessionId)]);
      if (!alive.current) return;
      const queued = new Set(queueRef.current.map((item) => item.userLineId));
      setLines((current) => [
        ...linesFromMessages(applyStoredImages(messages, stored)),
        ...current.filter((line) => queued.has(line.id)),
      ]);
    } catch {
      setReloadKey((key) => key + 1);
    }
  }

  async function pumpQueue() {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    setSending(true);
    try {
      while (alive.current && queueRef.current.length > 0) {
        const next = queueRef.current.shift();
        if (!next) break;
        await deliver(next);
      }
    } finally {
      pumpingRef.current = false;
      if (!alive.current) return;
      if (queueRef.current.length > 0) {
        void pumpQueue();
        return;
      }
      setSending(false);
      setStatus(null);
    }
  }

  function onSend(retryText?: string) {
    const text = retryText ?? draft;
    const files = retryText ? [] : pending;
    if (loading || backgroundRun || (!text.trim() && files.length === 0)) return;
    setError(null);
    setNotice(null);
    setRetry(null);
    if (!retryText) {
      setDraft('');
      setPending([]);
      setAttachOpen(false);
    }
    sentDuringLoad.current = true;
    const userLineId = `user-${Date.now()}-${sendSeq.current}`;
    sendSeq.current += 1;
    setLines((current) => [
      ...current,
      {
        id: userLineId,
        kind: 'user',
        text: text.trim(),
        attachments: files.map((file) => ({
          label: chipLabel(file.name, file.sizeLabel),
          uri: file.uri,
        })),
        notes: [],
      },
    ]);
    queueRef.current.push({ text, files, userLineId });
    void pumpQueue();
  }

  async function onAttach(action: AttachAction) {
    setAttachOpen(false);
    setError(null);
    try {
      if (action === 'camera' || action === 'gallery') {
        const picked = action === 'camera' ? await pickCameraImage() : await pickLibraryImage();
        if (!picked) return;
        const stored = await saveOutgoingImage(sessionId, picked);
        setPending((current) => [
          ...current,
          {
            id: `img-${Date.now()}`,
            kind: 'image',
            name: picked.name,
            sizeLabel: formatByteSize(stored.size),
            uri: stored.uri,
            mimeType: picked.mimeType,
            dataUrl: stored.dataUrl,
          },
        ]);
        return;
      }
    } catch (err) {
      setError(explain(err));
    }
  }

  function appendDraft(text: string) {
    setDraft((current) => {
      if (!current) return text;
      if (current.endsWith('\n') || text.startsWith('\n')) return `${current}${text}`;
      return `${current}\n${text}`;
    });
  }

  async function addClipboardImage(dataUrl: string) {
    const mimeType = dataUrl.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png';
    const stored = await saveOutgoingImage(sessionId, {
      uri: dataUrl,
      name: mimeType === 'image/jpeg' ? `${str.chat.clipboardFile}.jpg` : `${str.chat.clipboardFile}.png`,
      mimeType,
    });
    setPending((current) => [
      ...current,
      {
        id: `clip-${Date.now()}`,
        kind: 'image',
        name: 'Portapapeles',
        sizeLabel: formatByteSize(stored.size),
        uri: stored.uri,
        mimeType,
        dataUrl: stored.dataUrl,
      },
    ]);
  }

  // Estables para que la lista memoizada no se vuelva a pintar en cada render del chat.
  const copyMessage = useCallback((id: string, text: string) => {
    void Clipboard.setStringAsync(text).then(() => {
      if (!alive.current) return;
      setCopiedMessageId(id);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => {
        setCopiedMessageId((current) => (current === id ? null : current));
      }, 1600);
    });
  }, []);

  const openMessageMenu = useCallback((id: string, text: string) => setMenu({ id, text }), []);

  async function onSteer() {
    const runId = runIdRef.current;
    const text = draft.trim();
    if (!runId || !text || steering) return;
    setSteering(true);
    setError(null);
    setDraft('');
    const lineId = `steer-${Date.now()}`;
    // Va antes de la respuesta en curso: Hermes la entrega a mitad del turno y la respuesta
    // final llega después.
    setLines((current) => {
      const line: ChatLine = { id: lineId, kind: 'user', text, attachments: [], notes: [], steer: true };
      const index = current.findIndex((item) => item.id === streamId);
      return index === -1 ? [...current, line] : [...current.slice(0, index), line, ...current.slice(index)];
    });
    try {
      await client.steerRun(runId, text);
      steerIdsRef.current.push(lineId);
    } catch (err) {
      if (!alive.current) return;
      setLines((current) => current.filter((line) => line.id !== lineId));
      setDraft((current) => current || text);
      setError(describeHermesError(err));
    } finally {
      if (alive.current) setSteering(false);
    }
  }

  /**
   * El turno terminó antes de que el agente leyera la corrección y Hermes la devolvió. Si
   * terminó bien la mandamos como mensaje; si se cortó o falló, vuelve al borrador.
   */
  function settleLateSteer(text: string, completed: boolean) {
    const sent = new Set(steerIdsRef.current);
    steerIdsRef.current = [];
    setLines((current) => current.filter((line) => !sent.has(line.id)));
    if (completed) {
      onSend(text);
      return;
    }
    setDraft((current) => current || text);
  }

  function haltTurn() {
    const runId = runIdRef.current;
    abortRef.current?.abort();
    if (!runId) return;
    void client.stopRun(runId).catch(() => undefined);
  }

  async function decide(choice: string) {
    if (!approval || deciding) return;
    setDeciding(true);
    setError(null);
    try {
      await client.approveRun(approval.runId, choice);
      setApproval(null);
      watchdogRef.current?.resume();
      enterPhase(choice === 'deny' ? { kind: 'thinking' } : { kind: 'tool', name: str.approval.theTool });
    } catch (err) {
      setError(describeHermesError(err));
    } finally {
      setDeciding(false);
    }
  }

  function previousUserText(messageId: string): string {
    const index = lines.findIndex((line) => line.id === messageId);
    for (let i = index - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (line?.kind === 'user' && line.text.trim()) return line.text.trim();
    }
    return '';
  }

  async function shareText(text: string) {
    try {
      await Share.share({ message: text });
    } catch {
      setError(str.chat.shareFailed);
    }
  }

  return (
    <ScreenShell
      scroll={false}
      title={title}
      titleAccessory={<ConnectionDot />}
      onBack={() => router.back()}
      headerRight={
        <Pressable
          accessibilityRole="button"
          onPress={() => setModelsOpen(true)}
          style={[styles.modelChip, { borderColor: t.bd }]}
        >
          <Text numberOfLines={1} style={[styles.textSm, styles.modelLabel, { color: t.fg }]}>
            {model ? model.label : str.chat.serverModel}
          </Text>
          <ChevronDownIcon color={t.fg} size={16} />
        </Pressable>
      }
    >
      <View style={[styles.flex, { paddingBottom: keyboard.height }]}>
        <View style={styles.flex}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={t.pri} />
            </View>
          ) : (
            <MessageList
              lines={lines}
              streamId={streamId}
              sending={sending}
              status={status}
              backgroundRun={backgroundRun}
              copiedId={copiedMessageId}
              scrollRef={scrollRef}
              onOpenImage={setViewer}
              onCopy={copyMessage}
              onMore={openMessageMenu}
            />
          )}
          {attachOpen || dictation.listening ? (
            <>
              {dictation.listening ? null : (
                <Pressable
                  accessibilityLabel={str.chat.closeAttachments}
                  style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.45)' }]}
                  onPress={() => setAttachOpen(false)}
                />
              )}
              <View style={styles.sheet}>
                <AttachSheet
                  recording={dictation.listening}
                  holding={dictation.holding}
                  elapsed={dictation.elapsed}
                  transcript={dictation.transcript}
                  onAction={(action) => {
                    void onAttach(action);
                  }}
                />
              </View>
            </>
          ) : null}
        </View>
        {approval ? (
          <View style={[styles.approval, { borderColor: t.bd, backgroundColor: t.card }]}>
            <Text style={{ color: t.fg }}>{str.approval.prompt}</Text>
            {approval.command ? (
              <Text style={[styles.previewText, { color: t.fg }]}>{approval.command}</Text>
            ) : null}
            {approval.description ? (
              <Text style={[styles.textSm, { color: t.mut }]}>{approval.description}</Text>
            ) : null}
            <View style={styles.choiceRow}>
              {approval.choices.map((choice) => (
                <Pressable
                  key={choice}
                  accessibilityRole="button"
                  disabled={deciding}
                  onPress={() => {
                    void decide(choice);
                  }}
                  style={[styles.choice, { borderColor: t.bd, backgroundColor: t.bg, opacity: deciding ? 0.5 : 1 }]}
                >
                  <Text style={[styles.textSm, { color: t.fg }]}>{choiceLabel(choice)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        {notice ? (
          <Text style={[styles.status, { color: t.mut }]}>{notice}</Text>
        ) : null}
        {error ? (
          <View style={styles.errorRow}>
            <Text style={[styles.textSm, styles.errorText, styles.flex]}>{error}</Text>
            {retry && retry.error === error ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={str.chat.retryMessage}
                disabled={loading || sending || backgroundRun}
                onPress={() => onSend(retry.text)}
                style={[styles.retryBtn, { borderColor: t.bd }]}
              >
                <Text style={[styles.textSm, { color: t.fg }]}>{str.chat.retry}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {pending.length > 0 ? (
          <View style={styles.chips}>
            {pending.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={str.chat.removeAttachment(item.name)}
                onPress={() => {
                  if (item.kind === 'image') discardSentImage(item.uri);
                  setPending((current) => current.filter((entry) => entry.id !== item.id));
                }}
                style={[styles.chip, { borderColor: t.bd, backgroundColor: t.card }]}
              >
                {showableImage(item.uri) ? (
                  <Image
                    source={{ uri: item.uri }}
                    accessibilityLabel={item.name}
                    resizeMode="cover"
                    style={styles.thumb}
                  />
                ) : null}
                <Text style={[styles.textSm, { color: t.fg }]}>
                  {chipLabel(item.name, item.sizeLabel)}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {canSteer ? (
          <View style={styles.steerRow}>
            <Text style={[styles.textSm, styles.flex, { color: t.mut }]}>{str.steer.hint}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void onSteer();
              }}
              style={[styles.retryBtn, { borderColor: t.bd }]}
            >
              <Text style={[styles.textSm, { color: t.fg }]}>{str.steer.action}</Text>
            </Pressable>
          </View>
        ) : null}
        <View
          style={[
            styles.composer,
            { paddingBottom: keyboard.visible ? 12 : insets.bottom + 12 },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={str.attach.title}
            onPress={() => setAttachOpen((open) => !open)}
            style={[styles.iconBtn, { borderColor: t.bd }]}
          >
            <PlusIcon color={t.fg} size={22} />
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={str.chat.placeholder}
            placeholderTextColor={t.mut}
            multiline
            editable={!loading}
            style={[styles.input, { borderColor: t.bd, color: t.fg }]}
          />
          {!loading && Clipboard.isPasteButtonAvailable ? (
            <Clipboard.ClipboardPasteButton
              acceptedContentTypes={['plain-text', 'image']}
              displayMode="iconOnly"
              cornerStyle="medium"
              foregroundColor={t.fg}
              backgroundColor={t.card}
              imageOptions={{ format: 'png' }}
              onPress={(data) => {
                if (data.type === 'image') {
                  void addClipboardImage(data.data).catch((err: unknown) => setError(explain(err)));
                  return;
                }
                if (data.text.trim()) appendDraft(data.text);
              }}
              style={styles.pasteBtn}
            />
          ) : null}
          {sending ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={str.chat.stop}
              onPress={haltTurn}
              style={[styles.sendBtn, { backgroundColor: t.pri }]}
            >
              <View style={[styles.stopSquare, { backgroundColor: t.pfg }]} />
            </Pressable>
          ) : null}
          {canSend ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={str.chat.send}
              disabled={loading}
              onPress={() => {
                onSend();
              }}
              style={[styles.sendBtn, { backgroundColor: t.pri, opacity: loading ? 0.5 : 1 }]}
            >
              <ArrowUpIcon color={t.pfg} size={22} />
            </Pressable>
          ) : sending ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={str.chat.dictate}
              disabled={loading}
              onPressIn={() => {
                setError(null);
                setNotice(null);
                void dictation.pressIn();
              }}
              onPressOut={dictation.pressOut}
              style={[styles.sendBtn, { backgroundColor: t.pri }]}
            >
              <MicrophoneIcon color={t.pfg} size={22} />
            </Pressable>
          )}
        </View>
      </View>
      <ModelSheet
        visible={modelsOpen}
        title={str.chat.sessionModel}
        sessionId={sessionId}
        onClose={() => setModelsOpen(false)}
      />
      <Modal
        visible={viewerUri !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setViewer(null)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={str.chat.closeImage}
          onPress={() => setViewer(null)}
          style={styles.viewer}
        >
          {viewerUri ? (
            <Image
              source={{ uri: viewerUri }}
              resizeMode="contain"
              style={{ width: screen.width, height: screen.height }}
            />
          ) : null}
          <Text pointerEvents="none" style={[styles.viewerHint, { top: insets.top + 16 }]}>
            {str.chat.tapToClose}
          </Text>
        </Pressable>
      </Modal>
      <MessageActions
        visible={menu !== null}
        onClose={() => setMenu(null)}
        onShare={() => {
          const text = menu?.text ?? '';
          setMenu(null);
          void shareText(text);
        }}
        onCopy={() => {
          const text = menu?.text ?? '';
          setMenu(null);
          void Clipboard.setStringAsync(text).then(() => setNotice(str.chat.textCopied));
        }}
        onRetry={() => {
          const text = menu ? previousUserText(menu.id) : '';
          setMenu(null);
          if (!text) {
            setError(str.chat.nothingToRetry);
            return;
          }
          void onSend(text);
        }}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  modelChip: {
    maxWidth: '46%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  modelLabel: { flexShrink: 1 },
  textSm: { fontSize: 14 },
  viewer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  viewerHint: { position: 'absolute', color: '#fff', fontSize: 14 },
  previewText: { marginTop: 4, fontSize: 13 },
  approval: {
    marginHorizontal: 12,
    marginBottom: 8,
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  status: { paddingHorizontal: 16, paddingBottom: 4, fontSize: 14 },
  errorText: { color: '#ef4444' },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  retryBtn: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  steerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  thumb: { width: 36, height: 36, borderRadius: 8 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  iconBtn: {
    height: 44,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
  },
  input: {
    maxHeight: 128,
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  sendBtn: {
    height: 44,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  pasteBtn: { height: 44, width: 44 },
  stopSquare: { width: 14, height: 14, borderRadius: 2 },
});
