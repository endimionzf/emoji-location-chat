import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

// Recenter helper component
function RecenterMap({ location }) {
  const map = useMap();
  useEffect(() => {
    if (location) {
      map.panTo([location.lat, location.lng]);
    }
  }, [location, map]);
  return null;
}

// Invalidate map size when viewport/container changes (mobile orientation, tab switch)
function MapResizeHandler() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const invalidate = () => {
      map.invalidateSize({ animate: false });
    };
    invalidate();
    const ro = new ResizeObserver(invalidate);
    ro.observe(container);
    window.addEventListener('orientationchange', invalidate);
    window.visualViewport?.addEventListener('resize', invalidate);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', invalidate);
      window.visualViewport?.removeEventListener('resize', invalidate);
    };
  }, [map]);
  return null;
}

export default function MapView({ myLocation, emojiDrops, userId, onDropSelect, onDeleteDrop, acceptedRequests = [], onChatSelect }) {
  // Center defaults to London or coordinates if myLocation is null
  const defaultCenter = myLocation ? [myLocation.lat, myLocation.lng] : [51.505, -0.09];

  // Helper to create custom HTML DivIcon for drops
  const createEmojiIcon = (emoji, avatar) => {
    return L.divIcon({
      html: `
        <div class="emoji-marker-pin" style="background: var(--secondary);">
          <div class="emoji-marker-inner">${emoji}</div>
          <div class="emoji-marker-avatar">${avatar || '🦊'}</div>
        </div>
      `,
      className: 'custom-emoji-marker',
      iconSize: [44, 44],
      iconAnchor: [22, 44],
      popupAnchor: [0, -40]
    });
  };

  // Helper to create custom HTML DivIcon for self
  const createSelfIcon = () => {
    return L.divIcon({
      html: `
        <div class="emoji-marker-pin" style="background: var(--primary);">
          <div class="emoji-marker-inner" style="font-size: 1.3rem;">📍</div>
        </div>
      `,
      className: 'custom-emoji-marker',
      iconSize: [44, 44],
      iconAnchor: [22, 44],
      popupAnchor: [0, -40]
    });
  };

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <MapContainer
        center={defaultCenter}
        zoom={15}
        zoomControl={true}
        style={{ width: '100%', height: '100%' }}
      >
        {/* CartoDB Dark Matter tile layer for premium dark aesthetics */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        {/* Current user's location marker */}
        {myLocation && (
          <Marker position={[myLocation.lat, myLocation.lng]} icon={createSelfIcon()}>
            <Popup>
              <div style={{ color: 'var(--bg-primary)', padding: '4px' }}>
                <strong>You are here</strong>
              </div>
            </Popup>
          </Marker>
        )}

        {/* Render emoji drops */}
        {emojiDrops.map((drop) => {
          const acceptedRequest = acceptedRequests.find(
            (r) => parseInt(r.emoji_drop_id, 10) === parseInt(drop.id, 10)
          );

          return (
            <Marker
              key={drop.id}
              position={[drop.latitude, drop.longitude]}
              icon={createEmojiIcon(drop.emoji, drop.avatar_url)}
            >
              <Popup>
                <div style={{ color: '#000', padding: '6px' }}>
                  <div style={{ fontSize: '1rem', marginBottom: 4 }}>
                    <strong>{drop.username}</strong> dropped <strong>{drop.emoji}</strong>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: 8 }}>
                    Accuracy: ±{drop.accuracy || 'unknown'}m
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {drop.user_id === userId ? (
                      <button
                        className="btn-sm btn-reject"
                        style={{ padding: '4px 8px', fontSize: '0.75rem', width: 'auto' }}
                        onClick={() => onDeleteDrop(drop.id)}
                      >
                        Delete Drop
                      </button>
                    ) : acceptedRequest ? (
                      <button
                        className="btn-sm btn-accept"
                        style={{
                          padding: '4px 8px',
                          fontSize: '0.75rem',
                          width: 'auto',
                          backgroundColor: 'var(--success)',
                          borderColor: 'var(--success)',
                        }}
                        onClick={() => {
                          if (onChatSelect) onChatSelect(acceptedRequest);
                        }}
                      >
                        Chat
                      </button>
                    ) : (
                      <button
                        className="btn-sm btn-accept"
                        style={{ padding: '4px 8px', fontSize: '0.75rem', width: 'auto' }}
                        onClick={() => onDropSelect(drop)}
                      >
                        Request to Join
                      </button>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {myLocation && <RecenterMap location={myLocation} />}
        <MapResizeHandler />
      </MapContainer>
    </div>
  );
}
