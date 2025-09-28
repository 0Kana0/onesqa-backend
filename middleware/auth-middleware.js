const { verifyAccessToken } = require("../utils/jwt.js");

// middleware สำหรับดักบาง api ที่จำเป็นต้องมีการเข้าสุ่ระบบก่อนถึงจะใช้งานได้
exports.verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // แยก Bearer และ Token
    // console.log(token);

    if (!token) {
      return res.send({
        "message": "ต้องทำการ login ก่อนถึงจะดำเนินการต่อได้"
      })
    }

    try {
      // เเปลง jwt กลับมาเป็น json
      const decoded = verifyAccessToken(token);
      req.user = decoded;
    } catch (error) {
      return res.send({
        "message": "token ไม่ถูกต้องหรือเป็น token อันเก่า"
      })
    }

    return next();
  } catch (error) {
    console.log(error);
  }
}