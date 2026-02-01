const { verifyAccessToken } = require("../utils/jwt.js");

// middleware สำหรับดักบาง api ที่จำเป็นต้องมีการเข้าสุ่ระบบก่อนถึงจะใช้งานได้
module.exports = function verifyToken(req, res, next) {
  try {
    // 1) ดึง token จาก "Authorization": "Bearer <token>"
    const auth = req.headers['authorization'] || '';
    const [, token] = auth.split(' '); // 'Bearer token'

    // (ทางเลือก) รองรับ access token ในคุกกี้ (ถ้าเคยเก็บ)
    const cookieToken = req.cookies?.accessToken;

    const useToken = token || cookieToken;
    //console.log("useToken", useToken);
    
    if (!useToken) {
      // ไม่มี token ก็ผ่านไป แต่จะไม่มี req.user
      return next();
    }

    const decoded = verifyAccessToken(useToken); // ถ้าไม่ผ่านจะ throw
    //console.log("decoded", decoded);
    
    req.user = decoded; // { id, username, ... }
    //console.log("req.user", req.user);
    
    return next();
  } catch (err) {
    // token ไม่ถูกต้อง/หมดอายุ → ไม่แนบ user แต่ไม่บล็อค
    // อยาก log ก็ทำได้
    // console.warn('Invalid access token:', err.message);
    return next();
  }
}