import React, { useState, useEffect, useRef } from 'react';
import { LogOut, Send, Plus, MessageSquare, Compass, ShieldAlert, FileText, CheckCircle2, Info } from 'lucide-react';
import MapView from './components/MapView';
import RequestList from './components/RequestList';
import ChatPanel from './components/ChatPanel';

const API_BASE = '/api';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user') || 'null'));
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('🦊');
  const [authError, setAuthError] = useState('');

  // App state
  const [activeTab, setActiveTab] = useState('map'); // 'map', 'requests', 'logs'
  const [emojiDrops, setEmojiDrops] = useState([]);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [outgoingRequests, setOutgoingRequests] = useState([]);
  const [myLocation, setMyLocation] = useState(null);
  const [locationAccuracy, setLocationAccuracy] = useState(null);
  const [adminLogs, setAdminLogs] = useState([]);
  
  // Active Chat states
  const [activeChat, setActiveChat] = useState(null); // Join request object
  const [chatMessages, setChatMessages] = useState([]);
  const [chatDistanceInfo, setChatDistanceInfo] = useState({}); // Key: user1-user2, value: { in_range, distance }

  const activeChatRef = useRef(null);
  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  const [dropDuration, setDropDuration] = useState(1);

  // UI state
  const [showDropPicker, setShowDropPicker] = useState(false);
  const [selectedDropToJoin, setSelectedDropToJoin] = useState(null);
  const [joinMessage, setJoinMessage] = useState('');

  const [isSignUp, setIsSignUp] = useState(false);
  const [allEmojis, setAllEmojis] = useState([]);
  const [typedEmoji, setTypedEmoji] = useState('');
  const [generatedInvite, setGeneratedInvite] = useState(null);

  // Refs
  const wsRef = useRef(null);
  const lastLocationSentRef = useRef(0);

  const avatars = ['🦊', '🐱', '🐼', '🦁', '🐸', '🐨', '🐙', '🦖', '🦄', '🐝'];

  const isEmojiOnly = (text) => {
    let temp = text.trim();
    if (!temp) return false;
    return /^[\p{Extended_Pictographic}\p{White_Space}\u200D\uFE0F\p{Emoji_Modifier}]+$/u.test(temp);
  };

  // Handle Login (existing users)
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!usernameInput || !passwordInput) {
      setAuthError('Please enter your username and password');
      return;
    }
    setAuthError('');

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput.trim(), password: passwordInput }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Login failed');
        return;
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
    } catch (err) {
      setAuthError('Server connection error. Please try again.');
    }
  };

  // Generate dynamic invite (3 emojis)
  const handleGenerateInvite = async () => {
    try {
      const res = await fetch(`${API_BASE}/invites`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setGeneratedInvite(data);
      } else {
        alert('Failed to generate invite code.');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyInviteMessage = () => {
    if (!generatedInvite) return;
    navigator.clipboard.writeText(generatedInvite.message)
      .then(() => alert('Invite message copied to clipboard!'))
      .catch(() => alert('Failed to copy. Please manually copy the message.'));
  };

  // Handle Login / Signup
  const handleAuth = async (e) => {
    e.preventDefault();
    if (!usernameInput || !passwordInput || !inviteCodeInput) {
      setAuthError('Please fill in all fields');
      return;
    }
    setAuthError('');

    try {
      const res = await fetch(`${API_BASE}/auth/invite/${inviteCodeInput.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput.trim(), password: passwordInput, avatar_url: selectedAvatar }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Authentication failed');
        return;
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
    } catch (err) {
      setAuthError('Server connection error. Please try again.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken('');
    setUser(null);
    if (wsRef.current) {
      wsRef.current.close();
    }
  };

  // Fetch initial data
  const fetchData = async () => {
    if (!token) return;
    try {
      const headers = { Authorization: `Bearer ${token}` };

      // Get emoji drops
      const dropsRes = await fetch(`${API_BASE}/emoji-drops`, { headers });
      if (dropsRes.ok) {
        const drops = await dropsRes.json();
        setEmojiDrops(drops);
      }

      // Get requests
      const incomingRes = await fetch(`${API_BASE}/join-requests/incoming`, { headers });
      if (incomingRes.ok) {
        const inc = await incomingRes.json();
        setIncomingRequests(inc);
      }

      const outgoingRes = await fetch(`${API_BASE}/join-requests/outgoing`, { headers });
      if (outgoingRes.ok) {
        const out = await outgoingRes.json();
        setOutgoingRequests(out);
      }
    } catch (err) {
      console.error('Failed to fetch data', err);
    }
  };

  // Trigger data fetch
  useEffect(() => {
    fetchData();
  }, [token, activeTab]);

  // Setup WebSockets
  useEffect(() => {
    if (!token) return;

    // Connect to WebSocket using relative protocol
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${token}`;
    
    console.log('[WebSocket] Connecting to:', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log('[WebSocket] Message received:', msg);

        switch (msg.type) {
          case 'emoji:new':
            setEmojiDrops((prev) => [msg.data, ...prev]);
            break;
          case 'emoji:deleted':
            setEmojiDrops((prev) => prev.filter((d) => d.id !== msg.data.id));
            break;
          case 'emoji:moved':
            setEmojiDrops((prev) => 
              prev.map(d => d.id === msg.data.id ? { ...d, latitude: msg.data.latitude, longitude: msg.data.longitude } : d)
            );
            break;
          case 'request:incoming':
            setIncomingRequests((prev) => [msg.data, ...prev]);
            break;
          case 'request:status_changed':
            setOutgoingRequests((prev) =>
              prev.map((r) => (r.id === msg.data.id ? { ...r, status: msg.data.status } : r))
            );
            // If active chat belongs to this request, notify or adjust status
            if (activeChatRef.current && activeChatRef.current.id === msg.data.id) {
              setActiveChat((prev) => prev ? { ...prev, status: msg.data.status } : null);
            }
            break;
          case 'chat:message':
            if (activeChatRef.current && activeChatRef.current.id === msg.data.join_request_id) {
              setChatMessages((prev) => {
                if (prev.some(m => m.id === msg.data.id)) return prev;
                return [...prev, msg.data];
              });
            }
            break;
          case 'range:status':
            const { user1, user2, in_range, distance } = msg.data;
            const key = [user1, user2].sort().join('-');
            setChatDistanceInfo((prev) => ({
              ...prev,
              [key]: { in_range, distance },
            }));
            break;
          case 'error':
            alert(msg.data.message || 'An error occurred');
            break;
          case 'pong':
            // heartbeat response
            break;
          default:
            break;
        }
      } catch (err) {
        console.error('[WebSocket] Failed parsing message:', err);
      }
    };

    ws.onclose = () => {
      console.log('[WebSocket] Closed. Reconnecting in 5s...');
      setTimeout(() => {
        if (token) {
          // Trigger a dummy re-evaluation of this effect
          setToken((t) => t);
        }
      }, 5000);
    };

    // Heartbeat ping interval
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    return () => {
      clearInterval(pingInterval);
      ws.close();
    };
  }, [token, activeChat]);

  // Geolocation watcher
  useEffect(() => {
    if (!token) return;

    if (!navigator.geolocation) {
      console.error('Geolocation is not supported by your browser');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setMyLocation({ lat: latitude, lng: longitude });
        setLocationAccuracy(Math.round(accuracy));

        const now = Date.now();
        // Throttle updates: send at most once every 5 seconds
        if (now - lastLocationSentRef.current > 5000) {
          lastLocationSentRef.current = now;
          
          // Send to backend via REST API
          fetch(`${API_BASE}/location`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ latitude, longitude, accuracy: Math.round(accuracy) }),
          })
            .then((r) => r.json())
            .then((res) => {
              if (res.connections) {
                // Update local distances
                const newDistances = {};
                res.connections.forEach((conn) => {
                  const key = [user.id, conn.other_user_id].sort().join('-');
                  newDistances[key] = { in_range: conn.in_range, distance: conn.distance };
                });
                setChatDistanceInfo((prev) => ({ ...prev, ...newDistances }));
              }
            })
            .catch((err) => console.error('Failed to update location:', err));

          // Also publish location update via WebSocket if open
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: 'location:update',
                data: { latitude, longitude, accuracy: Math.round(accuracy) },
              })
            );
          }
        }
      },
      (error) => {
        console.error('Geolocation error:', error.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [token, user]);

  // Load full emoji list
  useEffect(() => {
    if (token) {
      fetch(`${API_BASE}/emojis`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data)) {
            setAllEmojis(data);
          }
        })
        .catch(err => console.error('Failed to load full emoji list:', err));
    }
  }, [token]);

  // Keyboard entry for emoji

  // Drop Emoji
  const handleDropEmoji = async (emoji) => {
    if (!myLocation) {
      alert('Cannot drop emoji: Coordinates not available.');
      return;
    }
    setShowDropPicker(false);
    try {
      const res = await fetch(`${API_BASE}/emoji-drops`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          emoji,
          latitude: myLocation.lat,
          longitude: myLocation.lng,
          accuracy: locationAccuracy,
          duration_hours: dropDuration,
        }),
      });
      if (res.ok) {
        const drop = await res.json();
        // Add to local state immediately
        setEmojiDrops((prev) => [
          {
            ...drop,
            username: user.username,
            avatar_url: user.avatar_url,
          },
          ...prev,
        ]);
      } else {
        alert('Failed to drop emoji');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Delete own drop
  const handleDeleteDrop = async (dropId) => {
    try {
      const res = await fetch(`${API_BASE}/emoji-drops/${dropId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setEmojiDrops((prev) => prev.filter((d) => d.id !== dropId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Send Join Request
  const handleSendJoinRequest = async (e) => {
    e.preventDefault();
    if (!selectedDropToJoin) return;

    try {
      const res = await fetch(`${API_BASE}/join-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          emoji_drop_id: selectedDropToJoin.id,
          message: joinMessage,
        }),
      });

      if (res.ok) {
        const reqData = await res.json();
        setOutgoingRequests((prev) => [
          {
            ...reqData,
            owner_name: selectedDropToJoin.username,
            owner_id: selectedDropToJoin.user_id,
            emoji: selectedDropToJoin.emoji,
          },
          ...prev,
        ]);
        setSelectedDropToJoin(null);
        setJoinMessage('');
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to request join');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Accept/Reject Join Requests
  const handleRequestResponse = async (requestId, status) => {
    try {
      const res = await fetch(`${API_BASE}/join-requests/${requestId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setIncomingRequests((prev) => prev.filter((r) => r.id !== requestId));
        fetchData(); // reload arrays
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Open Chat Drawer
  const openChat = async (request) => {
    setActiveChat(request);
    setChatMessages([]);
    try {
      const res = await fetch(`${API_BASE}/chat/${request.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const history = await res.json();
        setChatMessages(history);
      }
    } catch (err) {
      console.error('Failed to load chat history', err);
    }
  };

  // Send chat message
  const handleSendChatMessage = async (msgText) => {
    if (!activeChat || !msgText.trim()) return;

    // First attempt to send via WebSocket for speed
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'chat:send',
          data: { join_request_id: activeChat.id, message: msgText.trim() },
        })
      );
    } else {
      // Fallback to REST API
      try {
        const res = await fetch(`${API_BASE}/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ join_request_id: activeChat.id, message: msgText.trim() }),
        });
        if (res.ok) {
          const msg = await res.json();
          setChatMessages((prev) => [...prev, { ...msg, sender_name: user.username }]);
        } else {
          const err = await res.json();
          alert(err.error || 'Failed to send message');
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Get active chat's range configuration
  const getActiveChatRange = () => {
    if (!activeChat || !user) return { in_range: false, distance: null };
    const otherId = activeChat.requester_id === user.id ? activeChat.owner_id || activeChat.user_id : activeChat.requester_id;
    const key = [user.id, otherId].sort().join('-');
    return chatDistanceInfo[key] || { in_range: false, distance: null };
  };

  if (!token) {
    return (
      <div className="auth-container">
        <div className="auth-card glass-panel">
          <div className="auth-logo">📍</div>
          <h1 className="auth-title">Emoji Location Chat</h1>
          <p className="auth-subtitle">Share emojis, match, and chat in close range.</p>

          <div 
            style={{ 
              display: 'flex', 
              borderBottom: '1px solid var(--border-color)', 
              marginBottom: 20, 
              backgroundColor: 'rgba(0,0,0,0.1)', 
              borderRadius: 'var(--radius-sm)', 
              overflow: 'hidden' 
            }}
          >
            <button
              type="button"
              className={`sidebar-tab ${!isSignUp ? 'active' : ''}`}
              style={{ padding: '10px', fontSize: '0.85rem' }}
              onClick={() => { setIsSignUp(false); setAuthError(''); }}
            >
              Log In
            </button>
            <button
              type="button"
              className={`sidebar-tab ${isSignUp ? 'active' : ''}`}
              style={{ padding: '10px', fontSize: '0.85rem' }}
              onClick={() => { setIsSignUp(true); setAuthError(''); }}
            >
              Sign Up
            </button>
          </div>
          
          {authError && <div style={{ color: 'var(--danger)', marginBottom: 15, fontSize: '0.9rem' }}>{authError}</div>}
          
          <form onSubmit={isSignUp ? handleAuth : handleLogin}>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                className="form-input"
                type="text"
                placeholder={isSignUp ? "Choose a username..." : "Enter your username..."}
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="form-input"
                type="password"
                placeholder="Enter your password..."
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                required
              />
            </div>
            
            {isSignUp && (
              <>
                <div className="form-group">
                  <label className="form-label">Avatar</label>
                  <div className="avatar-selector">
                    {avatars.map((av) => (
                      <div
                        key={av}
                        className={`avatar-option ${selectedAvatar === av ? 'selected' : ''}`}
                        onClick={() => setSelectedAvatar(av)}
                      >
                        {av}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Invite Code</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder="Paste 3-emoji code (e.g. 🔥👾🍕)..."
                    value={inviteCodeInput}
                    onChange={(e) => setInviteCodeInput(e.target.value)}
                    required
                  />
                </div>
              </>
            )}

            <button className="btn-primary" type="submit">
              {isSignUp ? 'Register & Sign Up' : 'Log In'} <Send size={16} />
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-wrapper tab-${activeTab}`}>
      {/* Sidebar Panel */}
      <aside className="dashboard-sidebar glass-panel">
        <header className="sidebar-header">
          <div className="user-profile-badge">
            <div className="user-avatar-circle">{user.avatar_url || '🦊'}</div>
            <div className="user-info">
              <div className="user-name">{user.username}</div>
              <div className="user-location-accuracy">
                {myLocation ? `GPS Accuracy: ±${locationAccuracy}m` : 'Locating...'}
              </div>
              <button 
                onClick={handleGenerateInvite}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: 'var(--primary)', 
                  fontSize: '0.75rem', 
                  cursor: 'pointer', 
                  padding: '2px 0', 
                  textAlign: 'left',
                  textDecoration: 'underline',
                  fontWeight: 600
                }}
              >
                + Create Invite
              </button>
            </div>
          </div>
          <button className="chat-close-btn" onClick={handleLogout} title="Log Out">
            <LogOut size={20} />
          </button>
        </header>

        <nav className="sidebar-nav-tabs">
          <button
            className={`sidebar-tab ${activeTab === 'map' ? 'active' : ''}`}
            onClick={() => setActiveTab('map')}
          >
            <Compass size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Map
          </button>
          <button
            className={`sidebar-tab ${activeTab === 'requests' ? 'active' : ''}`}
            onClick={() => setActiveTab('requests')}
          >
            <MessageSquare size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Chats
          </button>
          <button
            className={`sidebar-tab ${activeTab === 'about' ? 'active' : ''}`}
            onClick={() => setActiveTab('about')}
          >
            <Info size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> About
          </button>
        </nav>

        <div className="sidebar-content">
          {activeTab === 'about' && (
            <div style={{ padding: '10px 0', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <h2 style={{ fontSize: '1.4rem', background: 'linear-gradient(135deg, #fff 0%, #8b9bb4 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Welcome to Emoji Chat! 🌍
              </h2>
              
              <div className="request-card" style={{ cursor: 'default' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.3rem' }}>📍</span> Drop an Emoji
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                  Use the <strong>+</strong> button on the map to pin a single emoji at your current location. Other users will see it on their map!
                </p>
              </div>

              <div className="request-card" style={{ cursor: 'default' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.3rem' }}>🤝</span> Connect
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                  Tap someone else's emoji on the map to send them a chat request. If they accept, you will be connected!
                </p>
              </div>

              <div className="request-card" style={{ cursor: 'default' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.3rem' }}>📏</span> 100 Meter Rule
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                  You can only send messages if you are physically within <strong>100 meters</strong> of the other user! Walk closer if the chat is blocked!
                </p>
              </div>
            </div>
          )}

          {activeTab === 'map' && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', marginTop: 20 }}>
              Use the map to find emoji drops and connect with users!
            </div>
          )}

          {activeTab === 'requests' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div>
                <h3 style={{ marginBottom: 12 }}>Matched Conversations</h3>
                {outgoingRequests.filter((r) => r.status === 'accepted').length === 0 &&
                incomingRequests.filter((r) => r.status === 'accepted').length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', marginTop: 10 }}>
                    No active matches yet. Drop an emoji or tap a drop on the map to join one!
                  </div>
                ) : (
                  <div>
                    {/* Outgoing Matches */}
                    {outgoingRequests
                      .filter((r) => r.status === 'accepted')
                      .map((req) => {
                        const key = [user.id, req.owner_id || req.user_id].sort().join('-');
                        const distInfo = chatDistanceInfo[key] || { in_range: false, distance: null };
                        return (
                          <div
                            key={req.id}
                            className="request-card"
                            style={{ cursor: 'pointer' }}
                            onClick={() => openChat(req)}
                          >
                            <div className="request-card-header">
                              <div className="requester-info">
                                <span style={{ fontSize: '1.2rem' }}>💬</span>
                                <div>
                                  <div style={{ fontWeight: 600 }}>{req.owner_name}</div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                    Match (Emoji Drop: {req.emoji})
                                  </div>
                                </div>
                              </div>
                              <span
                                className="status-pill accepted"
                                style={{ color: distInfo.in_range ? 'var(--success)' : 'var(--danger)' }}
                              >
                                {distInfo.in_range ? 'In Range' : `${distInfo.distance ? `${distInfo.distance}m` : 'Offline'}`}
                              </span>
                            </div>
                          </div>
                        );
                      })}

                    {/* Incoming Matches */}
                    {incomingRequests
                      .filter((r) => r.status === 'accepted')
                      .map((req) => {
                        const key = [user.id, req.requester_id].sort().join('-');
                        const distInfo = chatDistanceInfo[key] || { in_range: false, distance: null };
                        return (
                          <div
                            key={req.id}
                            className="request-card"
                            style={{ cursor: 'pointer' }}
                            onClick={() => openChat(req)}
                          >
                            <div className="request-card-header">
                              <div className="requester-info">
                                <span style={{ fontSize: '1.2rem' }}>💬</span>
                                <div>
                                  <div style={{ fontWeight: 600 }}>{req.requester_name}</div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                    Requested your: {req.emoji}
                                  </div>
                                </div>
                              </div>
                              <span
                                className="status-pill accepted"
                                style={{ color: distInfo.in_range ? 'var(--success)' : 'var(--danger)' }}
                              >
                                {distInfo.in_range ? 'In Range' : `${distInfo.distance ? `${distInfo.distance}m` : 'Offline'}`}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              <div>
                <h3 style={{ marginBottom: 12 }}>Pending Requests</h3>
                <RequestList
                  incoming={incomingRequests.filter((r) => r.status === 'pending')}
                  outgoing={outgoingRequests.filter((r) => r.status !== 'accepted')}
                  onResponse={handleRequestResponse}
                />
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Map Main Canvas */}
      <main className="dashboard-map-container">
        <MapView
          myLocation={myLocation}
          emojiDrops={emojiDrops}
          userId={user.id}
          onDropSelect={(drop) => {
            if (drop.user_id !== user.id) {
              setSelectedDropToJoin(drop);
            }
          }}
          onDeleteDrop={handleDeleteDrop}
          acceptedRequests={[...incomingRequests, ...outgoingRequests].filter(r => r.status === 'accepted')}
          onChatSelect={openChat}
        />

        {/* Floating Action Buttons */}
        <div className="map-actions">
          <button className="btn-float" onClick={() => setShowDropPicker(!showDropPicker)} title="Drop Emoji Here">
            <Plus size={24} />
          </button>
        </div>

        {/* Floating Emoji Picker */}
        {showDropPicker && (
          <div className="emoji-picker-panel glass-panel" style={{ width: '360px', maxHeight: '450px', display: 'flex', flexDirection: 'column' }}>
            <h4 style={{ fontSize: '0.95rem', marginBottom: 10 }}>Drop an Emoji at your location</h4>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Duration:</span>
              {[1, 3, 6, 8].map((h) => (
                <button
                  key={h}
                  type="button"
                  style={{
                    padding: '4px 8px',
                    fontSize: '0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    background: dropDuration === h ? 'var(--primary)' : 'rgba(255, 255, 255, 0.05)',
                    color: dropDuration === h ? 'var(--bg-primary)' : 'var(--text-main)',
                    fontWeight: dropDuration === h ? 700 : 400,
                    cursor: 'pointer'
                  }}
                  onClick={() => setDropDuration(h)}
                >
                  {h}h
                </button>
              ))}
            </div>

            <input
              type="text"
              className="form-input"
              style={{ padding: '12px', fontSize: '2rem', textAlign: 'center', marginBottom: 12, height: '80px' }}
              placeholder="Paste 1 emoji..."
              value={typedEmoji}
              onChange={(e) => setTypedEmoji(e.target.value)}
            />

            <button 
              className="btn-primary" 
              onClick={() => {
                const char = typedEmoji.trim();
                const chars = Array.from(char);
                if (chars.length !== 1) {
                  alert('Please enter exactly ONE emoji.');
                  return;
                }
                if (!isEmojiOnly(char)) {
                  alert('Please enter an emoji, not text.');
                  return;
                }
                handleDropEmoji(char);
                setTypedEmoji('');
              }}
            >
              Drop Pin <Compass size={16} />
            </button>
            
            <button
              className="btn-sm btn-reject"
              style={{ marginTop: 12 }}
              onClick={() => { setShowDropPicker(false); setTypedEmoji(''); }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Join Request Modal Overlay */}
        {selectedDropToJoin && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              backgroundColor: 'rgba(0,0,0,0.6)',
              zIndex: 1000,
            }}
          >
            <div className="join-request-modal glass-panel">
              <h3 style={{ marginBottom: 12 }}>Join request to {selectedDropToJoin.username}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 16 }}>
                They dropped the emoji: <span style={{ fontSize: '1.4rem' }}>{selectedDropToJoin.emoji}</span>. Send a
                message to join their chat.
              </p>
              
              <form onSubmit={handleSendJoinRequest}>
                <div className="form-group">
                  <label className="form-label">Message</label>
                  <textarea
                    className="form-input"
                    rows="3"
                    style={{ resize: 'none' }}
                    placeholder="Introduce yourself or say why you want to meet up..."
                    value={joinMessage}
                    onChange={(e) => setJoinMessage(e.target.value)}
                    required
                  ></textarea>
                </div>
                <div className="request-actions" style={{ marginTop: 20 }}>
                  <button className="btn-sm btn-accept" type="submit">
                    Send Request
                  </button>
                  <button
                    className="btn-sm btn-reject"
                    type="button"
                    onClick={() => {
                      setSelectedDropToJoin(null);
                      setJoinMessage('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Generated Invite Modal */}
        {generatedInvite && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              backgroundColor: 'rgba(0,0,0,0.6)',
              zIndex: 2000,
            }}
          >
            <div className="join-request-modal glass-panel">
              <h3 style={{ marginBottom: 12 }}>Invite Code Created!</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 16 }}>
                Copy and share this invite message with your friends:
              </p>
              
              <div 
                style={{ 
                  backgroundColor: 'var(--bg-input)', 
                  border: '1px solid var(--border-color)', 
                  padding: '12px', 
                  borderRadius: 'var(--radius-md)', 
                  fontFamily: 'monospace', 
                  fontSize: '0.85rem',
                  whiteSpace: 'pre-wrap',
                  marginBottom: 20,
                  color: 'var(--text-main)'
                }}
              >
                {generatedInvite.message}
              </div>

              <div className="request-actions">
                <button className="btn-sm btn-accept" onClick={handleCopyInviteMessage}>
                  Copy Message
                </button>
                <button
                  className="btn-sm btn-reject"
                  onClick={() => setGeneratedInvite(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Chat panel drawer */}
      {activeChat && (
        <ChatPanel
          request={activeChat}
          messages={chatMessages}
          user={user}
          range={getActiveChatRange()}
          onSendMessage={handleSendChatMessage}
          onClose={() => setActiveChat(null)}
          isEmojiOnly={isEmojiOnly}
          allEmojis={allEmojis}
        />
      )}
    </div>
  );
}
