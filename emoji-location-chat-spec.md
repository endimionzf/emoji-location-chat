# Emoji Location Chat App – Technical Specification

## Project Overview

A real-time, invite-only location-based social app where users:
1. Drop emoji reactions at geographic locations with their avatar
2. Other users tap emoji → send join request (text)
3. Original poster accepts/rejects
4. Once accepted AND both users within range (~50m), unlock text chat
5. Full observability: logs, dashboards, real-time monitoring

**Stack**: Docker-deployed, self-hosted. PostgreSQL + Node.js backend + React frontend.

---

## Architecture

### Services (Docker Compose)

```
emoji-chat/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── src/
│   │   ├── server.js
│   │   ├── db.js
│   │   ├── routes/
│   │   ├── websocket.js
│   │   └── logging.js
│   └── package.json
├── frontend/
│   ├── Dockerfile
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   ├── components/
│   │   └── services/
│   └── package.json
├── postgres/
│   ├── Dockerfile
│   └── init.sql
├── grafana/
│   ├── Dockerfile
│   └── provisioning/
└── nginx/
    └── nginx.conf
```

**Services:**
- **Backend** (Node.js): API, WebSocket, range calculations, logging
- **Frontend** (React): Vite, geolocation, map, UI
- **PostgreSQL**: Data + structured logs table
- **Grafana** (optional): Real-time dashboards
- **Nginx**: Reverse proxy, static file serving

---

## Database Schema

### Core Tables

```sql
-- Users
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  avatar_url TEXT,
  invite_code VARCHAR(20) UNIQUE,
  created_at TIMESTAMP DEFAULT NOW(),
  last_seen TIMESTAMP
);

-- Emoji drops (reactions at locations)
CREATE TABLE emoji_drops (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  emoji VARCHAR(10) NOT NULL,
  latitude FLOAT NOT NULL,
  longitude FLOAT NOT NULL,
  accuracy INT, -- GPS accuracy in meters
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP, -- Optional: auto-expire after X hours
  is_active BOOLEAN DEFAULT TRUE
);

-- Join requests
CREATE TABLE join_requests (
  id BIGSERIAL PRIMARY KEY,
  requester_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  emoji_drop_id BIGINT REFERENCES emoji_drops(id) ON DELETE CASCADE,
  message TEXT,
  status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, rejected
  created_at TIMESTAMP DEFAULT NOW(),
  responded_at TIMESTAMP,
  UNIQUE(requester_id, emoji_drop_id)
);

-- Chat messages (only between matched users in range)
CREATE TABLE chat_messages (
  id BIGSERIAL PRIMARY KEY,
  join_request_id BIGINT REFERENCES join_requests(id) ON DELETE CASCADE,
  sender_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- User locations (for range checks)
CREATE TABLE user_locations (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  latitude FLOAT NOT NULL,
  longitude FLOAT NOT NULL,
  accuracy INT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Structured logs (all events)
CREATE TABLE logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,
  data JSONB,
  latitude FLOAT,
  longitude FLOAT,
  accuracy INT,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_event_type (event_type),
  INDEX idx_user_id (user_id),
  INDEX idx_created_at (created_at)
);

-- Invites (for access control)
CREATE TABLE invites (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  created_by BIGINT REFERENCES users(id),
  used_by BIGINT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  used_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE
);
```

---

## API Endpoints

### Authentication
- `POST /auth/invite/:code` – Signup with invite code
- `POST /auth/logout` – Logout (invalidate session)

### Emoji Drops
- `POST /emoji-drops` – Create emoji at location
  - Body: `{ emoji, latitude, longitude, accuracy }`
  - Returns: `{ id, emoji, latitude, longitude, createdAt }`
- `GET /emoji-drops?lat=X&lon=Y&radius=500` – Fetch emoji within radius
- `DELETE /emoji-drops/:id` – Delete own emoji

### Join Requests
- `POST /join-requests` – Request to join
  - Body: `{ emoji_drop_id, message }`
- `GET /join-requests/incoming` – Get requests to you
- `GET /join-requests/outgoing` – Get your requests
- `PATCH /join-requests/:id` – Accept/reject
  - Body: `{ status: 'accepted' | 'rejected' }`

### Chat
- `POST /chat` – Send message (only if accepted + in range)
  - Body: `{ join_request_id, message }`
- `GET /chat/:join_request_id` – Get chat history (only if in range)

### Location
- `POST /location` – Report current location (called frequently from frontend)
  - Body: `{ latitude, longitude, accuracy }`
  - Used for range checks

### Admin/Monitoring
- `GET /admin/logs?event_type=X&limit=100` – Fetch logs (auth required)
- `GET /admin/stats` – Active users, emoji drops, requests stats

---

## WebSocket Events (Real-time)

### Server → Client
- `emoji:new` – New emoji dropped nearby
- `emoji:deleted` – Emoji deleted
- `request:incoming` – Someone requested to join your emoji
- `request:status_changed` – Your request was accepted/rejected
- `chat:message` – New message in conversation (if in range)
- `range:status` – You entered/exited range with someone

