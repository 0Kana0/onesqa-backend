// queues/email.queue.js
const { Queue } = require('bullmq');
const connection = require('../function/redis-queue');

const emailQueue = new Queue('email-queue', {
  connection,
});

module.exports = emailQueue;
