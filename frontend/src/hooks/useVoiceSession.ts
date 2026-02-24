import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./useAuth";
import type { WsServerMessage } from "../types";

export type VoiceStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "active"
  | "ended"
  | "error";

interface UseVoiceSessionReturn {
  status: VoiceStatus;
  transcript: string[];
  sessionId: string | null;
  error: string | null;
  isMicActive: boolean;
  startSession: () => Promise<void>;
  endSession: () => void;
}

const SAMPLE_RATE = 16000;

export function useVoiceSession(): UseVoiceSessionReturn {
  const { user, getIdToken } = useAuth();
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMicActive, setIsMicActive] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);

  const cleanup = useCallback(() => {
    workletRef.current?.disconnect();
    workletRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    playbackCtxRef.current?.close();
    playbackCtxRef.current = null;
    nextPlayTimeRef.current = 0;
    setIsMicActive(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      cleanup();
    };
  }, [cleanup]);

  function playAudioChunk(data: ArrayBuffer) {
    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
    }
    const ctx = playbackCtxRef.current;
    const int16 = new Int16Array(data);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i]! / 32768;
    }
    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const now = ctx.currentTime;
    const startTime = Math.max(now, nextPlayTimeRef.current);
    source.start(startTime);
    nextPlayTimeRef.current = startTime + buffer.duration;
  }

  const startSession = useCallback(async () => {
    if (!user) return;
    setError(null);
    setTranscript([]);
    setStatus("connecting");

    try {
      const token = await getIdToken();

      // Set up mic capture
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = audioCtx;

      // Load audio worklet for PCM resampling
      const workletCode = `
        class PcmProcessor extends AudioWorkletProcessor {
          process(inputs) {
            const input = inputs[0];
            if (input.length > 0) {
              const samples = input[0];
              const int16 = new Int16Array(samples.length);
              for (let i = 0; i < samples.length; i++) {
                const s = Math.max(-1, Math.min(1, samples[i]));
                int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
              this.port.postMessage(int16.buffer, [int16.buffer]);
            }
            return true;
          }
        }
        registerProcessor('pcm-processor', PcmProcessor);
      `;
      const blob = new Blob([workletCode], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const source = audioCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioCtx, "pcm-processor");
      workletRef.current = worklet;
      source.connect(worklet);
      worklet.connect(audioCtx.destination); // needed for processing

      // Connect WebSocket
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const wsUrl = `${protocol}://${window.location.host}/ws/session`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        // Send auth handshake
        ws.send(
          JSON.stringify({
            type: "auth",
            token,
            sessionType: "intake",
            clientId: user.uid,
          })
        );
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          playAudioChunk(event.data);
          return;
        }
        const msg: WsServerMessage = JSON.parse(event.data);
        switch (msg.type) {
          case "ready":
            setSessionId(msg.sessionId);
            setStatus("active");
            setIsMicActive(true);
            // Start sending audio
            worklet.port.onmessage = (e) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(e.data);
              }
            };
            break;
          case "transcript":
            setTranscript((prev) => [...prev, msg.text]);
            break;
          case "turn_complete":
            break;
          case "interview_ended":
            setStatus("ended");
            cleanup();
            break;
          case "complete":
            setStatus("ended");
            cleanup();
            break;
          case "error":
            setError(msg.message);
            setStatus("error");
            cleanup();
            break;
        }
      };

      ws.onerror = () => {
        setError("Connection error. Please try again.");
        setStatus("error");
        cleanup();
      };

      ws.onclose = (e) => {
        if (status !== "ended" && status !== "error") {
          if (e.code !== 1000) {
            setError("Connection closed unexpectedly.");
            setStatus("error");
          }
          cleanup();
        }
      };

      setStatus("ready");
    } catch (err: any) {
      setError(err.message ?? "Failed to start session");
      setStatus("error");
      cleanup();
    }
  }, [user, getIdToken, cleanup, status]);

  const endSession = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end" }));
    }
    wsRef.current?.close();
    cleanup();
    setStatus("ended");
  }, [cleanup]);

  return {
    status,
    transcript,
    sessionId,
    error,
    isMicActive,
    startSession,
    endSession,
  };
}