### Client → Server
- `location:update` – Send GPS coordinates
- `emoji:create` – Drop emoji
- `request:send` – Send join request
- `request:respond` – Accept/reject join request
- `chat:send` – Send message
- `ping` – Heartbeat (keep connection alive)

---

## Range Logic

**On each location update:**

1. User sends `location:update` with lat/lon
2. Server stores in `user_locations`
3. Server calculates distance to all accepted join requests involving this user:
   ```
   distance = haversine(user1.lat, user1.lon, user2.lat, user2.lon)
   in_range = distance < 50 meters
   ```
4. If status changed (entered/exited range), emit `range:status` WebSocket event
5. **Only allow chat if**: join request accepted AND both users in range
6. Log all range calculations to `logs` table (event_type: `range_check`, `range_entered`, `range_exited`)

---

## Logging Strategy

### Events to Log

Every significant event goes to the `logs` table with `event_type`:

| Event Type | Trigger | Data Logged |
|-----------|---------|-------------|
| `user_signup` | New user invited | user_id, invite_code |
| `emoji_dropped` | User creates emoji | user_id, emoji, lat, lon, accuracy |
| `emoji_deleted` | User deletes emoji | user_id, emoji_drop_id |
| `join_requested` | User requests to join | requester_id, emoji_drop_id, message |
| `join_accepted` | Original poster accepts | accepter_id, requester_id, join_request_id |
| `join_rejected` | Original poster rejects | rejecter_id, requester_id, join_request_id |
| `location_update` | User reports GPS | user_id, lat, lon, accuracy |
| `range_check` | Range calculation | user_id, other_user_id, distance_meters, in_range |
| `range_entered` | Both users now close | user_id, other_user_id |
| `range_exited` | Users moved apart | user_id, other_user_id |
| `chat_sent` | Message sent (in range) | sender_id, receiver_id, join_request_id, message_length |
| `chat_blocked` | Attempt to chat out of range | sender_id, other_user_id, distance_meters, reason |
| `error` | Any error | error_type, error_message, user_id (if applicable) |

### Query Examples

```sql
-- Active users in last 5 minutes
SELECT DISTINCT user_id FROM logs 
WHERE created_at > now() - interval '5 minutes' 
AND event_type IN ('location_update', 'emoji_dropped', 'chat_sent');

-- Most popular emoji
SELECT emoji, COUNT(*) as count FROM emoji_drops 
WHERE created_at > now() - interval '24 hours' 
GROUP BY emoji ORDER BY count DESC LIMIT 10;

-- Users with most join requests (potential abuse)
SELECT requester_id, COUNT(*) as requests FROM join_requests 
WHERE created_at > now() - interval '24 hours' 
GROUP BY requester_id HAVING COUNT(*) > 20;

-- Chat activity by hour
SELECT DATE_TRUNC('hour', created_at) as hour, COUNT(*) as messages 
FROM logs WHERE event_type = 'chat_sent' 
AND created_at > now() - interval '7 days'
GROUP BY hour ORDER BY hour DESC;

-- Range check success rate (how often are users actually in range when they try to chat)
SELECT 
  (SELECT COUNT(*) FROM logs WHERE event_type = 'range_entered') as times_in_range,
  (SELECT COUNT(*) FROM logs WHERE event_type = 'chat_blocked' AND reason = 'out_of_range') as chat_blocked
;
```

---

## Monitoring & Dashboards (Grafana)

### Key Metrics

1. **Real-time Map** – Active users + emoji locations
2. **User Stats** – Active users (5m, 1h, 24h), signup trend
3. **Interaction Volume** – Emoji drops/hour, join requests/hour, chats/hour
4. **Range Effectiveness** – % of time matched users are in range
5. **GPS Accuracy** – Distribution of accuracy values reported
6. **Error Rates** – Failed range checks, chat errors, API errors
7. **Abuse Signals** – Users with high reject rates, rapid-fire requests

### Grafana Setup

- **Data source**: PostgreSQL
- **Dashboards**: Pre-built panels querying `logs` + other tables
- **Alerts**: Spike in errors, offline for >10min, abuse patterns

---

## Frontend (React + Vite)

### Key Components

- **MapView** – Leaflet map showing emoji drops + user location
- **EmojiPicker** – Drop emoji at current location
- **RequestList** – Incoming/outgoing join requests
- **ChatPanel** – Text chat (only if in range + accepted)
- **Avatar** – User profile + settings

### Geolocation Implementation

```javascript
// Start watching position
navigator.geolocation.watchPosition(
  (position) => {
    const { latitude, longitude, accuracy } = position.coords;
    // Send to backend
    apiClient.updateLocation({ latitude, longitude, accuracy });
  },
  (error) => logError('Geolocation failed', error),
  { enableHighAccuracy: false, timeout: 5000, maximumAge: 0 }
);
```

