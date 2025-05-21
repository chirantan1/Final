const jwt = require('jsonwebtoken');

const protect = async (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, no token provided'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    req.user = {
      userId: decoded.userId,  // make sure this matches your JWT payload key
      role: decoded.role,
      name: decoded.name,
      email: decoded.email
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

    return res.status(401).json({
      success: false,
      message,
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

module.exports = protect;
