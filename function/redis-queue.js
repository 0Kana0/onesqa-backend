// lib/redis-queue.js
const { Redis } = require('ioredis');

const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null, // ⭐ จำเป็นมาก
});

module.exports = connection;
