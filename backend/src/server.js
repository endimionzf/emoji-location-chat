const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const logger = require('./logging');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_change_me';

app.use(cors());
app.use(express.json());

// Load and parse emoji.json
const fs = require('fs');
const path = require('path');

let emojiList = [];
const loadEmojis = () => {
  const pathsToTry = [
    '/app/emoji.json',
    path.join(__dirname, '..', '..', 'emoji.json'),
    path.join(__dirname, '..', 'emoji.json'),
    path.join(__dirname, 'emoji.json')
  ];

  let rawData = null;
  for (const p of pathsToTry) {
    try {
      if (fs.existsSync(p)) {
        rawData = fs.readFileSync(p, 'utf8');
        console.log(`[Emojis] Loaded emoji.json successfully from: ${p}`);
        break;
      }
    } catch (e) {
      // skip
    }
  }

  if (rawData) {
    try {
      const parsed = JSON.parse(rawData);
      emojiList = parsed.map(item => {
        try {
          const char = item.unified.split('-')
            .map(hex => String.fromCodePoint(parseInt(hex, 16)))
            .join('');
          return {
            char,
            name: item.name || '',
            short_name: item.short_name || '',
            category: item.category || ''
          };
        } catch (e) {
          return null;
        }
      }).filter(Boolean);
      console.log(`[Emojis] Processed ${emojiList.length} unique emojis.`);
    } catch (err) {
      console.error('[Emojis] Error parsing emoji.json:', err.message);
    }
  }

  if (emojiList.length === 0) {
    console.warn('[Emojis] Fallback list used due to missing or empty emoji.json');
    emojiList = [
      { char: '🔥', name: 'FIRE', short_name: 'fire', category: 'Smileys & Emotion' },
      { char: '👾', name: 'ALIEN MONSTER', short_name: 'space_invader', category: 'Smileys & Emotion' },
      { char: '🍕', name: 'SLICE OF PIZZA', short_name: 'pizza', category: 'Food & Drink' },
      { char: '🍻', name: 'CLINKING BEER MUGS', short_name: 'beers', category: 'Food & Drink' },
      { char: '🎉', name: 'PARTY POPPER', short_name: 'tada', category: 'Activities' },
      { char: '⚽', name: 'SOCCER BALL', short_name: 'soccer', category: 'Activities' },
      { char: '🎒', name: 'SCHOOL BAG', short_name: 'school_satchel', category: 'Objects' },
      { char: '🍿', name: 'POPCORN', short_name: 'popcorn', category: 'Food & Drink' },
      { char: '☕', name: 'HOT BEVERAGE', short_name: 'coffee', category: 'Food & Drink' },
      { char: '🌟', name: 'GLOWING STAR', short_name: 'glowing_star', category: 'Travel & Places' },
      { char: '🌮', name: 'TACO', short_name: 'taco', category: 'Food & Drink' },
      { char: '🎭', name: 'PERFORMING ARTS', short_name: 'performing_arts', category: 'Activities' },
      { char: '🎸', name: 'GUITAR', short_name: 'guitar', category: 'Activities' },
      { char: '🎮', name: 'VIDEO GAME', short_name: 'video_game', category: 'Activities' },
      { char: '🌈', name: 'RAINBOW', short_name: 'rainbow', category: 'Travel & Places' },
      { char: '🛹', name: 'SKATEBOARD', short_name: 'skateboard', category: 'Activities' },
      { char: '🎳', name: 'BOWLING', short_name: 'bowling', category: 'Activities' },
      { char: '🍺', name: 'BEER MUG', short_name: 'beer', category: 'Food & Drink' }
    ];
  }
};
loadEmojis();

// Helper: Check if string consists only of emoji characters and whitespace
const isEmojiOnly = (text) => {
  let temp = text.trim();
  if (!temp) return false;
  return /^[\p{Extended_Pictographic}\p{White_Space}\u200D\uFE0F\p{Emoji_Modifier}]+$/u.test(temp);
};

