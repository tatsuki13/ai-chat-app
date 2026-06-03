'use client'; // ユーザーの操作（入力やクリック）を処理するために必要です

import { useState } from 'react';

export default function ChatPage() {
  // メッセージの履歴を保存する状態（最初はボットからの挨拶を入れておきます）
  const [messages, setMessages] = useState([
    { id: 1, text: 'こんにちは！それでは人生会議を始めて行きましょう！', sender: 'bot' }
  ]);
  // テキストボックスの入力内容を保存する状態
  const [inputText, setInputText] = useState('');

  // 送信ボタンが押されたときの処理
  const handleSendMessage = (e) => {
    e.preventDefault(); // フォーム送信による画面の再読み込みを防ぎます
    if (inputText.trim() === '') return; // 空白のみの場合は送信しない

    // 新しいメッセージのデータを作成
    const newMessage = {
      id: messages.length + 1,
      text: inputText,
      sender: 'user', // 自分（ユーザー）が送ったことを示すマーク
    };

    // 既存のメッセージ配列に新しいメッセージを追加して画面を更新
    setMessages([...messages, newMessage]);
    setInputText(''); // 送信後は入力欄を空にする
  };

  return (
    <div style={{ maxWidth: '400px', margin: '0 auto', border: '1px solid #ccc', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '500px' }}>
      
      {/* ヘッダー部分 */}
      <div style={{ backgroundColor: '#0070f3', color: 'white', padding: '16px', textAlign: 'center', fontWeight: 'bold' }}>
        チャット
      </div>

      {/* メッセージ表示エリア */}
      <div style={{ flex: 1, padding: '16px', overflowY: 'auto', backgroundColor: '#f9f9f9', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            style={{ 
              alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
              backgroundColor: msg.sender === 'user' ? '#0070f3' : '#e5e5ea',
              color: msg.sender === 'user' ? 'white' : 'black',
              padding: '10px 14px',
              borderRadius: '16px',
              maxWidth: '80%',
              wordBreak: 'break-word'
            }}
          >
            {msg.text}
          </div>
        ))}
      </div>

      {/* メッセージ入力・送信エリア */}
      <form onSubmit={handleSendMessage} style={{ display: 'flex', padding: '10px', borderTop: '1px solid #ccc', backgroundColor: 'white' }}>
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="メッセージを入力..."
          style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc', marginRight: '10px' }}
        />
        <button 
          type="submit"
          style={{ padding: '10px 20px', backgroundColor: '#0070f3', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          送信
        </button>
      </form>

    </div>
  );
}