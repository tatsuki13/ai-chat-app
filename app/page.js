'use client';

import { useEffect, useRef, useState } from 'react';

const topics = [
  {
    question: '最近の生活で、これからも続けたいことは何ですか。',
    lead: 'まずは、今の暮らしの中で大切にしていることから聞かせてください。',
    acknowledgement:
      '毎日の中で続けたいことには、その人らしさがよく表れますね。'
  },
  {
    question: '年齢を重ねても、自分らしく暮らすために大切にしたいことは何ですか。',
    lead: '次は、少し先の暮らし方について考えてみましょう。',
    acknowledgement:
      '自分らしさの軸が見えてくると、これからの選び方も少し考えやすくなります。'
  },
  {
    question: '将来、どのような場所や環境で暮らしていたいと思いますか。',
    lead: '暮らす場所や環境についても、思い浮かぶ範囲で聞かせてください。',
    acknowledgement:
      'どんな場所で落ち着けるかを考えることは、安心できる暮らしを考える手がかりになります。'
  },
  {
    question:
      '家事、買い物、通院、入浴などで手助けが必要になったら、どんな助け方なら受け入れやすいですか。',
    lead: 'もし手助けが必要になったときのことも、少し具体的に話してみましょう。',
    acknowledgement:
      '助けてもらい方を先に言葉にしておくと、必要なときに頼みやすくなります。'
  },
  {
    question:
      '家族に手伝ってもらうことについて、気になることや遠慮してしまうことはありますか。',
    lead: '家族との関わり方についても、気になることがあれば聞かせてください。',
    acknowledgement:
      '遠慮や気がかりも大事な気持ちです。そこを無理に消さずに考えられるとよさそうです。'
  },
  {
    question:
      '自分で医療や介護の方針を決めることが難しくなったら、誰に相談して決めてほしいですか。',
    lead: '次は、医療や介護の方針を一緒に考えてほしい相手についてです。',
    acknowledgement:
      '相談してほしい人を考えておくことは、自分の考えを守るための大事な準備になります。'
  },
  {
    question:
      '重い病気になったとき、治療を考えるうえで一番大切にしたいことは何ですか。',
    lead: '少し重い話題ですが、治療で大切にしたいことも確認しておきましょう。',
    acknowledgement:
      '治療で何を大切にしたいかは、人によって違います。今の言葉は大事な手がかりです。'
  },
  {
    question:
      '人生の最終段階を考えたとき、どこで、誰と、どのように過ごせると安心だと思いますか。',
    lead: '最後に、人生の最終段階を安心して過ごすための希望を聞かせてください。',
    acknowledgement:
      '安心できる過ごし方を言葉にしておくことは、周りの人にとっても大切な道しるべになります。'
  }
];

const openingMessage = `${topics[0].lead}\n\n${topics[0].question}`;

function createAssistantReply(topicIndex) {
  const currentTopic = topics[topicIndex];
  const nextTopic = topics[topicIndex + 1];

  if (!nextTopic) {
    return `${currentTopic.acknowledgement}\n\nここまで話してくれてありがとうございます。今日の会話で出てきた希望や気がかりは、家族や支援者と話すときの材料になります。`;
  }

  return `${currentTopic.acknowledgement}\n\n${nextTopic.lead}\n${nextTopic.question}`;
}

function createSkipReply(topicIndex) {
  const nextTopic = topics[topicIndex + 1];

  if (!nextTopic) {
    return 'このお題はここまでにしましょう。話しにくいことは、無理に言葉にしなくても大丈夫です。';
  }

  return `このお題は飛ばしましょう。話せるところからで大丈夫です。\n\n${nextTopic.lead}\n${nextTopic.question}`;
}