// In-memory range state storage
// Key: 'user1-user2' (sorted), Value: boolean (true if in range)
const rangeStates = new Map();

// Active websocket connections: Map of userId -> WebSocket instance
const activeConnections = new Map();

// Helper: Haversine distance formula
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// WebSocket Broadcast Helper
const sendToUser = (userId, message) => {
  if (!userId) return false;
  const client = activeConnections.get(userId.toString()) || activeConnections.get(parseInt(userId, 10));
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
    return true;
  }
  return false;
};

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = decoded;
    next();
  });
};

// --- AUTHENTICATION ROUTES ---

// Signup / Signin with Invite Code
app.post('/api/auth/invite/:code', async (req, res) => {
  const { code } = req.params;
  const { username, password, avatar_url } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if invite code exists and is active
    const inviteRes = await client.query(
      'SELECT * FROM invites WHERE code = $1 AND is_active = TRUE',
      [code]
    );

    if (inviteRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid or already used invite code' });
    }

    const invite = inviteRes.rows[0];

    // Create or find user
    let userRes = await client.query('SELECT * FROM users WHERE username = $1', [username]);
    let user;

    if (userRes.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists. Please login instead.' });
    } else {
      const newUserRes = await client.query(
        'INSERT INTO users (username, password, avatar_url, invite_code) VALUES ($1, $2, $3, $4) RETURNING *',
        [username, password, avatar_url || null, code]
      );
      user = newUserRes.rows[0];
    }

    // Deactivate invite code and mark as used
    await client.query(
      'UPDATE invites SET is_active = FALSE, used_by = $1, used_at = NOW() WHERE id = $2',
      [user.id, invite.id]
    );

    await client.query('COMMIT');

    const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, JWT_SECRET, {
      expiresIn: '7d',
    });

    logger.info('User signup completed', {
      user_id: user.id,
      event_type: 'user_signup',
      data: { invite_code: code, username: user.username },
    });

    res.json({ token, user: { id: user.id, username: user.username, avatar_url: user.avatar_url, is_admin: user.is_admin } });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Signup error', {
      event_type: 'error',
      data: { error_message: err.message },
    });
    res.status(500).json({ error: 'Internal server error during signup' });
  } finally {
    client.release();
  }
});

// Separate Login Flow (existing users)
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const userRes = await pool.query('SELECT * FROM users WHERE username = $1', [username.trim()]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User does not exist. Please register using an invite code.' });
    }

    const user = userRes.rows[0];

    // Simple plain-text password check
    if (user.password !== password) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, JWT_SECRET, {
      expiresIn: '7d',
    });

    logger.info('User logged in successfully', {
      user_id: user.id,
      event_type: 'user_login',
      data: { username: user.username },
    });

    res.json({ token, user: { id: user.id, username: user.username, avatar_url: user.avatar_url, is_admin: user.is_admin } });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// Get all available emoji characters
app.get('/api/emojis', authenticateToken, (req, res) => {
  res.json(emojiList);
});

