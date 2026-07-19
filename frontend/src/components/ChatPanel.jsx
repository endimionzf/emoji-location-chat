import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Lock, SmilePlus } from 'lucide-react';

export default function ChatPanel({ request, messages, user, range, onSendMessage, onClose, isEmojiOnly, allEmojis }) {
  const [inputText, setInputText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');
  const messagesEndRef = useRef(null);
  const emojiSearchRef = useRef(null);

  // Emoji-only mode when out of range
  const emojiOnlyMode = !range.in_range;

  // Strip non-emoji characters from a string (used when out of range)
  const filterEmojiOnly = (text) => {
    const matches = text.match(/[\p{Extended_Pictographic}\p{White_Space}\u200D\uFE0F\p{Emoji_Modifier}]/gu);
    return matches ? matches.join('') : '';
  };

  // Find recipient details
  const isOwner = request.owner_id === user.id;
  const recipientName = isOwner ? request.requester_name : request.owner_name;
  const recipientAvatar = isOwner ? request.requester_avatar || '🦊' : request.owner_avatar || '🦊';

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, range.in_range]);

  // Auto-focus search when picker opens
  useEffect(() => {
    if (showEmojiPicker && emojiSearchRef.current) {
      setTimeout(() => emojiSearchRef.current?.focus(), 60);
    }
  }, [showEmojiPicker]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    if (emojiOnlyMode && isEmojiOnly && !isEmojiOnly(inputText)) {
      alert('Text chat is locked — you are out of range. Emojis only!');
      return;
    }
    onSendMessage(inputText);
    setInputText('');
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    if (emojiOnlyMode) {
      // Strip any non-emoji characters as the user types
      setInputText(filterEmojiOnly(val));
    } else {
      setInputText(val);
    }
  };

  const insertEmoji = (emoji) => {
    setInputText((prev) => prev + emoji);
    setShowEmojiPicker(false);
    setEmojiSearch('');
  };

  // Filtered emoji list for the picker
  const filteredEmojis = allEmojis
    ? allEmojis.filter(
        (e) =>
          !emojiSearch ||
          (e.name && e.name.toLowerCase().includes(emojiSearch.toLowerCase())) ||
          (e.short_name && e.short_name.toLowerCase().includes(emojiSearch.toLowerCase()))
      )
    : [];

  const quickEmojis = ['🔥', '👾', '🍕', '🍻', '🎉', '⚽', '🎒', '🍿', '☕', '🌟', '❤️', '🐱', '🚀', '🎮', '😂', '😍', '🙌', '💯'];

  return (
    <div className="chat-drawer glass-panel">
      <header className="chat-header">
        <div className="chat-header-user">
          <div className="user-avatar-circle" style={{ width: 36, height: 36, fontSize: '1.4rem', border: '1px solid var(--primary)' }}>
            {recipientAvatar}
          </div>
          <div>
            <h3 style={{ fontSize: '1rem', lineHeight: '1.2' }}>{recipientName}</h3>
            <span style={{ fontSize: '0.75rem', color: range.in_range ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
              {range.in_range 
                ? '• Connected (<100m)' 
                : `• Out of Range (${range.distance !== null ? `${range.distance}m` : 'estimating...'})`
              }
            </span>
          </div>
        </div>
        <button className="chat-close-btn" onClick={onClose}>
          <X size={20} />
        </button>
      </header>

      {/* Main chat messages container */}
      <div className="chat-messages-area">
        {messages.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', marginTop: 'auto', marginBottom: 'auto' }}>
            🎉 Match unlocked! Say hello to {recipientName}.
          </div>
        ) : (
          messages.map((msg) => {
            const isOwn = msg.sender_id === user.id;
            return (
              <div key={msg.id} className={`chat-bubble-wrapper ${isOwn ? 'own' : 'other'}`}>
                <div className="chat-bubble">{msg.message}</div>
                <span className="chat-timestamp">
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Emoji-only mode banner */}
      {emojiOnlyMode && (
        <div style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: 'var(--danger)', fontSize: '0.78rem', padding: '6px 16px', borderTop: '1px solid var(--border-color)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Lock size={12} /> Emoji-only mode — letters blocked. Move within 100m to text.
        </div>
      )}

      {/* Floating Emoji Picker */}
      {showEmojiPicker && (
        <div style={{ position: 'absolute', bottom: 64, left: 12, right: 12, zIndex: 200, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', boxShadow: '0 -8px 32px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', maxHeight: 300 }}>
          <div style={{ padding: '10px 12px 6px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border-color)' }}>
            <input
              ref={emojiSearchRef}
              type="text"
              className="form-input"
              style={{ flex: 1, padding: '6px 10px', fontSize: '0.82rem' }}
              placeholder="Search emojis…"
              value={emojiSearch}
              onChange={(e) => setEmojiSearch(e.target.value)}
            />
            <button type="button" onClick={() => { setShowEmojiPicker(false); setEmojiSearch(''); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>✕</button>
          </div>
          {!emojiSearch && (
            <div style={{ display: 'flex', gap: 4, padding: '8px 10px 4px', overflowX: 'auto', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
              {quickEmojis.map((em) => (
                <button key={em} type="button" style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', flexShrink: 0, padding: 2 }} onClick={() => insertEmoji(em)}>{em}</button>
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 40px)', gap: 2, padding: '8px 10px', overflowY: 'auto', flex: 1 }}>
            {filteredEmojis.length === 0 ? (
              <div style={{ gridColumn: 'span 8', color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: 12 }}>No emojis found</div>
            ) : (
              filteredEmojis.slice(0, 300).map((em) => (
                <button
                  key={em.char}
                  type="button"
                  title={em.name || em.short_name}
                  style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', borderRadius: 4, padding: 4, lineHeight: 1 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  onClick={() => insertEmoji(em.char)}
                >
                  {em.char}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Footer input form */}
      <form onSubmit={handleSend} className="chat-input-area" style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setShowEmojiPicker((v) => !v)}
          title="Pick emoji"
          style={{ background: showEmojiPicker ? 'rgba(99,102,241,0.2)' : 'none', border: 'none', color: showEmojiPicker ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', padding: '0 10px', display: 'flex', alignItems: 'center', flexShrink: 0, transition: 'color 0.2s' }}
        >
          <SmilePlus size={22} />
        </button>
        <input
          type="text"
          className="form-input"
          style={{ flex: 1 }}
          placeholder={emojiOnlyMode ? 'Emojis only — letters are blocked…' : `Message ${recipientName}…`}
          value={inputText}
          onChange={handleInputChange}
        />
        <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '12px 20px', borderRadius: 'var(--radius-md)' }} disabled={!inputText.trim()}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
