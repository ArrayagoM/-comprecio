const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'comprecio_secret_2026';

function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No autorizado' });
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, SECRET);
    if (req.user.blocked) return res.status(403).json({ error: 'Tu cuenta está bloqueada' });
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

function authOptional(req, res, next) {
  const header = req.headers.authorization;
  if (header) {
    try {
      req.user = jwt.verify(header.split(' ')[1], SECRET);
    } catch {}
  }
  next();
}

module.exports = { authRequired, authOptional, SECRET };