### WebSocket Connection

```javascript
const ws = new WebSocket('ws://localhost/ws');
ws.addEventListener('message', (event) => {
  const { type, data } = JSON.parse(event.data);
  
  if (type === 'emoji:new') updateMapWithEmoji(data);
  if (type === 'request:incoming') showNotification(data);
  if (type === 'range:status') updateChatAvailability(data);
});
```

---

## Docker Deployment

### docker-compose.yml Structure

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: emoji_chat
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      timeout: 5s
      retries: 5

  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgresql://app:${DB_PASSWORD}@postgres:5432/emoji_chat
      NODE_ENV: production
      JWT_SECRET: ${JWT_SECRET}
      PORT: 3000
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./backend/src:/app/src
    restart: unless-stopped

  frontend:
    build: ./frontend
    ports:
      - "3001:3000"
    environment:
      VITE_API_URL: http://localhost:3000
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD}
    ports:
      - "3002:3000"
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning
    depends_on:
      - postgres
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - backend
      - frontend
    restart: unless-stopped

volumes:
  postgres_data:
  grafana_data:
```

### .env File

```
DB_PASSWORD=secure_password_here
JWT_SECRET=another_secure_secret
GRAFANA_PASSWORD=grafana_admin_password
```

### Startup Commands

```bash
# Build all services
docker-compose build

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f backend
docker-compose logs -f postgres

# Exec into backend for debugging
docker exec -it emoji-chat-backend-1 sh

# Access Grafana
# http://localhost:3002 (admin / grafana_admin_password)
```

---

## Logging Implementation (Backend)

### Winston Logger Config

```javascript
// logging.js
const winston = require('winston');
const pool = require('./db');

const logger = winston.createLogger({
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    // Custom transport: write to PostgreSQL
    new (class PostgresTransport extends winston.Transport {
      async log(info, callback) {
        const { level, message, user_id, event_type, data, latitude, longitude, accuracy } = info;
        try {
          await pool.query(
            `INSERT INTO logs (user_id, event_type, data, latitude, longitude, accuracy, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [user_id, event_type, JSON.stringify(data || {}), latitude, longitude, accuracy]
          );
        } catch (err) {
          console.error('Failed to log to database:', err);
        }
        callback();
      }
    })()
  ]
});

module.exports = logger;
```

### Usage

```javascript
// In route handlers
logger.info('', {
  event_type: 'emoji_dropped',
  user_id: req.user.id,
  data: { emoji, created_at: new Date() },
  latitude: req.body.latitude,
  longitude: req.body.longitude,
  accuracy: req.body.accuracy
});
```

---

## Development Workflow

### First Deploy
1. Clone repo, create `.env`
2. `docker-compose build && docker-compose up -d`
3. Check `docker-compose logs postgres` for successful init
4. Test backend: `curl http://localhost:3000/health`
5. Access frontend: `http://localhost:3001`
6. Monitor in Grafana: `http://localhost:3002`

### Debugging
- Backend errors: `docker logs emoji-chat-backend-1 -f`
- Database queries: Connect to postgres via any DB client on `localhost:5432`
- Logs table: `SELECT * FROM logs ORDER BY created_at DESC LIMIT 20;`

### Adding Features
- Update schema in `postgres/init.sql`
- Add new event types to logging.js
- Add Grafana panels for new metrics
- Redeploy: `docker-compose up -d --build`

---

## Security Considerations

1. **Invites**: Generate secure random codes, mark used, expire unused after X days
2. **Rate Limiting**: Limit join requests per user per hour (redis or in-memory)
3. **Chat Range Enforcement**: Always verify range server-side before storing/broadcasting chat
4. **GPS Spoofing**: Log accuracy; flag users consistently reporting impossible movements
5. **Moderation**: Allow users to report/block others; store reports in logs
6. **HTTPS**: Use self-signed cert for local, real cert in production
7. **CORS**: Restrict to your domain
8. **Auth**: Use JWT tokens, refresh tokens, secure cookies

---

## Performance Notes

- **WebSocket**: Connection pooling, heartbeats every 30s
- **GPS Updates**: Client sends every 10s; server batches every 5s for range checks
- **Emoji Queries**: Geo-indexed queries (PostGIS optional for sub-10m queries)
- **Log Retention**: Archive logs older than 90 days to separate table

---

## Deliverables for Agent

Build the following with this spec:

1. **Docker setup**: compose.yml, Dockerfile for each service, .env template
2. **Database**: init.sql with all tables, indexes, sample data
3. **Backend**: Node.js server with all endpoints, WebSocket, logging, range logic
4. **Frontend**: React app with map, emoji picker, request flow, chat UI
5. **Monitoring**: Grafana dashboards pre-configured
6. **Documentation**: README with deployment, testing, admin queries

**Priorities**: Logging first (every event), then range logic, then UI polish.
