export const dynamic = "force-dynamic";
export const revalidate = 0;

const CLIENT_VERSION = "remote-mic-inline-20260729";

export default function RemoteMicPage() {
  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-5 text-stone-950">
      <section className="mx-auto max-w-md rounded-md border border-stone-300 bg-white p-4 shadow-sm">
        <div className="border-b border-stone-200 pb-3">
          <div className="text-[12px] font-black uppercase tracking-[0.08em] text-stone-500">
            Remote microphone
          </div>
          <h1 id="role-title" className="mt-1 text-[22px] font-black leading-tight">
            スマートフォンマイク
          </h1>
        </div>

        <div className="mt-4 space-y-3">
          <StatusRow label="サーバー接続" id="server-status" value="確認中" />
          <StatusRow label="画面版" id="client-version" value={CLIENT_VERSION} />
          <StatusRow label="表示URL" id="open-url" value="確認中" />
          <StatusRow label="ブラウザ" id="browser-status" value="確認中" />
          <StatusRow label="安全判定" id="secure-status" value="確認中" />
          <StatusRow label="マイクAPI" id="media-status" value="確認中" />
          <StatusRow label="録音形式" id="recorder-status" value="未確認" />
          <StatusRow label="マイク権限" id="permission-status" value="未確認" />
          <StatusRow label="音声送信" id="stream-status" value="停止中" />
          <StatusRow label="最終送信" id="last-sent" value="未送信" />
          <div>
            <div className="mb-1 flex items-center justify-between text-[12px] font-black text-stone-600">
              <span>入力音量</span>
              <span id="level-value">0%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-stone-100">
              <div id="level-bar" className="h-full bg-emerald-600" style={{ width: "0%" }} />
            </div>
          </div>
        </div>

        <p
          id="error-message"
          className="mt-4 hidden rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] font-bold text-red-700"
        />
        <p
          id="help-message"
          className="mt-3 hidden rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-[13px] font-bold leading-relaxed text-amber-900"
        />

        <a
          id="https-link"
          href="#"
          className="mt-3 hidden min-h-10 rounded-md border border-amber-300 bg-white px-3 py-2 text-center text-[13px] font-black text-amber-900 active:scale-[0.99]"
        >
          HTTPSで開き直す
        </a>
        <button
          id="refresh-button"
          type="button"
          className="mt-2 min-h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-[13px] font-black text-stone-700 active:scale-[0.99]"
        >
          画面を更新
        </button>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            id="start-button"
            type="button"
            disabled
            className="min-h-12 rounded-md bg-stone-950 px-3 text-[14px] font-black text-white active:scale-[0.99] disabled:bg-stone-200 disabled:text-stone-400"
          >
            マイク開始
          </button>
          <button
            id="stop-button"
            type="button"
            disabled
            className="min-h-12 rounded-md border border-stone-300 bg-white px-3 text-[14px] font-black text-stone-700 active:scale-[0.99] disabled:bg-stone-100 disabled:text-stone-400"
          >
            停止
          </button>
        </div>
        <button
          id="reconnect-button"
          type="button"
          disabled
          className="mt-2 min-h-10 w-full rounded-md border border-emerald-700 bg-emerald-50 px-3 text-[13px] font-black text-emerald-900 active:scale-[0.99] disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400"
        >
          再接続
        </button>
      </section>
      <script dangerouslySetInnerHTML={{ __html: inlineRemoteMicScript }} />
    </main>
  );
}

function StatusRow(props: { label: string; id: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
      <span className="text-[12px] font-bold text-stone-500">{props.label}</span>
      <span id={props.id} className="text-right text-[13px] font-black text-stone-900">
        {props.value}
      </span>
    </div>
  );
}

