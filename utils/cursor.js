// src/utils/cursor.js
const encodeCursor = (row) =>
  Buffer.from(`${row.createdAt.toISOString()}::${row.id}`).toString('base64');

const decodeCursor = (cursor) => {
  const [createdAtStr, idStr] = Buffer.from(cursor, 'base64')
    .toString('utf8')
    .split('::');
  const createdAt = new Date(createdAtStr);
  const id = Number.isNaN(Number(idStr)) ? idStr : Number(idStr); // รองรับ id เป็น number หรือ string
  return { createdAt, id };
};

module.exports = { encodeCursor, decodeCursor };
