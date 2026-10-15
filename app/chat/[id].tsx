import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { ChatMarkdown } from '@/components/chat-markdown';
import { MessageActions } from '@/components/message-actions';
import { ModelSheet } from '@/components/model-sheet';
import { ReasoningFold, type ReasoningNote } from '@/components/reasoning-fold';
import { ScreenShell } from '@/components/screen-shell';
import { ThinkingRow } from '@/components/stream-status';
import { Text } from '@/components/ui/text';
import { RequireConnection, useConnection, useHermesClient } from '@/contexts/connection-context';
import { useTheme } from '@/contexts/theme-context';
import { useVoiceLocale } from '@/contexts/voice-locale-context';
import { formatByteSize } from '@/lib/format';
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
import { applyStoredImages, imageFingerprint } from '@/lib/sent-image-index';
import { discardSentImage, loadSentImages, rememberSentImage, saveOutgoingImage } from '@/lib/sent-images';

type LineAttachment = { label: string; uri?: string };

const SHOWABLE_IMAGE = /^(data:image\/|https?:\/\/|file:\/\/|content:\/\/|ph:\/\/|assets-library:\/\/)/i;

function showableImage(uri: string | undefined): uri is string {
  return !!uri && SHOWABLE_IMAGE.test(uri);
}

type ChatLine = {
  id: string;
  kind: 'user' | 'assistant';
  text: string;
  attachments: LineAttachment[];
  notes: ReasoningNote[];
};

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

const CHOICE_LABELS: Record<string, string> = {
  once: 'Solo esta vez',
  session: 'En esta conversación',
  always: 'Siempre',
  deny: 'Bloquear',
};

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
  const name = message.toolName || 'herramienta';
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