const inlineRemoteMicScript = String.raw`
(function () {
  var CHUNK_MS = 2000;
  var HEARTBEAT_MS = 15000;
  var SESSION_CHECK_TIMEOUT_MS = 8000;
  var MIN_SEND_AVERAGE_LEVEL = 0.008;
  var MIN_SEND_PEAK_LEVEL = 0.03;
  var remoteMic = null;
  var micState = "idle";
  var stream = null;
  var recorder = null;
  var stopLevelMeter = null;
  var sequence = 0;
  var sending = false;
  var startedAt = 0;
  var mimeType = "";
  var heartbeatTimer = 0;
  var chunkLevel = { sum: 0, count: 0, peak: 0 };

  var $ = function (id) { return document.getElementById(id); };
  var setText = function (id, value) {
    var element = $(id);
    if (element) element.textContent = value;
  };
  var setHidden = function (id, hidden) {
    var element = $(id);
    if (!element) return;
    element.classList.toggle("hidden", hidden);
    element.classList.toggle("block", !hidden);
  };
  var setError = function (message) {
    setText("error-message", message || "");
    setHidden("error-message", !message);
  };
  var setHelp = function (message) {
    setText("help-message", message || "");
    setHidden("help-message", !message);
  };
  var setLevel = function (level) {
    var percent = Math.round(Math.max(0, Math.min(1, level)) * 100);
    setText("level-value", percent + "%");
    var bar = $("level-bar");
    if (bar) bar.style.width = percent + "%";
  };
  var setButtonState = function () {
    var canStart = Boolean(remoteMic) && micState === "idle";
    var startButton = $("start-button");
    var stopButton = $("stop-button");
    var reconnectButton = $("reconnect-button");
    if (startButton) startButton.disabled = !canStart;
    if (stopButton) stopButton.disabled = micState !== "streaming" && micState !== "requesting";
    if (reconnectButton) reconnectButton.disabled = !remoteMic;
  };

  function boot() {
    setText("open-url", window.location.protocol + "//" + window.location.host);
    setText("browser-status", getBrowserLabel(navigator.userAgent));
    setText("secure-status", getSecureContextLabel(window.isSecureContext));
    setText("media-status", getMediaSupportLabel(Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia), window.isSecureContext));

    var httpsUrl = getHttpsUrl(window.location.href);
    var httpsLink = $("https-link");
    if (httpsUrl && !window.isSecureContext && httpsLink) {
      httpsLink.href = httpsUrl;
      setHidden("https-link", false);
      window.setTimeout(function () { window.location.replace(httpsUrl); }, 800);
    }

    if (!window.isSecureContext) {
      setHelp(getInsecureContextHelp());
    } else if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      setHelp("HTTPSとしては開けていますが、マイクAPIが見えていません。QR読み取り後のカメラ内ブラウザではなく、右下の「…」からSafariで開いてください。");
    }

    $("refresh-button").addEventListener("click", function () {
      var url = new URL(window.location.href);
      url.searchParams.set("v", String(Date.now()));
      window.location.replace(url.toString());
    });
    $("start-button").addEventListener("click", start);
    $("stop-button").addEventListener("click", function () { stop(true); });
    $("reconnect-button").addEventListener("click", function () {
      stop(false).then(start);
    });

    loadSession();
  }

  async function loadSession() {
    var controller = new AbortController();
    var timeoutId = window.setTimeout(function () { controller.abort(); }, SESSION_CHECK_TIMEOUT_MS);
    try {
      var response = await fetch("/api/remote-mic/session", {
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error("認証情報を確認できません。PC画面から新しいQRコードを発行してください。(" + response.status + ")");
      }
      var data = await response.json();
      remoteMic = data.remoteMic;
      setText("role-title", remoteMic.role === "caregiver" ? "介護者用マイク" : "本人用マイク");
      setText("server-status", "接続準備完了");
      setButtonState();
    } catch (error) {
      setText("server-status", "未接続");
      setError(error && error.name === "AbortError"
        ? "サーバー接続確認がタイムアウトしました。Tailscale接続とSafariで開いているかを確認してください。"
        : errorMessage(error, "マイク接続を確認できませんでした。"));
      setButtonState();
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function start() {
    if (!remoteMic || micState !== "idle") return;
    setError("");
    setText("permission-status", "確認中");
    setText("stream-status", "取得中");
    micState = "requesting";
    setButtonState();

    try {
      if (!window.isSecureContext) throw new Error("HTTPSで接続してください。Tailscale ServeのHTTPS URLから開いてください。");
      if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || typeof MediaRecorder === "undefined") {
        throw new Error("このブラウザーではマイク録音を利用できません。");
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
      var created = createMediaRecorder(stream);
      recorder = created.recorder;
      mimeType = created.mimeType;
      setText("recorder-status", mimeType || "ブラウザー標準");

      try {
        stopLevelMeter = startLevelMeter(stream, function (nextLevel) {
          setLevel(nextLevel);
          chunkLevel.sum += nextLevel;
          chunkLevel.count += 1;
          chunkLevel.peak = Math.max(chunkLevel.peak, nextLevel);
        });
      } catch (_) {
        stopLevelMeter = null;
      }

      recorder.ondataavailable = function (event) {
        if (event.data && event.data.size > 0) sendChunk(event.data);
      };
      recorder.onerror = function () {
        setError("録音中にエラーが発生しました。");
      };

      startedAt = Date.now();
      chunkLevel = { sum: 0, count: 0, peak: 0 };
      recorder.start(CHUNK_MS);
      micState = "streaming";
      setText("permission-status", "許可済み");
      setText("stream-status", "送信中");
      startHeartbeat();
      setButtonState();
    } catch (error) {
      if (isPermissionError(error)) setText("permission-status", "拒否");
      setError(errorMessage(error, "マイクを開始できませんでした。"));
      await stop(false);
    }
  }

  async function sendChunk(blob) {
    if (sending) return;
    sending = true;
    var sentSequence = ++sequence;
    var capturedAt = startedAt || Date.now();
    var levels = chunkLevel;
    var averageLevel = levels.count > 0 ? levels.sum / levels.count : 0;
    var peakLevel = levels.peak;
    chunkLevel = { sum: 0, count: 0, peak: 0 };
    startedAt = Date.now();

    if (levels.count > 0 && averageLevel < MIN_SEND_AVERAGE_LEVEL && peakLevel < MIN_SEND_PEAK_LEVEL) {
      sending = false;
      return;
    }

    try {
      var formData = new FormData();
      formData.append("audio", blob, getAudioFileName(sentSequence, blob.type || mimeType));
      formData.append("client_chunk_id", createClientChunkId());
      formData.append("sequence", String(sentSequence));
      formData.append("captured_at", String(capturedAt));
      formData.append("duration_ms", String(Math.max(1, Date.now() - capturedAt)));
      formData.append("average_level", String(averageLevel));
      formData.append("peak_level", String(peakLevel));

      var response = await fetch("/api/remote-mic/chunks", { method: "POST", body: formData });
      if (!response.ok) {
        var detail = await response.json().catch(function () { return null; });
        throw new Error(((detail && detail.error) || "音声送信に失敗しました。") + " (" + response.status + ")");
      }
      setText("last-sent", new Date().toLocaleTimeString("ja-JP"));
      setText("server-status", "音声送信中");
    } catch (error) {
      setText("server-status", "通信エラー");
      setError(errorMessage(error, "音声送信に失敗しました。"));
    } finally {
      sending = false;
    }
  }

  async function stop(notifyServer) {
    if (heartbeatTimer) window.clearInterval(heartbeatTimer);
    heartbeatTimer = 0;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch (_) {}
    }
    recorder = null;
    if (stopLevelMeter) stopLevelMeter();
    stopLevelMeter = null;
    if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
    stream = null;
    mimeType = "";
    micState = "idle";
    setLevel(0);
    setText("recorder-status", "未確認");
    setText("stream-status", "停止中");
    if (notifyServer) {
      await fetch("/api/remote-mic/disconnect", { method: "POST" }).catch(function () {});
      setText("server-status", "停止中");
    }
    setButtonState();
  }

  function startHeartbeat() {
    if (heartbeatTimer) window.clearInterval(heartbeatTimer);
    heartbeatTimer = window.setInterval(function () {
      fetch("/api/remote-mic/heartbeat", { method: "POST" }).catch(function () {
        setText("server-status", "通信が不安定です");
      });
    }, HEARTBEAT_MS);
  }

  function createMediaRecorder(inputStream) {
    var supported = getSupportedAudioMimeTypes();
    for (var i = 0; i < supported.length; i += 1) {
      try {
        return { recorder: new MediaRecorder(inputStream, { mimeType: supported[i] }), mimeType: supported[i] };
      } catch (_) {}
    }
    try {
      return { recorder: new MediaRecorder(inputStream), mimeType: "" };
    } catch (_) {
      throw new Error("このブラウザーでは録音を開始できません。Safariを最新版にするか、別のブラウザーで開いてください。");
    }
  }

  function getSupportedAudioMimeTypes() {
    if (typeof MediaRecorder === "undefined") return [];
    return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
      .filter(function (candidate) { return MediaRecorder.isTypeSupported(candidate); });
  }

  function startLevelMeter(inputStream, onLevel) {
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio API is not available in this browser");
    var context = new AudioContextClass();
    var source = context.createMediaStreamSource(inputStream);
    var analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    var buffer = new Float32Array(analyser.fftSize);
    var frameId = 0;
    var stopped = false;
    source.connect(analyser);
    function tick() {
      if (stopped) return;
      analyser.getFloatTimeDomainData(buffer);
      onLevel(calculateLevel(buffer));
      frameId = window.requestAnimationFrame(tick);
    }
    frameId = window.requestAnimationFrame(tick);
    return function () {
      stopped = true;
      window.cancelAnimationFrame(frameId);
      try { source.disconnect(); } catch (_) {}
      context.close().catch(function () {});
    };
  }

  function calculateLevel(samples) {
    var sumSquares = 0;
    var peak = 0;
    for (var i = 0; i < samples.length; i += 1) {
      var sample = samples[i];
      var absolute = Math.abs(sample);
      sumSquares += sample * sample;
      if (absolute > peak) peak = absolute;
    }
    var rms = Math.sqrt(sumSquares / samples.length);
    return Math.min(1, Math.max(rms * 8, peak));
  }

  function getAudioFileName(currentSequence, currentMimeType) {
    var normalized = String(currentMimeType || "").toLowerCase();
    if (normalized.indexOf("mp4") !== -1) return "remote-mic-" + currentSequence + ".mp4";
    if (normalized.indexOf("ogg") !== -1) return "remote-mic-" + currentSequence + ".ogg";
    if (normalized.indexOf("wav") !== -1) return "remote-mic-" + currentSequence + ".wav";
    if (normalized.indexOf("mpeg") !== -1) return "remote-mic-" + currentSequence + ".mp3";
    return "remote-mic-" + currentSequence + ".webm";
  }

  function createClientChunkId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var random = new Uint32Array(4);
    crypto.getRandomValues(random);
    return Array.prototype.map.call(random, function (value) { return value.toString(36); }).join("-");
  }

  function getHttpsUrl(value) {
    try {
      var url = new URL(value);
      if (url.protocol !== "http:" || !url.hostname.endsWith(".ts.net")) return "";
      url.protocol = "https:";
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  function getSecureContextLabel(value) {
    if (value) return "安全な接続";
    if (window.location.protocol === "https:") return "HTTPSだが安全判定なし";
    return "HTTPSが必要";
  }

  function getMediaSupportLabel(mediaSupported, secureContext) {
    if (mediaSupported) return "利用可能";
    if (secureContext) return "利用不可/Safariで開く";
    return "利用不可/安全判定待ち";
  }

  function getInsecureContextHelp() {
    if (window.location.protocol === "https:") {
      return "URLはhttpsですが、この表示環境は安全なページとして扱われていません。QR読み取り後のカメラ内ブラウザではなく、右下の「…」からSafariで開いてください。";
    }
    return "この画面はHTTPSで開かれていません。Safariで https:// から始まるTailscale URLを開いてください。";
  }

  function getBrowserLabel(userAgent) {
    if (/CriOS/i.test(userAgent)) return "Chrome/iOS";
    if (/FxiOS/i.test(userAgent)) return "Firefox/iOS";
    if (/EdgiOS/i.test(userAgent)) return "Edge/iOS";
    if (/Safari/i.test(userAgent) && /Mobile/i.test(userAgent)) return "Safari系";
    return "不明";
  }

  function isPermissionError(error) {
    return error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
  }

  function errorMessage(error, fallback) {
    return error && error.message ? error.message : fallback;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
`;
