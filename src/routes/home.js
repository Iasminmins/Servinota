const express = require('express');

const router = express.Router();

router.get('/', (req, res, next) => {
  if (req.session.user) return next();
  res.redirect('/produto');
});

module.exports = router;
