'use client';

import { useEffect, useRef, useState } from 'react';

const topics = [
  {
    question: '最近の生活で、これからも続けたいことは何ですか。',
    lead: 'まずは、今の暮らしの中で大切にしていることから聞かせてください。',
    fallback:
      '毎日の中で続けたいことには、その人らしさがよく表れますね。'
  },
  {
    question: '年齢を重ねても、自分らしく暮らすために大切にしたいことは何ですか。',
    lead: '次は、少し先の暮らし方について考えてみましょう。',
    fallback:
      '自分らしさの軸が見えてくると、これからの選び方も少し考えやすくなります。'
  },
  {
    question: '将来、どのような場所や環境で暮らしていたいと思いますか。',
    lead: '暮らす場所や環境についても、思い浮かぶ範囲で聞かせてください。',
    fallback:
      'どんな場所で落ち着けるかを考えることは、安心できる暮らしを考える手がかりになります。'
  },
  {
    question:
      '家事、買い物、通院、入浴などで手助けが必要になったら、どんな助け方なら受け入れやすいですか。',
    lead: 'もし手助けが必要になったときのことも、少し具体的に話してみましょう。',
    fallback:
      '助けてもらい方を先に言葉にしておくと、必要なときに頼みやすくなります。'
  },
  {
    question:
      '家族に手伝ってもらうことについて、気になることや遠慮してしまうことはありますか。',
    lead: '家族との関わり方についても、気になることがあれば聞かせてください。',
    fallback:
      '遠慮や気がかりも大事な気持ちです。そこを無理に消さずに考えられるとよさそうです。'
  },
  {
    question:
      '自分で医療や介護の方針を決めることが難しくなったら、誰に相談して決めてほしいですか。',
    lead: '次は、医療や介護の方針を一緒に考えてほしい相手についてです。',
    fallback:
      '相談してほしい人を考えておくことは、自分の考えを守るための大事な準備になります。'
  },
  {
    question:
      '重い病気になったとき、治療を考えるうえで一番大切にしたいことは何ですか。',
    lead: '少し重い話題ですが、治療で大切にしたいことも確認しておきましょう。',
    fallback:
      '治療で何を大切にしたいかは、人によって違います。今の言葉は大事な手がかりです。'
  },
  {
    question:
      '人生の最終段階を考えたとき、どこで、誰と、どのように過ごせると安心だと思いますか。',
    lead: '最後に、人生の最終段階を安心して過ごすための希望を聞かせてください。',
    fallback:
      '安心できる過ごし方を言葉にしておくことは、周りの人にとっても大切な道しるべになります。'
  }
];

const openingMessage = `${topics[0].lead}\n\n${topics[0].question}`;

function getFallbackReply(topicIndex) {
  const currentTopic = topics[topicIndex];
  const nextTopic = topics[topicIndex + 1];

  if (!nextTopic) {
    return `${currentTopic.fallback}\n\nここまで話してくれてありがとうございます。今日の会話で出てきた希望や気がかりは、家族や支援者と話すときの材料になります。`;
  }

  return `${currentTopic.fallback}\n\n${nextTopic.lead}\n${nextTopic.question}`;
}

function getSkipReply(topicIndex) {
  const nextTopic = topics[topicIndex + 1];

  if (!nextTopic) {
    return 'このお題はここまでにしましょう。話しにくいことは、無理に言葉にしなくても大丈夫です。';
  }

  return `このお題は飛ばしましょう。話せるところからで大丈夫です。\n\n${nextTopic.lead}\n${nextTopic.question}`;
}

function buildApiPrompt({ messages, topicIndex, userAnswer }) {
  const currentTopic = topics[topicIndex];
  const nextTopic = topics[topicIndex + 1];
  const recentConversation = messages
    .slice(-8)
    .map((message) => {
      const role = message.sender === 'user' ? '利用者' : 'AI';
      return `${role}: ${message.text}`;
    })
    .join('\n');

  return `
あなたは、これからの暮らし・医療・介護について話しやすくする対話支援AIです。
利用者の返答を受け止めたうえで、次のお題を自然に振ってください。

会話の目的:
- 利用者が自分の希望、気がかり、大切にしたいことを言葉にしやすくする。
- 医療や介護の方針を断定せず、利用者本人の考えを尊重する。
- 重い話題でも、落ち着いた、やわらかい言葉で進める。

返答ルール:
- 日本語で返答する。
- 3から5文くらいにする。
- 最初に、利用者の答えを1から2文で具体的に受け止める。
- 勝手な診断、治療判断、介護方針の決定はしない。
- 次のお題がある場合は、最後に次のお題を自然に質問する。
- 次のお題がない場合は、感謝を伝え、家族や支援者と話す材料になることを短く伝える。
- 箇条書きではなく、会話文として返す。

直近の会話:
${recentConversation || 'まだ会話はありません。'}

今のお題:
${currentTopic.question}

利用者の返答:
${userAnswer}

次のお題:
${nextTopic ? nextTopic.question : 'なし。これが最後のお題です。'}
`.trim();
}