// Generate dynamic emoji invite code (3 random emojis)
app.post('/api/invites', authenticateToken, async (req, res) => {
  try {
    if (emojiList.length === 0) {
      return res.status(500).json({ error: 'Emoji list is empty' });
    }
    
    // Choose 3 random emojis
    let code = '';
    for (let i = 0; i < 3; i++) {
      const idx = Math.floor(Math.random() * emojiList.length);
      code += emojiList[idx].char;
    }

    const result = await pool.query(
      'INSERT INTO invites (code, created_by, is_active) VALUES ($1, $2, TRUE) RETURNING *',
      [code, req.user.id]
    );

    const invite = result.rows[0];
    res.json({
      code: invite.code,
      message: `Hey! Join me on Emoji Chat with this invite code: ${invite.code}`
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate invite: ' + err.message });
  }
});

// Logout
app.post('/api/auth/logout', authenticateToken, (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

// --- EMOJI DROPS ---

// Drop emoji at location
app.post('/api/emoji-drops', authenticateToken, async (req, res) => {
  const { emoji, latitude, longitude, accuracy, duration_hours } = req.body;

  if (!emoji || latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  // Ensure dropped item is a valid single emoji from our list
  const validChars = emojiList.map(e => e.char);
  if (!validChars.includes(emoji)) {
    return res.status(400).json({ error: 'Invalid drop: You can only drop valid emojis.' });
  }

  try {
    const hours = parseInt(duration_hours, 10) || 1; // Default to 1 hour
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
    
    // Ensure only one active pin per user
    const existingActiveDrops = await pool.query(
      `UPDATE emoji_drops SET is_active = FALSE WHERE user_id = $1 AND is_active = TRUE RETURNING id`,
      [req.user.id]
    );

    const result = await pool.query(
      `INSERT INTO emoji_drops (user_id, emoji, latitude, longitude, accuracy, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, emoji, latitude, longitude, accuracy || null, expiresAt]
    );

    const drop = result.rows[0];

    logger.info('Emoji dropped', {
      user_id: req.user.id,
      event_type: 'emoji_dropped',
      latitude,
      longitude,
      accuracy,
      data: { emoji, drop_id: drop.id },
    });

    // Broadcast deletions of old pins
    existingActiveDrops.rows.forEach(oldDrop => {
      const deletePayload = { type: 'emoji:deleted', data: { id: oldDrop.id } };
      activeConnections.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(deletePayload));
        }
      });
    });

    // Notify other users of new pin
    const payload = {
      type: 'emoji:new',
      data: {
        id: drop.id,
        user_id: drop.user_id,
        username: req.user.username,
        emoji: drop.emoji,
        latitude: drop.latitude,
        longitude: drop.longitude,
        created_at: drop.created_at,
      },
    };

    activeConnections.forEach((ws, connectionUserId) => {
      if (connectionUserId !== req.user.id.toString() && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    });

    res.json(drop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get emoji drops within radius
app.get('/api/emoji-drops', authenticateToken, async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const radius = parseFloat(req.query.radius) || 1000; // in meters

  try {
    let result;
    if (!isNaN(lat) && !isNaN(lon)) {
      // Calculate distance using Haversine formula in SQL
      result = await pool.query(
        `SELECT ed.*, u.username, u.avatar_url,
          (6371000 * acos(cos(radians($1)) * cos(radians(ed.latitude)) * cos(radians(ed.longitude) - radians($2)) + sin(radians($1)) * sin(radians(ed.latitude)))) AS distance
         FROM emoji_drops ed
         JOIN users u ON ed.user_id = u.id
         WHERE ed.is_active = TRUE AND (ed.expires_at IS NULL OR ed.expires_at > NOW())
         ORDER BY distance`,
        [lat, lon]
      );
      
      // Filter by radius
      const filtered = result.rows.filter(row => row.distance <= radius);
      res.json(filtered);
    } else {
      // Return all active drops if no lat/lon specified
      result = await pool.query(
        `SELECT ed.*, u.username, u.avatar_url
         FROM emoji_drops ed
         JOIN users u ON ed.user_id = u.id
         WHERE ed.is_active = TRUE AND (ed.expires_at IS NULL OR ed.expires_at > NOW())
         ORDER BY ed.created_at DESC`
      );
      res.json(result.rows);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete own emoji drop
app.delete('/api/emoji-drops/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const checkRes = await pool.query('SELECT * FROM emoji_drops WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Emoji drop not found' });
    }

    const drop = checkRes.rows[0];
    if (drop.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: You cannot delete another user\'s drop' });
    }

    await pool.query('UPDATE emoji_drops SET is_active = FALSE WHERE id = $1', [id]);

    logger.info('Emoji deleted', {
      user_id: req.user.id,
      event_type: 'emoji_deleted',
      data: { emoji_drop_id: id },
    });

    // Broadcast delete event
    const payload = { type: 'emoji:deleted', data: { id: parseInt(id) } };
    activeConnections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    });

    res.json({ message: 'Emoji drop deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- JOIN REQUESTS ---

// Request to join
app.post('/api/join-requests', authenticateToken, async (req, res) => {
  const { emoji_drop_id, message } = req.body;

  try {
    // Check if drop is active
    const dropRes = await pool.query(
      'SELECT user_id, emoji FROM emoji_drops WHERE id = $1 AND is_active = TRUE',
      [emoji_drop_id]
    );

    if (dropRes.rows.length === 0) {
      return res.status(404).json({ error: 'Active emoji drop not found' });
    }

    const targetUserId = dropRes.rows[0].user_id;

    if (targetUserId === req.user.id) {
      return res.status(400).json({ error: 'You cannot request to join your own emoji drop' });
    }

    const result = await pool.query(
      `INSERT INTO join_requests (requester_id, emoji_drop_id, message)
       VALUES ($1, $2, $3)
       ON CONFLICT (requester_id, emoji_drop_id) DO UPDATE SET message = EXCLUDED.message, status = 'pending'
       RETURNING *`,
      [req.user.id, emoji_drop_id, message]
    );

    const joinRequest = result.rows[0];

    logger.info('Join requested', {
      user_id: req.user.id,
      event_type: 'join_requested',
      data: { requester_id: req.user.id, emoji_drop_id, message },
    });

    // Notify owner
    sendToUser(targetUserId, {
      type: 'request:incoming',
      data: {
        id: joinRequest.id,
        requester_id: req.user.id,
        username: req.user.username,
        emoji: dropRes.rows[0].emoji,
        message,
        status: 'pending',
        owner_id: targetUserId,
      },
    });

    res.json(joinRequest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get incoming join requests
app.get('/api/join-requests/incoming', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT jr.*, u.username as requester_name, u.avatar_url as requester_avatar, ed.emoji, ed.user_id as owner_id
       FROM join_requests jr
       JOIN emoji_drops ed ON jr.emoji_drop_id = ed.id
       JOIN users u ON jr.requester_id = u.id
       WHERE ed.user_id = $1 AND ed.is_active = TRUE AND (ed.expires_at IS NULL OR ed.expires_at > NOW())
       ORDER BY jr.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get outgoing join requests
app.get('/api/join-requests/outgoing', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT jr.*, u.username as owner_name, u.avatar_url as owner_avatar, ed.emoji, ed.user_id as owner_id
       FROM join_requests jr
       JOIN emoji_drops ed ON jr.emoji_drop_id = ed.id
       JOIN users u ON ed.user_id = u.id
       WHERE jr.requester_id = $1 AND ed.is_active = TRUE AND (ed.expires_at IS NULL OR ed.expires_at > NOW())
       ORDER BY jr.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accept or reject join request
app.patch('/api/join-requests/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'accepted' | 'rejected'

  if (status !== 'accepted' && status !== 'rejected') {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const requestRes = await pool.query(
      `SELECT jr.*, ed.user_id as owner_id, ed.emoji, u.username as requester_name
       FROM join_requests jr
       JOIN emoji_drops ed ON jr.emoji_drop_id = ed.id
       JOIN users u ON jr.requester_id = u.id
       WHERE jr.id = $1`,
      [id]
    );

    if (requestRes.rows.length === 0) {
      return res.status(404).json({ error: 'Join request not found' });
    }

    const request = requestRes.rows[0];

    if (request.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await pool.query(
      `UPDATE join_requests SET status = $1, responded_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );

    const updatedRequest = result.rows[0];

    logger.info(status === 'accepted' ? 'Join accepted' : 'Join rejected', {
      user_id: req.user.id,
      event_type: status === 'accepted' ? 'join_accepted' : 'join_rejected',
      data: { accepter_id: req.user.id, requester_id: request.requester_id, join_request_id: id },
    });

    // Notify requester
    sendToUser(request.requester_id, {
      type: 'request:status_changed',
      data: {
        id: updatedRequest.id,
        status: updatedRequest.status,
        emoji: request.emoji,
        owner_name: req.user.username,
      },
    });

    // Trigger initial range check on accept
    if (status === 'accepted') {
      await performRangeCheck(request.requester_id, req.user.id);
    }

    res.json(updatedRequest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GEOLOCATION AND RANGE LOGIC ---

// Helper: Run range check between two users and alert them on transitions
const performRangeCheck = async (userId1, userId2) => {
  try {
    const locRes = await pool.query(
      'SELECT user_id, latitude, longitude, accuracy FROM user_locations WHERE user_id IN ($1, $2)',
      [userId1, userId2]
    );

    if (locRes.rows.length < 2) {
      // One or both users don't have location records yet
      return;
    }

    const loc1 = locRes.rows.find(l => l.user_id === userId1);
    const loc2 = locRes.rows.find(l => l.user_id === userId2);

    const distance = calculateDistance(loc1.latitude, loc1.longitude, loc2.latitude, loc2.longitude);
    const inRange = distance < 100;

    const stateKey = [userId1, userId2].sort().join('-');
    const wasInRange = rangeStates.get(stateKey);

    logger.info('Range check executed', {
      event_type: 'range_check',
      data: { user_id_1: userId1, user_id_2: userId2, distance_meters: distance, in_range: inRange }
    });

    if (wasInRange !== inRange) {
      rangeStates.set(stateKey, inRange);

      const eventType = inRange ? 'range_entered' : 'range_exited';
      logger.info(inRange ? 'Users entered range' : 'Users exited range', {
        event_type: eventType,
        data: { user_id_1: userId1, user_id_2: userId2, distance_meters: distance }
      });

      const payload = {
        type: 'range:status',
        data: {
          user1: userId1,
          user2: userId2,
          in_range: inRange,
          distance: Math.round(distance),
        }
      };

      sendToUser(userId1, payload);
      sendToUser(userId2, payload);
    }
  } catch (err) {
    console.error('Error during range check:', err);
  }
};

// Check range availability helper for API endpoints
const isCurrentlyInRange = async (userId1, userId2) => {
  try {
    const locRes = await pool.query(
      'SELECT user_id, latitude, longitude FROM user_locations WHERE user_id IN ($1, $2)',
      [userId1, userId2]
    );

    if (locRes.rows.length < 2) return false;

    const loc1 = locRes.rows.find(l => l.user_id === userId1);
    const loc2 = locRes.rows.find(l => l.user_id === userId2);

    const distance = calculateDistance(loc1.latitude, loc1.longitude, loc2.latitude, loc2.longitude);
    return distance < 100;
  } catch (err) {
    return false;
  }
};

// REST endpoint for Location Update
app.post('/api/location', authenticateToken, async (req, res) => {
  const { latitude, longitude, accuracy } = req.body;

  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'Missing coordinates' });
  }

  try {
    await pool.query(
      `INSERT INTO user_locations (user_id, latitude, longitude, accuracy, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE
       SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, accuracy = EXCLUDED.accuracy, updated_at = NOW()`,
      [req.user.id, latitude, longitude, accuracy || null]
    );

    logger.info('Location updated', {
      user_id: req.user.id,
      event_type: 'location_update',
      latitude,
      longitude,
      accuracy,
    });

    // Find all users with whom this user has an ACCEPTED request
    const connectionsRes = await pool.query(
      `SELECT jr.requester_id, jr.emoji_drop_id, ed.user_id as owner_id
       FROM join_requests jr
       JOIN emoji_drops ed ON jr.emoji_drop_id = ed.id
       WHERE (jr.requester_id = $1 OR ed.user_id = $1) AND jr.status = 'accepted'`,
      [req.user.id]
    );

    // Run range checks for all matches
    const promises = connectionsRes.rows.map(row => {
      const otherUser = row.requester_id === req.user.id ? row.owner_id : row.requester_id;
      return performRangeCheck(req.user.id, otherUser);
    });
    await Promise.all(promises);

    // Get current statuses to return to frontend
    const statuses = [];
    for (const row of connectionsRes.rows) {
      const otherUser = row.requester_id === req.user.id ? row.owner_id : row.requester_id;
      const stateKey = [req.user.id, otherUser].sort().join('-');
      const locRes = await pool.query('SELECT latitude, longitude FROM user_locations WHERE user_id = $1', [otherUser]);
      
      let distance = null;
      if (locRes.rows.length > 0) {
        distance = calculateDistance(latitude, longitude, locRes.rows[0].latitude, locRes.rows[0].longitude);
      }

      statuses.push({
        other_user_id: otherUser,
        in_range: rangeStates.get(stateKey) || false,
        distance: distance !== null ? Math.round(distance) : null
      });
    }

    res.json({ status: 'success', connections: statuses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CHAT ENDPOINTS ---

// Send Message
app.post('/api/chat', authenticateToken, async (req, res) => {
  const { join_request_id, message } = req.body;

  if (!join_request_id || !message) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    const jrRes = await pool.query(
      `SELECT jr.*, ed.user_id as owner_id
       FROM join_requests jr
       JOIN emoji_drops ed ON jr.emoji_drop_id = ed.id
       WHERE jr.id = $1`,
      [join_request_id]
    );

    if (jrRes.rows.length === 0) {
      return res.status(404).json({ error: 'Join request not found' });
    }

    const request = jrRes.rows[0];

    // Verify user is part of this request
    if (request.requester_id !== req.user.id && request.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: You are not authorized for this chat' });
    }

    if (request.status !== 'accepted') {
      return res.status(403).json({ error: 'Forbidden: Join request not accepted' });
    }

    // Verify distance is within range
    const otherUser = request.requester_id === req.user.id ? request.owner_id : request.requester_id;
    const inRange = await isCurrentlyInRange(req.user.id, otherUser);

    if (!inRange) {
      if (!isEmojiOnly(message)) {
        logger.info('Chat attempt blocked - text sent out of range', {
          user_id: req.user.id,
          event_type: 'chat_blocked',
          data: { other_user_id: otherUser, join_request_id, reason: 'text_out_of_range' }
        });
        return res.status(403).json({ error: 'Forbidden: You can only send emoji-only messages when out of range (100m).' });
      }
    }

    const msgRes = await pool.query(
      `INSERT INTO chat_messages (join_request_id, sender_id, message)
       VALUES ($1, $2, $3) RETURNING *`,
      [join_request_id, req.user.id, message]
    );

    const savedMsg = msgRes.rows[0];

    logger.info('Chat message sent', {
      user_id: req.user.id,
      event_type: 'chat_sent',
      data: { sender_id: req.user.id, receiver_id: otherUser, join_request_id, message_length: message.length }
    });

    const wsPayload = {
      type: 'chat:message',
      data: {
        id: savedMsg.id,
        join_request_id,
        sender_id: req.user.id,
        sender_name: req.user.username,
        message,
        created_at: savedMsg.created_at,
      }
    };

    // Send to both parties
    sendToUser(req.user.id, wsPayload);
    sendToUser(otherUser, wsPayload);

    res.json(savedMsg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch Chat History
app.get('/api/chat/:join_request_id', authenticateToken, async (req, res) => {
  const { join_request_id } = req.params;

  try {
    const jrRes = await pool.query(
      `SELECT jr.*, ed.user_id as owner_id
       FROM join_requests jr
       JOIN emoji_drops ed ON jr.emoji_drop_id = ed.id
       WHERE jr.id = $1`,
      [join_request_id]
    );

    if (jrRes.rows.length === 0) {
      return res.status(404).json({ error: 'Join request not found' });
    }

    const request = jrRes.rows[0];

    if (request.requester_id !== req.user.id && request.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (request.status !== 'accepted') {
      return res.status(403).json({ error: 'Forbidden: Join request not accepted' });
    }

    // Allow chat history retrieval regardless of distance as long as request is accepted

    const messagesRes = await pool.query(
      `SELECT cm.*, u.username as sender_name
       FROM chat_messages cm
       JOIN users u ON cm.sender_id = u.id
       WHERE cm.join_request_id = $1
       ORDER BY cm.created_at ASC`,
      [join_request_id]
    );

    res.json(messagesRes.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ADMIN / MONITORING ENDPOINTS ---

// Fetch Logs
app.get('/api/admin/logs', authenticateToken, async (req, res) => {
  const eventType = req.query.event_type;
  const limit = parseInt(req.query.limit) || 100;

  try {
    let result;
    if (eventType) {
      result = await pool.query(
        'SELECT l.*, u.username FROM logs l LEFT JOIN users u ON l.user_id = u.id WHERE l.event_type = $1 ORDER BY l.created_at DESC LIMIT $2',
        [eventType, limit]
      );
    } else {
      result = await pool.query(
        'SELECT l.*, u.username FROM logs l LEFT JOIN users u ON l.user_id = u.id ORDER BY l.created_at DESC LIMIT $1',
        [limit]
      );
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get stats
app.get('/api/admin/stats', authenticateToken, async (req, res) => {
  try {
    const activeUsersRes = await pool.query(
      "SELECT COUNT(DISTINCT user_id) as count FROM logs WHERE created_at > now() - interval '5 minutes'"
    );
    const totalDropsRes = await pool.query(
      "SELECT COUNT(*) as count FROM emoji_drops WHERE is_active = TRUE"
    );
    const requestsRes = await pool.query(
      "SELECT status, COUNT(*) as count FROM join_requests GROUP BY status"
    );

    res.json({
      active_users_5m: parseInt(activeUsersRes.rows[0].count),
      total_active_drops: parseInt(totalDropsRes.rows[0].count),
      join_requests: requestsRes.rows.reduce((acc, row) => {
        acc[row.status] = parseInt(row.count);
        return acc;
      }, {}),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- WEBSOCKET HANDLERS & CONNECTION UPGRADE ---

server.on('upgrade', (request, socket, head) => {
  console.log('[WebSocket Upgrade] Request URL:', request.url);
  const parsedUrl = new URL(request.url, 'http://localhost');
  const token = parsedUrl.searchParams.get('token');

  if (!token) {
    console.log('[WebSocket Upgrade] No token provided, rejecting.');
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      console.log('[WebSocket Upgrade] JWT verification failed:', err.message);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    console.log(`[WebSocket Upgrade] Token valid for user ${decoded.id}. Handling upgrade...`);
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.user = decoded;
      wss.emit('connection', ws, request);
    });
  });
});

wss.on('connection', (ws) => {
  const userId = ws.user.id;
  activeConnections.set(userId.toString(), ws);

  console.log(`[WebSocket] Connected: User ${userId} (${ws.user.username})`);

  ws.on('message', async (messageStr) => {
    try {
      const message = JSON.parse(messageStr);
      const { type, data } = message;

      if (type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      if (type === 'location:update') {
        const { latitude, longitude, accuracy } = data;
        
        // Simulating the REST flow for websocket location updates
        await pool.query(
          `INSERT INTO user_locations (user_id, latitude, longitude, accuracy, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (user_id) DO UPDATE
           SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, accuracy = EXCLUDED.accuracy, updated_at = NOW()`,
          [userId, latitude, longitude, accuracy || null]
        );

        logger.info('Location updated via WebSocket', {
          user_id: userId,
          event_type: 'location_update',
          latitude,
          longitude,
          accuracy,
        });

        // Update active drop location so the pin follows the user
        const dropUpdateRes = await pool.query(
          `UPDATE emoji_drops
           SET latitude = $1, longitude = $2, accuracy = $3
           WHERE user_id = $4 AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())
           RETURNING id`,
          [latitude, longitude, accuracy || null, userId]
        );

        if (dropUpdateRes.rows.length > 0) {
          const updatedDropId = dropUpdateRes.rows[0].id;
          const movePayload = {
            type: 'emoji:moved',
            data: { id: updatedDropId, latitude, longitude }
          };
          activeConnections.forEach((connWs, connectionUserId) => {
            if (connectionUserId !== userId.toString() && connWs.readyState === WebSocket.OPEN) {
              connWs.send(JSON.stringify(movePayload));
            }
          });
        }

        // Find matches and perform range checks
        const connectionsRes = await pool.query(
          `SELECT jr.requester_id, ed.user_id as owner_id
           FROM join_requests jr
           JOIN emoji_drops ed ON jr.emoji_drop_id = ed.id
           WHERE (jr.requester_id = $1 OR ed.user_id = $1) AND jr.status = 'accepted'`,
          [userId]
        );

        const promises = connectionsRes.rows.map(row => {
          const otherUser = row.requester_id === userId ? row.owner_id : row.requester_id;
          return performRangeCheck(userId, otherUser);
        });
        await Promise.all(promises);
      }

      if (type === 'chat:send') {
        const { join_request_id, message: chatMsg } = data;

        const jrRes = await pool.query(
          `SELECT jr.*, ed.user_id as owner_id
           FROM join_requests jr
           JOIN emoji_drops ed ON jr.emoji_drop_id = ed.id
           WHERE jr.id = $1`,
          [join_request_id]
        );

        if (jrRes.rows.length > 0) {
          const request = jrRes.rows[0];
          if (request.status === 'accepted' && (request.requester_id === userId || request.owner_id === userId)) {
            const otherUser = request.requester_id === userId ? request.owner_id : request.requester_id;
            const inRange = await isCurrentlyInRange(userId, otherUser);

            if (inRange || isEmojiOnly(chatMsg)) {
              const msgRes = await pool.query(
                `INSERT INTO chat_messages (join_request_id, sender_id, message)
                 VALUES ($1, $2, $3) RETURNING *`,
                [join_request_id, userId, chatMsg]
              );
              
              const saved = msgRes.rows[0];
              
              logger.info(inRange ? 'Chat message sent via WS' : 'Emoji chat message sent via WS (out of range)', {
                user_id: userId,
                event_type: 'chat_sent',
                data: { sender_id: userId, receiver_id: otherUser, join_request_id, message_length: chatMsg.length, out_of_range: !inRange }
              });

              const payload = {
                type: 'chat:message',
                data: {
                  id: saved.id,
                  join_request_id,
                  sender_id: userId,
                  sender_name: ws.user.username,
                  message: chatMsg,
                  created_at: saved.created_at
                }
              };

              sendToUser(userId, payload);
              sendToUser(otherUser, payload);
            } else {
              logger.info('WS Chat blocked out of range - text sent', {
                user_id: userId,
                event_type: 'chat_blocked',
                data: { other_user_id: otherUser, join_request_id, reason: 'text_out_of_range' }
              });
              ws.send(JSON.stringify({ type: 'error', data: { message: 'Cannot send text: Out of range. Emojis only.' } }));
            }
          }
        }
      }
    } catch (err) {
      console.error('[WebSocket] Message parsing error:', err.message);
    }
  });

  ws.on('close', () => {
    activeConnections.delete(userId.toString());
    activeConnections.delete(parseInt(userId, 10));
    console.log(`[WebSocket] Disconnected: User ${userId}`);
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`[Server] Emoji Location Chat Backend listening on port ${PORT}`);
});
