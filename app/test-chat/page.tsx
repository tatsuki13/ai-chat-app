"use client";

import { useState } from "react";

export default function TestChatPage() {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendMessage() {
    setLoading(true);
    setReply("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setReply(data.error ?? "エラーが発生しました");
        return;
      }

      setReply(data.reply);
    } catch (error) {
      setReply("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>GPT API テスト</h1>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="将来ケア対話について聞きたいことを入力"
        rows={5}
        style={{ width: "100%", maxWidth: 600 }}
      />

      <br />

      <button onClick={sendMessage} disabled={loading || !message}>
        {loading ? "送信中..." : "送信"}
      </button>

      <h2>AIの返答</h2>
      <p style={{ whiteSpace: "pre-wrap" }}>{reply}</p>
    </main>
  );
}