export default function ChatPage() {
  const [messages, setMessages] = useState([
    { id: 1, text: openingMessage, sender: 'bot' }
  ]);
  const [inputText, setInputText] = useState('');
  const [currentTopicIndex, setCurrentTopicIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const isComplete = currentTopicIndex >= topics.length;
  const progressValue = Math.min(currentTopicIndex + 1, topics.length);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const resetConversation = () => {
    setMessages([{ id: 1, text: openingMessage, sender: 'bot' }]);
    setInputText('');
    setCurrentTopicIndex(0);
    setIsLoading(false);
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

  const requestAssistantReply = async (userAnswer) => {
    const prompt = buildApiPrompt({
      messages,
      topicIndex: currentTopicIndex,
      userAnswer
    });

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: prompt
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'GPT API から返答を取得できませんでした。');
    }

    return data.reply || getFallbackReply(currentTopicIndex);
  };

  const handleSendMessage = async (event) => {
    event.preventDefault();

    const trimmedText = inputText.trim();
    if (!trimmedText || isComplete || isLoading) return;

    setInputText('');
    setIsLoading(true);

    try {
      const assistantReply = await requestAssistantReply(trimmedText);

      appendMessages([
        { text: trimmedText, sender: 'user' },
        { text: assistantReply, sender: 'bot' }
      ]);

      setCurrentTopicIndex((previousIndex) => previousIndex + 1);
    } catch (error) {
      console.error(error);
      appendMessages([
        { text: trimmedText, sender: 'user' },
        {
          text:
            'AIの返答を取得できませんでした。APIキーや通信状態を確認して、同じ内容でもう一度送信してください。',
          sender: 'bot'
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkipTopic = () => {
    if (isComplete || isLoading) return;

    const assistantReply = getSkipReply(currentTopicIndex);

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
              GPT API が返答を受け止め、次のお題へつなげます
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

          {isLoading && (
            <div
              style={{
                alignSelf: 'flex-start',
                background: '#ffffff',
                color: '#5f6c72',
                padding: '12px 14px',
                border: '1px solid #e0d8c8',
                borderRadius: '16px 16px 16px 4px',
                maxWidth: '82%',
                lineHeight: 1.7,
                fontSize: '15px'
              }}
            >
              AIが返答を考えています...
            </div>
          )}

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
            disabled={isComplete || isLoading}
            style={{
              minWidth: 0,
              padding: '12px',
              borderRadius: '6px',
              border: '1px solid #cfc5b2',
              background: isComplete || isLoading ? '#eee8dc' : 'white',
              fontSize: '15px'
            }}
          />
          <button
            type="button"
            onClick={handleSkipTopic}
            disabled={isComplete || isLoading}
            style={{
              padding: '10px 14px',
              background: '#ffffff',
              color: '#245c52',
              border: '1px solid #9eb2a7',
              borderRadius: '6px',
              cursor: isComplete || isLoading ? 'default' : 'pointer',
              opacity: isComplete || isLoading ? 0.5 : 1,
              whiteSpace: 'nowrap'
            }}
          >
            スキップ
          </button>
          <button
            type="submit"
            disabled={isComplete || isLoading}
            style={{
              padding: '10px 18px',
              background: '#d26f3f',
              color: 'white',
              border: '1px solid #d26f3f',
              borderRadius: '6px',
              cursor: isComplete || isLoading ? 'default' : 'pointer',
              opacity: isComplete || isLoading ? 0.55 : 1,
              whiteSpace: 'nowrap',
              fontWeight: 700
            }}
          >
            {isLoading ? '送信中' : '送信'}
          </button>
        </form>
      </section>
    </main>
  );
}
