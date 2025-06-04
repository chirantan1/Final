const express = require('express');
const router = express.Router();

// Example admin route
router.get('/', (req, res) => {
  res.json({ success: true, message: 'Admin route' });
});

module.exports = router;