export default function ChatPage() {
  const [messages, setMessages] = useState([
    { id: 1, text: openingMessage, sender: 'bot' }
  ]);
  const [inputText, setInputText] = useState('');
  const [currentTopicIndex, setCurrentTopicIndex] = useState(0);
  const messagesEndRef = useRef(null);

  const isComplete = currentTopicIndex >= topics.length;
  const progressValue = Math.min(currentTopicIndex + 1, topics.length);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const resetConversation = () => {
    setMessages([{ id: 1, text: openingMessage, sender: 'bot' }]);
    setInputText('');
    setCurrentTopicIndex(0);
  };

  const appendMessages = (newMessages) => {
    setMessages((previousMessages) => {
      const startId = previousMessages.length + 1;

      return [
        ...previousMessages,
        ...newMessages.map((message, index) => ({
          id: startId + index,
          ...message
        }))
      ];
    });
  };

  const handleSendMessage = (event) => {
    event.preventDefault();

    const trimmedText = inputText.trim();
    if (!trimmedText || isComplete) return;

    const assistantReply = createAssistantReply(currentTopicIndex);

    appendMessages([
      { text: trimmedText, sender: 'user' },
      { text: assistantReply, sender: 'bot' }
    ]);

    setInputText('');
    setCurrentTopicIndex((previousIndex) => previousIndex + 1);
  };

  const handleSkipTopic = () => {
    if (isComplete) return;

    const assistantReply = createSkipReply(currentTopicIndex);

    appendMessages([{ text: assistantReply, sender: 'bot' }]);
    setCurrentTopicIndex((previousIndex) => previousIndex + 1);
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#f3f0e8',
        color: '#1f2933',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily:
          '"Hiragino Sans", "Yu Gothic", "Meiryo", system-ui, sans-serif'
      }}
    >
      <section
        aria-label="これからの暮らしについて話すチャット"
        style={{
          width: 'min(760px, 100%)',
          height: 'min(760px, calc(100vh - 48px))',
          minHeight: '560px',
          background: '#fffaf0',
          border: '1px solid #d8d1c2',
          borderRadius: '8px',
          boxShadow: '0 18px 40px rgba(31, 41, 51, 0.14)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <header
          style={{
            background: '#245c52',
            color: 'white',
            padding: '18px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px'
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: '20px',
                lineHeight: 1.35,
                fontWeight: 700
              }}
            >
              これからの暮らし相談
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: '13px', opacity: 0.9 }}>
              答えやすい範囲で、ひとつずつ話せます
            </p>
          </div>

          <button
            type="button"
            onClick={resetConversation}
            style={{
              border: '1px solid rgba(255, 255, 255, 0.7)',
              background: 'rgba(255, 255, 255, 0.12)',
              color: 'white',
              borderRadius: '6px',
              padding: '8px 12px',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            最初から
          </button>
        </header>

        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid #e4ddcf',
            background: '#fff5df',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}
        >
          <div
            aria-hidden="true"
            style={{
              flex: 1,
              height: '8px',
              background: '#e5ddca',
              borderRadius: '999px',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: `${(progressValue / topics.length) * 100}%`,
                height: '100%',
                background: '#d26f3f'
              }}
            />
          </div>
          <span style={{ fontSize: '13px', color: '#5f6c72' }}>
            {isComplete ? '完了' : `${progressValue} / ${topics.length}`}
          </span>
        </div>

        <div
          style={{
            flex: 1,
            padding: '20px',
            overflowY: 'auto',
            background: '#fbf7ee',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          {messages.map((message) => (
            <div
              key={message.id}
              style={{
                alignSelf: message.sender === 'user' ? 'flex-end' : 'flex-start',
                background:
                  message.sender === 'user' ? '#245c52' : '#ffffff',
                color: message.sender === 'user' ? 'white' : '#1f2933',
                padding: '12px 14px',
                border:
                  message.sender === 'user'
                    ? '1px solid #245c52'
                    : '1px solid #e0d8c8',
                borderRadius:
                  message.sender === 'user'
                    ? '16px 16px 4px 16px'
                    : '16px 16px 16px 4px',
                maxWidth: '82%',
                lineHeight: 1.7,
                fontSize: '15px',
                wordBreak: 'break-word',
                whiteSpace: 'pre-line'
              }}
            >
              {message.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form
          onSubmit={handleSendMessage}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto auto',
            gap: '10px',
            padding: '14px',
            borderTop: '1px solid #e4ddcf',
            background: '#fffaf0'
          }}
        >
          <input
            type="text"
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            placeholder={
              isComplete
                ? '最初から始めると、もう一度話せます'
                : 'ここに返答を入力'
            }
            disabled={isComplete}
            style={{
              minWidth: 0,
              padding: '12px',
              borderRadius: '6px',
              border: '1px solid #cfc5b2',
              background: isComplete ? '#eee8dc' : 'white',
              fontSize: '15px'
            }}
          />
          <button
            type="button"
            onClick={handleSkipTopic}
            disabled={isComplete}
            style={{
              padding: '10px 14px',
              background: '#ffffff',
              color: '#245c52',
              border: '1px solid #9eb2a7',
              borderRadius: '6px',
              cursor: isComplete ? 'default' : 'pointer',
              opacity: isComplete ? 0.5 : 1,
              whiteSpace: 'nowrap'
            }}
          >
            スキップ
          </button>
          <button
            type="submit"
            disabled={isComplete}
            style={{
              padding: '10px 18px',
              background: '#d26f3f',
              color: 'white',
              border: '1px solid #d26f3f',
              borderRadius: '6px',
              cursor: isComplete ? 'default' : 'pointer',
              opacity: isComplete ? 0.55 : 1,
              whiteSpace: 'nowrap',
              fontWeight: 700
            }}
          >
            送信
          </button>
        </form>
      </section>
    </main>
  );
}
