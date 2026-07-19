const winston = require('winston');
const pool = require('./db');

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new (class PostgresTransport extends winston.Transport {
      async log(info, callback) {
        setImmediate(() => this.emit('logged', info));

        const { user_id, event_type, data, latitude, longitude, accuracy } = info;
        const evType = event_type || 'system_log';

        try {
          await pool.query(
            `INSERT INTO logs (user_id, event_type, data, latitude, longitude, accuracy, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [
              user_id ? parseInt(user_id, 10) : null,
              evType,
              data ? JSON.stringify(data) : null,
              latitude ? parseFloat(latitude) : null,
              longitude ? parseFloat(longitude) : null,
              accuracy ? parseInt(accuracy, 10) : null
            ]
          );
        } catch (err) {
          console.error('[PostgresTransport] Log insert failed:', err.message);
        }

        callback();
      }
    })()
  ]
});

module.exports = logger;
