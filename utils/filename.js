// utils/filename.js

/**
 * ตัด prefix ชุดแรกที่อยู่ก่อน "-" ตัวแรกออก
 * เช่น:
 * "1764550872005-dc5e82c4a0f3cbb70737a6e2268157e0-กหฟกฟหกฟหกฟกฟกฟ.jpg"
 * -> "dc5e82c4a0f3cbb70737a6e2268157e0-กหฟกฟหกฟหกฟกฟกฟ.jpg"
 */
function removeFirstPrefix(filename) {
  if (typeof filename !== "string") return filename;
  return filename.replace(/^[^-]*-/, "");
}

function dataUri(mime, b64) {
  return `data:${mime};base64,${b64}`;
}

// ถ้าใช้ CommonJS (Node.js แบบ require)
module.exports = {
  removeFirstPrefix, dataUri
};

// ถ้าโปรเจกต์คุณใช้ ES Module (import/export) ให้ใช้บรรทัดด้านล่างแทน:
// export { removeFirstPrefix };
