const path = require('path');
const fs = require('fs');
const { Op } = require('sequelize');
const db = require('../db/models'); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { File } = db;

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const sanitize = (name) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

exports.saveUpload = async (upload) => {
  const { filename, mimetype, encoding, createReadStream } = await upload;
  const stream = createReadStream();

  console.log("filename", filename);

  const uniqueName = `${Date.now()}-${filename}`;
  const filePath = path.join(UPLOAD_DIR, uniqueName);

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filePath);
    let bytes = 0;
    stream.on('data', (chunk) => (bytes += chunk.length));
    stream.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    stream.pipe(out);
  });

  const file = await File.create({
    original_name: filename,
    file_name: uniqueName,
    extension: path.extname(filename).slice(1).toLowerCase(),
    mime_type: mimetype,
    size_bytes: fs.statSync(filePath).size,
    folder: "",
    stored_path: `/uploads/${uniqueName}`,
    message_id: null
  });
  console.log(file);
  
  return {
    id: file.id,
    original_name: filename,
    filename: uniqueName,
    mimetype,
    encoding,
    stored_path: `/uploads/${uniqueName}`,
    // ขนาดไฟล์ (byte) จากสถิติระบบไฟล์ (เชื่อถือได้กว่าจับ data เอง)
    size: fs.statSync(filePath).size,
  };
}