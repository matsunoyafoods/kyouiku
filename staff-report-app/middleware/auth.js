const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: '認証が必要です' });
  }

  try {
    const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: 'トークンが無効または期限切れです' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    return res.status(403).json({ error: '権限がありません' });
  }
  next();
}

module.exports = { authMiddleware, adminMiddleware };
