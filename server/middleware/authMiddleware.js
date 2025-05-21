const jwt = require('jsonwebtoken');

const protect = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, no token provided',
      });
    }

    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      userId: decoded.userId || decoded.id,
      role: decoded.role,
      name: decoded.name,
      email: decoded.email,
    };

    next();
  } catch (err) {
    console.error('JWT Error:', err.message);

    let message = 'Not authorized, token failed';
    if (err.name === 'TokenExpiredError') {
      message = 'Token expired';
    } else if (err.name === 'JsonWebTokenError') {
      message = 'Invalid token';
    }

    return res.status(401).json({ success: false, message });
  }
};

module.exports = { protect };