function toolNameOf(data: Record<string, unknown>): string {
  const name = data.tool_name ?? data.tool;
  return typeof name === 'string' && name.trim() ? name.trim() : 'herramienta';
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
  return CHOICE_LABELS[choice] ?? choice;
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
  const params = useLocalSearchParams<{ id: string }>();
  const sessionId = oneParam(params.id);
  const client = useHermesClient();
  const { modelForSession } = useConnection();
  const { theme } = useTheme();
  const t = theme.tokens;
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const keyboard = useKeyboardInset();
  const scrollRef = useRef<ScrollView>(null);
  const [title, setTitle] = useState('Conversación');
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [menu, setMenu] = useState<{ id: string; text: string } | null>(null);
  const [viewerUri, setViewer] = useState<string | null>(null);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolCount = useRef(0);
  const runIdRef = useRef<string | null>(null);
  const queueRef = useRef<OutgoingMessage[]>([]);
  const pumpingRef = useRef(false);
  const sendSeq = useRef(0);

  const model = modelForSession(sessionId);
  const canSend = draft.trim().length > 0 || pending.length > 0;
  const { locale: voiceLocale } = useVoiceLocale();
  const dictation = useVoiceDictation({
    locale: voiceLocale,
    blocked: sending || loading || canSend,
    onTranscript: (text) => {
      void onSend(text);
    },
    onNotice: setNotice,
    onError: setError,
  });

  useEffect(() => {
    let cancelled = false;
    const loaded = Promise.all([
      client.getSession(sessionId),
      client.getMessages(sessionId),
      loadSentImages(sessionId),
    ]);
    loaded
      .then(([session, messages, stored]) => {
        if (cancelled) return;
        setTitle(session.title);
        setLines(linesFromMessages(applyStoredImages(messages, stored)));
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
  }, [client, sessionId]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abortRef.current?.abort();
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!keyboard.visible) return;
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [keyboard.height, keyboard.visible]);

  function patchAssistant(assistantId: string, patch: (line: ChatLine) => ChatLine) {
    setLines((current) => {
      const existing = current.find((line) => line.id === assistantId);
      if (!existing) return [...current, patch(assistantLine(assistantId, ''))];
      return current.map((line) => (line.id === assistantId ? patch(line) : line));
    });
  }

  function applyEvent(event: SseEvent, assistantId: string) {
    if (!alive.current) return;
    const name = sseEventName(event);
    const data = event.data;
    if (typeof data.run_id === 'string' && data.run_id) runIdRef.current = data.run_id;
    if (name === 'assistant.delta') {
      const delta = typeof data.delta === 'string' ? data.delta : '';
      if (!delta) return;
      patchAssistant(assistantId, (line) => ({ ...line, text: line.text + delta }));
      return;
    }
    if (name === 'assistant.completed') {
      const content = messageText(data.content);
      if (content) patchAssistant(assistantId, (line) => ({ ...line, text: content }));
      return;
    }
    if (name === 'reasoning.delta' || name === 'reasoning.available') {
      const chunk = eventText(data);
      if (!chunk) return;
      patchAssistant(assistantId, (line) => withReasoning(line, chunk, name === 'reasoning.available'));
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
      setActivity(`Usando ${tool}…`);
      const id = `tool-${assistantId}-${toolCount.current}`;
      toolCount.current += 1;
      patchAssistant(assistantId, (line) => ({
        ...line,
        notes: [...line.notes, { id, kind: 'tool', text: tool }],
      }));
      return;
    }
    if (name === 'tool.completed' || name === 'tool.failed') {
      setActivity(null);
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
      setActivity('Esperando tu decisión…');
      return;
    }
    if (name === 'run.failed') {
      setActivity(null);
      setApproval(null);
      const raw = data.error;
      const message =
        typeof raw === 'string'
          ? raw
          : raw && typeof raw === 'object' && 'message' in raw && typeof raw.message === 'string'
            ? raw.message
            : 'La respuesta falló.';
      setError(message);
    }
    if (name === 'run.completed' || name === 'run.cancelled') {
      const reply = finalAssistantReply(data.messages);
      if (reply.reasoning) {
        patchAssistant(assistantId, (line) => withReasoning(line, reply.reasoning, true));
      }
      if (name === 'run.completed' && reply.text) {
        patchAssistant(assistantId, (line) => (line.text.trim() ? line : { ...line, text: reply.text }));
      }
      setActivity(null);
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
    setApproval(null);
    setStreamId(assistantId);
    setActivity(null);
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
        (event) => applyEvent(event, assistantId),
        abort.signal,
      );
    } catch (err) {
      if (!alive.current) return;
      if (abort.signal.aborted || (err instanceof HermesError && err.code === 'aborted')) return;
      setError(describeHermesError(err));
    } finally {
      if (!alive.current) return;
      setActivity(null);
      setStreamId((current) => (current === assistantId ? null : current));
      setLines((current) =>
        current.filter((line) => {
          if (line.id !== assistantId || line.kind !== 'assistant' || line.text.trim()) return true;
          return line.notes.some((note) => note.text.trim() || Boolean(note.preview?.trim()));
        }),
      );
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
      setActivity(null);
    }
  }

  function onSend(retryText?: string) {
    const text = retryText ?? draft;
    const files = retryText ? [] : pending;
    if (loading || (!text.trim() && files.length === 0)) return;
    setError(null);
    setNotice(null);
    if (!retryText) {
      setDraft('');
      setPending([]);
      setAttachOpen(false);
    }
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
      name: mimeType === 'image/jpeg' ? 'portapapeles.jpg' : 'portapapeles.png',
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

  function copyMessage(id: string, text: string) {
    void Clipboard.setStringAsync(text).then(() => {
      if (!alive.current) return;
      setCopiedMessageId(id);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => {
        setCopiedMessageId((current) => (current === id ? null : current));
      }, 1600);
    });
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
      setActivity(choice === 'deny' ? null : 'Usando la herramienta…');
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
      setError('No se pudo abrir el menú para compartir.');
    }
  }

  return (
    <ScreenShell
      scroll={false}
      title={title}
      onBack={() => router.back()}
      headerRight={
        <Pressable
          accessibilityRole="button"
          onPress={() => setModelsOpen(true)}
          style={[styles.modelChip, { borderColor: t.bd }]}
        >
          <Text numberOfLines={1} style={[styles.textSm, styles.modelLabel, { color: t.fg }]}>
            {model ? model.label : 'Modelo del servidor'}
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
            <ScrollView
              ref={scrollRef}
              style={styles.flex}
              contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            >
              {lines.length === 0 ? (
                <Text style={[styles.textSm, { color: t.mut }]}>Escribí el primer mensaje.</Text>
              ) : null}
              {lines.map((line) => {
                const mine = line.kind === 'user';
                const waiting = !mine && sending && line.id === streamId && !line.text.trim();
                const streaming = !mine && sending && line.id === streamId && Boolean(line.text.trim());
                return (
                  <View
                    key={line.id}
                    style={[
                      styles.bubbleWrap,
                      mine ? { alignSelf: 'flex-end', maxWidth: '90%' } : { alignSelf: 'stretch' },
                    ]}
                  >
                    {line.attachments.map((item, index) =>
                      showableImage(item.uri) ? (
                        <Pressable
                          key={`${line.id}-file-${index}`}
                          accessibilityRole="button"
                          accessibilityLabel="Ver imagen"
                          onPress={() => setViewer(item.uri ?? null)}
                        >
                          <Image
                            source={{ uri: item.uri }}
                            accessibilityLabel={item.label}
                            resizeMode="cover"
                            style={[styles.preview, { backgroundColor: t.card }]}
                          />
                        </Pressable>
                      ) : (
                        <View
                          key={`${line.id}-file-${index}`}
                          style={[styles.attachment, { borderColor: t.bd, backgroundColor: t.card }]}
                        >
                          <Text style={[styles.textSm, { color: t.fg }]}>{item.label}</Text>
                        </View>
                      ),
                    )}
                    {waiting ? (
                      <View
                        style={[
                          styles.bubble,
                          styles.assistantBubble,
                          { backgroundColor: t.card, borderColor: t.bd, borderWidth: 1 },
                        ]}
                      >
                        <ThinkingRow color={t.mut} label={activity ?? 'Pensando…'} />
                      </View>
                    ) : line.text ? (
                      <View
                        style={[
                          styles.bubble,
                          mine ? null : styles.assistantBubble,
                          {
                            backgroundColor: mine ? t.pri : t.card,
                            borderWidth: mine ? 0 : 1,
                            borderColor: t.bd,
                          },
                        ]}
                      >
                        {mine ? (
                          <Text selectable style={{ color: t.pfg }}>
                            {line.text}
                          </Text>
                        ) : (
                          <ChatMarkdown source={line.text} streaming={streaming} />
                        )}
                      </View>
                    ) : null}
                    {mine ? null : <ReasoningFold notes={line.notes} />}
                    {!mine && line.text.trim() ? (
                      <View style={styles.actions}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Copiar mensaje"
                          onPress={() => copyMessage(line.id, line.text)}
                        >
                          <Text style={[styles.textSm, { color: t.mut }]}>
                            {copiedMessageId === line.id ? 'Copiado' : 'Copiar'}
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Más acciones"
                          onPress={() => setMenu({ id: line.id, text: line.text })}
                        >
                          <Text style={[styles.textSm, { color: t.mut }]}>Más</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          )}
          {attachOpen || dictation.listening ? (
            <>
              {dictation.listening ? null : (
                <Pressable
                  accessibilityLabel="Cerrar adjuntos"
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
            <Text style={{ color: t.fg }}>El agente quiere ejecutar un comando.</Text>
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
          <Text style={[styles.status, styles.errorText]}>{error}</Text>
        ) : null}
        {pending.length > 0 ? (
          <View style={styles.chips}>
            {pending.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Quitar ${item.name}`}
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
        <View
          style={[
            styles.composer,
            { paddingBottom: keyboard.visible ? 12 : insets.bottom + 12 },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Adjuntar"
            onPress={() => setAttachOpen((open) => !open)}
            style={[styles.iconBtn, { borderColor: t.bd }]}
          >
            <PlusIcon color={t.fg} size={22} />
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Escribí un mensaje…"
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
              accessibilityLabel="Detener"
              onPress={haltTurn}
              style={[styles.sendBtn, { backgroundColor: t.pri }]}
            >
              <View style={[styles.stopSquare, { backgroundColor: t.pfg }]} />
            </Pressable>
          ) : null}
          {canSend ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enviar"
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
              accessibilityLabel="Dictar mensaje"
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
        title="Modelo de esta conversación"
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
          accessibilityLabel="Cerrar imagen"
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
            Tocá para cerrar
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
          void Clipboard.setStringAsync(text).then(() => setNotice('Texto copiado.'));
        }}
        onRetry={() => {
          const text = menu ? previousUserText(menu.id) : '';
          setMenu(null);
          if (!text) {
            setError('No hay un mensaje para reintentar.');
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
  bubbleWrap: { maxWidth: '100%' },
  assistantBubble: { alignSelf: 'stretch' },
  attachment: {
    marginBottom: 8,
    alignSelf: 'flex-end',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  preview: {
    width: 220,
    height: 220,
    marginBottom: 8,
    alignSelf: 'flex-end',
    borderRadius: 12,
  },
  viewer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  viewerHint: { position: 'absolute', color: '#fff', fontSize: 14 },
  bubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
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
  actions: { flexDirection: 'row', gap: 16, marginTop: 6, paddingHorizontal: 4 },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  status: { paddingHorizontal: 16, paddingBottom: 4, fontSize: 14 },
  errorText: { color: '#ef4444' },
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
