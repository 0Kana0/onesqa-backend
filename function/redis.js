// lib/redis.js
const { createClient } = require('redis');

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

(async () => {
  await redisClient.connect(); // connect ตอนโหลดไฟล์
})();

module.exports = redisClient;
