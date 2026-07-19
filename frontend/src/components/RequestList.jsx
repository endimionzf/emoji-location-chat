import React from 'react';
import { UserCheck, UserX, Clock, MapPin } from 'lucide-react';

export default function RequestList({ incoming, outgoing, onResponse }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Incoming Requests Section */}
      <div>
        <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <UserCheck size={18} style={{ color: 'var(--primary)' }} /> Incoming Requests
        </h3>
        {incoming.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: 12, textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)' }}>
            No pending requests from other users.
          </div>
        ) : (
          incoming.map((req) => (
            <div key={req.id} className="request-card">
              <div className="request-card-header">
                <div className="requester-info">
                  <div className="user-avatar-circle" style={{ width: 32, height: 32, fontSize: '1.2rem', border: '1px solid var(--secondary)' }}>
                    {req.requester_avatar || '🦊'}
                  </div>
                  <div>
                    <strong style={{ fontSize: '0.95rem' }}>{req.requester_name}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Wants to join your drop: {req.emoji}
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="request-message">
                "{req.message}"
              </div>
              
              <div className="request-actions">
                <button
                  className="btn-sm btn-accept"
                  onClick={() => onResponse(req.id, 'accepted')}
                >
                  Accept
                </button>
                <button
                  className="btn-sm btn-reject"
                  onClick={() => onResponse(req.id, 'rejected')}
                >
                  Reject
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Outgoing Requests Section */}
      <div>
        <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={18} style={{ color: 'var(--secondary)' }} /> Outgoing Requests
        </h3>
        {outgoing.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: 12, textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)' }}>
            You haven't requested to join anyone yet.
          </div>
        ) : (
          outgoing.map((req) => (
            <div key={req.id} className="request-card">
              <div className="request-card-header">
                <div className="requester-info">
                  <span style={{ fontSize: '1.5rem', marginRight: 6 }}>📍</span>
                  <div>
                    <strong style={{ fontSize: '0.95rem' }}>{req.owner_name}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Requested drop: {req.emoji}
                    </div>
                  </div>
                </div>
                <span className={`status-pill ${req.status}`}>
                  {req.status}
                </span>
              </div>
              
              {req.message && (
                <div className="request-message" style={{ borderLeft: '2px solid var(--border-color)', paddingLeft: 8, fontStyle: 'italic' }}>
                  "{req.message}"
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
