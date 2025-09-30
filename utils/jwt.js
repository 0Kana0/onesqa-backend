const jwt = require('jsonwebtoken')
require('dotenv').config()

const ACCESS_TOKEN_SECRET = process.env.ACCESS_JWT_SECRET; // ควรเก็บใน .env
const REFRESH_TOKEN_SECRET = process.env.REFRESH_JWT_SECRET; // ควรเก็บใน .env

exports.generateAccessToken = (payload) => {
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, { expiresIn: '15m' }); // อายุสั้น
};

exports.generateRefreshToken = (payload) => {
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, { expiresIn: '7d' }); // อายุยาว
};

exports.verifyAccessToken = (token) => {
  return jwt.verify(token, ACCESS_TOKEN_SECRET);
};

exports.verifyRefreshToken = (token) => {
  return jwt.verify(token, REFRESH_TOKEN_SECRET);
};