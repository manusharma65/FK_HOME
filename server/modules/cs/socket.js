'use strict';

const cookie = require('cookie');
const { db } = require('../../db');

const SESSION_COOKIE = 'fk_session';

function initCsSocket(io) {
  io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.headers.cookie || '';
      const parsed = cookie.parse(raw);
      const token = parsed[SESSION_COOKIE] || socket.handshake.auth?.token;
      if (!token) return next(new Error('Unauthorized'));

      const r = await db.query(
        `SELECT s.user_id, u.full_name, u.display_name, u.email
         FROM user_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = $1 AND s.expires_at > NOW() AND u.deleted_at IS NULL`,
        [token]
      );
      if (!r.rows.length) return next(new Error('Unauthorized'));

      const row = r.rows[0];
      socket.user = {
        id: row.user_id,
        name: row.display_name || row.full_name,
        email: row.email,
      };
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on('connection', (socket) => {
    const uid = socket.user.id;
    socket.join(`user:${uid}`);
    socket.join('cs:agents');

    socket.on('cs:join-ticket', (ticketId) => {
      if (ticketId) socket.join(`ticket:${ticketId}`);
    });

    socket.on('cs:leave-ticket', (ticketId) => {
      if (ticketId) socket.leave(`ticket:${ticketId}`);
    });

    socket.on('cs:typing', ({ ticketId, typing }) => {
      if (!ticketId) return;
      socket.to(`ticket:${ticketId}`).emit('cs:typing', {
        ticketId,
        userId: uid,
        userName: socket.user.name,
        typing: !!typing,
      });
    });

    socket.on('cs:seen', ({ ticketId, messageId }) => {
      if (!ticketId) return;
      socket.to(`ticket:${ticketId}`).emit('cs:seen', {
        ticketId, messageId, userId: uid, userName: socket.user.name,
      });
    });

    socket.on('cs:presence', async ({ ticketId, status }) => {
      if (!ticketId) return;
      try {
        await db.query(
          `INSERT INTO cs_ticket_presence (ticket_id, user_id, status, last_seen_at)
           VALUES ($1,$2,$3,NOW())
           ON CONFLICT (ticket_id, user_id) DO UPDATE SET status = $3, last_seen_at = NOW()`,
          [ticketId, uid, status || 'viewing']
        );
        io.to(`ticket:${ticketId}`).emit('cs:presence', {
          ticketId,
          userId: uid,
          userName: socket.user.name,
          status: status || 'viewing',
        });
      } catch (e) { /* ignore */ }
    });

    socket.on('disconnect', () => {
      // cleanup handled by last_seen_at expiry on client
    });
  });

  return {
    emitToTicket(ticketId, event, data) {
      io.to(`ticket:${ticketId}`).emit(event, data);
    },
    emitToUser(userId, event, data) {
      io.to(`user:${userId}`).emit(event, data);
    },
    emitDashboard(event, data) {
      io.to('cs:agents').emit(event, data);
    },
  };
}

module.exports = { initCsSocket };
