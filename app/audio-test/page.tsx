"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadAudioInputs,
  saveAudioInputConfig,
  startMic,
} from "../session/audio-input-service";

type LevelState = {
  rms: number;
  peak: number;
};

type TrackInfo = {
  label: string;
  settings: MediaTrackSettings;
};

type MicMonitor = {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  silentGain: GainNode;
  frameId: number;
};

const EMPTY_LEVEL: LevelState = { rms: 0, peak: 0 };

export default function AudioTestPage() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micADeviceId, setMicADeviceId] = useState("");
  const [micBDeviceId, setMicBDeviceId] = useState("");
  const [micAInfo, setMicAInfo] = useState<TrackInfo | null>(null);
  const [micBInfo, setMicBInfo] = useState<TrackInfo | null>(null);
  const [micALevel, setMicALevel] = useState<LevelState>(EMPTY_LEVEL);
  const [micBLevel, setMicBLevel] = useState<LevelState>(EMPTY_LEVEL);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [errorText, setErrorText] = useState("");
  const micARef = useRef<MicMonitor | null>(null);
  const micBRef = useRef<MicMonitor | null>(null);

  useEffect(() => {
    void refreshDevices();

    return () => {
      stopAllMics();
    };
  }, []);

  async function refreshDevices() {
    setIsLoading(true);
    setErrorText("");

    try {
      const audioInputs = await loadAudioInputs();
      setDevices(audioInputs);
      setMicADeviceId((current) => current || audioInputs[0]?.deviceId || "");
      setMicBDeviceId(
        (current) => current || audioInputs[1]?.deviceId || audioInputs[0]?.deviceId || "",
      );
    } catch (error) {
      console.warn("Failed to load audio inputs", error);
      setErrorText("マイク権限または入力デバイスを確認してください。");
    } finally {
      setIsLoading(false);
    }
  }

  async function startSelectedMics() {
    if (!micADeviceId || !micBDeviceId) {
      setErrorText("マイクAとマイクBを選択してください。");
      return;
    }

    stopAllMics();
    setErrorText("");

    try {
      const [micAStream, micBStream] = await Promise.all([
        startMic(micADeviceId),
        startMic(micBDeviceId),
      ]);
      const micATrack = micAStream.getAudioTracks()[0];
      const micBTrack = micBStream.getAudioTracks()[0];

      console.log("micA settings:", micATrack?.getSettings());
      console.log("micB settings:", micBTrack?.getSettings());

      setMicAInfo({
        label: micATrack?.label || selectedDeviceLabel(micADeviceId, devices),
        settings: micATrack?.getSettings() ?? {},
      });
      setMicBInfo({
        label: micBTrack?.label || selectedDeviceLabel(micBDeviceId, devices),
        settings: micBTrack?.getSettings() ?? {},
      });

      micARef.current = startLevelMonitor(micAStream, setMicALevel);
      micBRef.current = startLevelMonitor(micBStream, setMicBLevel);
      saveAudioInputConfig({
        speakerADeviceId: micADeviceId,
        speakerBDeviceId: micBDeviceId,
      });
      setIsRunning(true);
    } catch (error) {
      console.warn("Failed to start selected microphones", error);
      stopAllMics();
      setErrorText("選択したマイクを開始できませんでした。");
    }
  }

  function stopAllMics() {
    stopMonitor(micARef.current);
    stopMonitor(micBRef.current);
    micARef.current = null;
    micBRef.current = null;
    setIsRunning(false);
    setMicAInfo(null);
    setMicBInfo(null);
    setMicALevel(EMPTY_LEVEL);
    setMicBLevel(EMPTY_LEVEL);
  }

  return (
    <main className="min-h-screen bg-stone-50 px-5 py-6 text-stone-950">
      <div className="mx-auto max-w-5xl space-y-5">
        <header>
          <p className="text-[12px] font-bold uppercase tracking-wide text-emerald-700">
            Developer audio test
          </p>
          <h1 className="mt-1 text-2xl font-black">
            マイクA/B 個別入力テスト
          </h1>
          <p className="mt-2 text-sm font-bold text-stone-600">
            初回にマイク権限を取得してから、全ての audioinput を再列挙します。
          </p>
        </header>

        <section className="rounded-md border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">検出された audioinput</h2>
              <p className="text-sm font-bold text-stone-500">
                件数: {devices.length}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshDevices()}
              disabled={isLoading}
              className="min-h-10 rounded-md border border-stone-300 bg-white px-4 text-sm font-black text-stone-700 disabled:text-stone-400"
            >
              {isLoading ? "取得中" : "再取得"}
            </button>
          </div>

          {errorText ? (
            <p className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
              {errorText}
            </p>
          ) : null}

          <div className="mt-4 grid gap-3">
            {devices.length === 0 ? (
              <p className="rounded-md border border-dashed border-stone-300 px-3 py-8 text-center text-sm font-bold text-stone-500">
                audioinput がまだ検出されていません。
              </p>
            ) : (
              devices.map((device, index) => (
                <article
                  key={`${device.deviceId}-${index}`}
                  className="rounded-md border border-stone-200 bg-stone-50 px-3 py-3"
                >
                  <p className="text-sm font-black">
                    {index + 1}. {device.label || "(label empty)"}
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-stone-600">
                    deviceId: {device.deviceId || "(empty)"}
                  </p>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="rounded-md border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-black">マイク選択</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <MicSelect
              label="マイクA / 本人"
              value={micADeviceId}
              devices={devices}
              onChange={setMicADeviceId}
            />
            <MicSelect
              label="マイクB / 介護者"
              value={micBDeviceId}
              devices={devices}
              onChange={setMicBDeviceId}
            />
          </div>
          {micADeviceId && micADeviceId === micBDeviceId ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">
              マイクA/Bに同じ deviceId が選択されています。別々のマイクとして検証する場合は異なる入力を選んでください。
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void startSelectedMics()}
              disabled={isRunning || !devices.length}
              className="min-h-10 rounded-md bg-stone-950 px-4 text-sm font-black text-white disabled:bg-stone-300"
            >
              A/Bを別streamで開始
            </button>
            <button
              type="button"
              onClick={stopAllMics}
              disabled={!isRunning}
              className="min-h-10 rounded-md border border-stone-300 bg-white px-4 text-sm font-black text-stone-700 disabled:text-stone-400"
            >
              停止
            </button>
          </div>
          <p className="mt-3 text-xs font-bold text-stone-500">
            A/Bを別streamで開始できた設定は保存され、通常のセッション画面ではデバッグ表示なしで使用されます。
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <MicStatusCard
            title="マイクA / 本人 / speaker A"
            info={micAInfo}
            level={micALevel}
          />
          <MicStatusCard
            title="マイクB / 介護者 / speaker B"
            info={micBInfo}
            level={micBLevel}
          />
        </section>
      </div>
    </main>
  );
}

function MicSelect(props: {
  label: string;
  value: string;
  devices: MediaDeviceInfo[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-black text-stone-700">
      {props.label}
      <select
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="min-h-11 rounded-md border border-stone-300 bg-white px-3 text-sm font-bold text-stone-950 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
      >
        <option value="">選択してください</option>
        {props.devices.map((device, index) => (
          <option key={`${device.deviceId}-${index}`} value={device.deviceId}>
            {device.label || `audioinput ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function MicStatusCard(props: {
  title: string;
  info: TrackInfo | null;
  level: LevelState;
}) {
  return (
    <article className="rounded-md border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-black">{props.title}</h2>
      <div className="mt-3 space-y-2">
        <LevelBar label="RMS" value={props.level.rms} />
        <LevelBar label="Peak" value={props.level.peak} />
      </div>
      <div className="mt-4 rounded-md bg-stone-950 p-3 text-stone-50">
        <p className="text-xs font-black text-emerald-300">
          track.getSettings()
        </p>
        <p className="mt-2 break-all text-xs font-bold text-stone-300">
          label: {props.info?.label || "(not started)"}
        </p>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed">
          {JSON.stringify(props.info?.settings ?? {}, null, 2)}
        </pre>
      </div>
    </article>
  );
}

function LevelBar(props: { label: string; value: number }) {
  const percent = Math.round(Math.min(1, props.value * 3) * 100);

  return (
    <div>
      <div className="flex items-center justify-between text-xs font-black text-stone-600">
        <span>{props.label}</span>
        <span>{percent}%</span>
      </div>
      <div className="mt-1 h-3 overflow-hidden rounded-full bg-stone-200">
        <div
          className="h-full rounded-full bg-emerald-600 transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function selectedDeviceLabel(deviceId: string, devices: MediaDeviceInfo[]) {
  return devices.find((device) => device.deviceId === deviceId)?.label || "";
}

function startLevelMonitor(
  stream: MediaStream,
  onLevel: (level: LevelState) => void,
): MicMonitor {
  const AudioContextClass =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("Web Audio API is not available in this browser");
  }

  const context = new AudioContextClass();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  const silentGain = context.createGain();

  analyser.fftSize = 1024;
  const samples = new Float32Array(analyser.fftSize);
  silentGain.gain.value = 0;
  source.connect(analyser);
  analyser.connect(silentGain);
  silentGain.connect(context.destination);

  const tick = () => {
    analyser.getFloatTimeDomainData(samples);
    onLevel(calculateLevel(samples));
    monitor.frameId = window.requestAnimationFrame(tick);
  };

  const monitor: MicMonitor = {
    stream,
    context,
    source,
    analyser,
    silentGain,
    frameId: window.requestAnimationFrame(tick),
  };

  return monitor;
}

function stopMonitor(monitor: MicMonitor | null) {
  if (!monitor) return;

  window.cancelAnimationFrame(monitor.frameId);
  for (const track of monitor.stream.getTracks()) {
    track.stop();
  }
  for (const node of [monitor.source, monitor.analyser, monitor.silentGain]) {
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
  }
  void monitor.context.close().catch(() => {});
}

function calculateLevel(samples: Float32Array): LevelState {
  let sumSquares = 0;
  let peak = 0;

  for (const sample of samples) {
    const absolute = Math.abs(sample);
    sumSquares += sample * sample;
    if (absolute > peak) peak = absolute;
  }

  return {
    rms: Math.sqrt(sumSquares / samples.length),
    peak,
  };
}
