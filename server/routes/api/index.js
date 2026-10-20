const router = require('express').Router()
const authRoutes = require('./authRoutes.js')
const userRoutes = require('./userRoutes.js')


router.use('/auth', authRoutes);
router.use('/user', userRoutes);


module.exports = router;
