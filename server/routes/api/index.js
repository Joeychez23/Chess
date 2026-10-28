/*
 *  index.js  --  chess server
 *	Api Routes
 *	/api/auth (sign in & sessions), /api/user (the signed in player) & /api/chess (games)
 *
 */

const router = require('express').Router()
const authRoutes = require('./authRoutes.js')
const userRoutes = require('./userRoutes.js')
const chessRoutes = require('./chessRoutes.js')


router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/chess', chessRoutes);


module.exports = router;
