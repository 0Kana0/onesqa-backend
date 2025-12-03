const axios = require("axios");
require("dotenv").config();
const { Op } = require("sequelize");
const moment = require("moment");

const { hashPassword, comparePassword } = require("../utils/hash.js");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require("../utils/jwt.js");
const { setOtp, verifyOtp } = require("../utils/otp.js");
const transporter = require("../config/email-config.js");

const {
  checkUserLocked,
  resetLoginState,
  handleFailedLogin,
  MAX_FAILED_ATTEMPTS,
} = require("../utils/loginLimiter.js");

const db = require("../db/models");
const { User, RefreshToken, User_role, User_ai, Role, Ai } = db;

exports.me = async (ctx) => {
  console.log("ctx", ctx?.req?.user?.id);
  
  const user = await User.findByPk(ctx?.req?.user?.id, {
    attributes: { exclude: ["password"] }, // กันเผลอส่ง password ออกไป
    include: [
      {
        model: User_role,
        as: "user_role",
        include: [
          {
            model: Role,
            as: "role", // ต้องตรงกับ alias ใน User_role.belongsTo(...)
            attributes: ["role_name"], // << ดึงชื่อ role ตรงนี้
            required: false,
          },
        ],
      },
    ],
  });
  
  return(
    {
      id: user?.id,
      username: user?.username,
      firstname: user?.firstname,
      lastname: user?.lastname,
      phone: user?.phone,
      email: user?.email,
      login_type: user?.login_type,
      locale: user?.locale,
      alert: user?.alert,
      is_online: true,
      position: user?.position,
      group_name: user?.group_name,
      ai_access: user?.ai_access,
      color_mode: user?.color_mode,
      role_name: user?.user_role[0]?.role?.role_name
    }
  )
}

// ---------- 1) login ผู้ใช้ปกติ ----------
exports.signin = async ({ username, password }, ctx) => {
  if (!username) throw new Error("ชื่อผู้ใช้งานห้ามเป็นค่าว่าง");
  if (!password) throw new Error("รหัสผ่านห้ามเป็นค่าว่าง");

  // 🔒 0) เช็กก่อนเลยว่าบัญชีนี้ถูกล็อกอยู่หรือไม่
  const ttl = await checkUserLocked(username);
    if (ttl !== null) {
    const minutes = Math.floor(ttl / 60);
    const seconds = ttl % 60;

    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");

    throw new Error(
      `บัญชีนี้ถูกล็อกชั่วคราว กรุณารอสักครู่เพื่อเข้าสู่ระบบอีกครั้ง ${mm}:${ss} นาที`
    );
  }

  // เตรียมข้อมูลก่อนส่ง
  const postData = { username, password };

  // ส่ง username กับ password ไปตรวจสอบที่ onesqa

  // ถ้าระบบของ onesqa สามารถใช้งานได้
  const response = await axios.post(
    `${process.env.ONESQA_URL}/users/user_login`,
    postData,
    {
      headers: {
        Accept: "application/json",
        "X-Auth-ID": process.env.X_AUTH_ID,
        "X-Auth-Token": process.env.X_AUTH_TOKEN,
      },
    }
  );

  // ถ้าชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง
  if (response.data.result === "fail") {
    // ❌ เคส login fail → เพิ่มตัวนับ + อาจล็อก 5 นาที
    await handleFailedLogin(username, response.data.desc);
  }

  // ✅ มาถึงตรงนี้แปลว่า login ผ่าน ONESQA แล้ว
  //    → ล้างตัวนับผิด / lock ใน Redis
  await resetLoginState(username);

  // ตรวจสอบว่าชื่อผู้ใช้คนนี้ได้ทำการ backup ไว้หรือยัง
  const exists = await User.findOne({ 
    include: [
      {
        model: User_role,
        as: "user_role",
        include: [
          {
            model: Role,
            as: "role", // ต้องตรงกับ alias ใน User_role.belongsTo(...)
            attributes: ["role_name"], // << ดึงชื่อ role ตรงนี้
            required: false,
          },
        ],
      }
    ],
    where: { username } 
  });

  // ถ้ายังให้ทำการ backup ข้อมูลเก็บไว้
  let userId;
  if (!exists) {
    // บันทักข้อมูลผู้ใช่้งานลง db เพื่อ backup
    const hashed = await hashPassword(password);
    const user = await User.create({
      firstname: response.data.data.fname,
      lastname: response.data.data.lname,
      username: username,
      password: hashed,
      phone: "",
      email: response.data.data.email,
      login_type: "NORMAL",
      locale: "th",
      alert: false,
      is_online: true,
      position: response.data.data.position,
      group_name: response.data.data.group_name,
      ai_access: false,
      color_mode: "LIGHT",
      loginAt: moment(),
    });
    userId = user.id;

    // บันทึกข้อมูล role ของผู้ใช้งาน
    const role_exists = await Role.findOne({
      where: { role_name: "เจ้าหน้าที่" },
    });
    // เอาออกทีหลัง
    if (username === "Minerta") {
      const user_role = await User_role.create({
        user_id: userId,
        role_id: 3,
      });
    } else {
      const user_role = await User_role.create({
        user_id: userId,
        role_id: role_exists.id,
      });
    }

    // ข้อมูลของ model ของผู้ใช้งาน
    const ai_exists = await Ai.findAll();
    for (const item of ai_exists) {
      const user_ai = await User_ai.create({
        user_id: userId,
        ai_id: item.id,
        token_count: 0,
        token_all: 0,
      });
    }
  } else {
    userId = exists.id;
  }

  // สร้าง token
  const payload = { username: response.data.data.username, id: userId };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  // เก็บ refreshToken ใน db
  await RefreshToken.create({
    token: refreshToken,
    user_id: userId,
    expiresAt: moment().add(7, "days").toDate(),
  });

  // set cookie ผ่าน ctx.res (GraphQL มี res จาก context)
  ctx.res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: false,
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return {
    user: {
      id: userId,
      username: exists?.username ?? response.data.data.username,
      firstname: exists?.firstname ?? response.data.data.fname,
      lastname: exists?.lastname ?? response.data.data.lname,
      phone: exists?.phone ?? "",
      email: exists?.email ?? response.data.data.email,
      login_type: exists?.login_type ?? "NORMAL",
      locale: exists?.locale ?? "th",
      alert: exists?.alert ?? false,
      is_online: true,
      position: exists?.position ?? response.data.data.position,
      group_name: exists?.group_name ?? response.data.data.group_name,
      ai_access: exists?.ai_access ?? false,
      color_mode: exists?.color_mode ?? "LIGHT",
      role_name: exists?.user_role[0]?.role?.role_name ?? "เจ้าหน้าที่"
    },
    token: accessToken,
  };

  // ถ้าระบบ ONESQA ล่ม ให้ throw กลับไปเหมือน REST (ไม่เปลี่ยน flow)
  // throw new Error(
  //   err?.response?.data?.desc || err.message || "เข้าสู่ระบบล้มเหลว"
  // );

  // ทำ login ตามปกติ
};

// ---------- 2) ขอ OTP สำหรับผู้ประเมิน ----------
exports.signinWithIdennumber = async ({ idennumber, otp_type }, ctx) => {
  if (!idennumber) throw new Error("เลขบัตรประชาชนห้ามเป็นค่าว่าง");
  if (!otp_type) throw new Error("otp_type ห้ามเป็นค่าว่าง");

  if (idennumber.length !== 13) throw new Error("เลขบัตรประชาชนต้องมี 13 หลัก");

  // เตรียมข้อมูลก่อนส่ง
  const postData = {
    academy_level_id: "2",
    id_card: idennumber,
    start: 0,
    length: 1000,
  };

  // ส่ง idennumber ไปตรวจสอบที่ onesqa

  // ถ้าระบบของ onesqa สามารถใช้งานได้
  await axios.post(
    `${process.env.ONESQA_URL}/assessments/get_assessor`,
    postData,
    {
      headers: {
        Accept: "application/json",
        "X-Auth-ID": process.env.X_AUTH_ID,
        "X-Auth-Token": process.env.X_AUTH_TOKEN,
      },
    }
  );

  // ตรวจสอบว่าชื่อผู้ใช้คนนี้ได้ทำการ backup ไว้หรือยัง
  const exists = await User.findOne({ where: { username: idennumber } });

  // ถ้ายังให้ทำการ backup ข้อมูลเก็บไว้
  let userId;
  let userPhone;
  let userEmail;
  if (!exists) {
    // บันทักข้อมูลผู้ใช่้งานลง db เพื่อ backup
    const user = await User.create({
      firstname: "testfn",
      lastname: "testln",
      username: idennumber,
      email: "naterzaza1@gmail.com",
      phone: "0800539193",
      login_type: "INSPEC",
      locale: "th",
      alert: false,
      is_online: true,
      position: "",
      group_name: "",
      ai_access: false,
      color_mode: "LIGHT",
      loginAt: moment(),
    });
    userId = user.id;
    userPhone = user.email
    userEmail = user.phone

    // บันทึกข้อมูล role ของผู้ใช้งาน
    const role_exists = await Role.findOne({
      where: { role_name: "ผู้ประเมินภายนอก" },
    });
    const user_role = await User_role.create({
      user_id: userId,
      role_id: role_exists.id,
    });

    // ข้อมูลของ model ของผู้ใช้งาน
    const ai_exists = await Ai.findAll();
    for (const item of ai_exists) {
      const user_ai = await User_ai.create({
        user_id: userId,
        ai_id: item.id,
        token_count: 0,
        token_all: 0,
      });
    }
  } else {
    userId = exists.id;
    userPhone = exists.phone
    userEmail = exists.email
  }

  // สร้าง OTP แบบสุ่มเลข 6 หลัก
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  // เก็บบัตร บชช กับเลข otp ลง redis
  await setOtp(idennumber, otp);
  // เวลา 5 นาทีข้างหน้า
  const timeIn5Min = moment().add(5, "minutes").format("HH:mm:ss");

  // ถ้าเลือกให้ส่ง otp ทาง sms
  if (otp_type === "sms") {
    // เตรียมข้อมูลก่อนส่ง
    const smsPost = {
      message: `รหัส OTP ของคุณคือ ${otp} รหัสสามารถใช้ได้ถึง ${timeIn5Min} น.`,
      phone: userPhone,
      sender: "ONESQA",
    };

    // ส่ง OTP ผ่าน sms
    const rsp = await axios.post(
      `${process.env.SMSMKT_URL}/send-message`,
      smsPost,
      {
        headers: {
          Accept: "application/json",
          api_key: process.env.SMSMKT_API_KEY,
          secret_key: process.env.SMSMKT_SECRET_KEY,
        },
      }
    );

    // ถ้าเบอร์โทรหรือชื่อผู้ส่งไม่ถูกต้อง
    if (rsp.data.detail !== "OK.") {
      throw new Error("ส่ง OTP ไม่สำเร็จ");
    }
    return { 
      message: "OTP ถูกส่งไปที่ SMS แล้ว", 
      method: userPhone,
    };
  }

  if (otp_type === "email") {
    await transporter.sendMail({
      from: `"Send OTP" <${process.env.EMAIL_USER}>`,
      to: userEmail,
      subject: "ONESQA",
      text: `รหัส OTP ของคุณคือ ${otp} รหัสสามารถใช้ได้ถึง ${timeIn5Min} น.`,
    });
    return { 
      message: "OTP ถูกส่งไปที่ Email แล้ว",
      method: userEmail,
    };
  }

  throw new Error("otp_type ไม่ถูกต้อง");

  // ถ้าระบบของ onesqa มีปัญหา
  // throw new Error(
  //   err?.response?.data?.desc || err.message || "ขอ OTP ไม่สำเร็จ"
  // );

  // ทำ login ตามปกติ
};

// ---------- 3) ยืนยัน OTP (ผู้ประเมินเข้าสู่ระบบ) ----------
exports.verifySigninWithIdennumber = async ({ idennumber, otp }, ctx) => {
  if (!idennumber) throw new Error("เลขบัตรประชาชนห้ามเป็นค่าว่าง");
  if (idennumber.length !== 13) throw new Error("เลขบัตรประชาชนต้องมี 13 หลัก");

  if (!otp) throw new Error("เลข OTP ห้ามเป็นค่าว่าง");

  // 🔒 0) เช็กก่อนเลยว่าบัญชีนี้ถูกล็อกอยู่หรือไม่
  const ttl = await checkUserLocked(idennumber);
    if (ttl !== null) {
    const minutes = Math.floor(ttl / 60);
    const seconds = ttl % 60;

    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");

    throw new Error(
      `บัญชีนี้ถูกล็อกชั่วคราว กรุณารอสักครู่เพื่อเข้าสู่ระบบอีกครั้ง ${mm}:${ss} นาที`
    );
  }

  const valid = await verifyOtp(idennumber, otp);
  if (!valid) {
    // ❌ เคส login fail → เพิ่มตัวนับ + อาจล็อก 5 นาที
    await handleFailedLogin(idennumber, "OTP ผิดหรือ OTP หมดอายุ");
  }

  // ✅ มาถึงตรงนี้แปลว่า login ผ่าน ONESQA แล้ว
  //    → ล้างตัวนับผิด / lock ใน Redis
  await resetLoginState(idennumber);

  // เรียกข้อมูลผู้ใช้สำหรับส่ง api
  const existUser = await User.findOne({ 
    include: [
      {
        model: User_role,
        as: "user_role",
        include: [
          {
            model: Role,
            as: "role", // ต้องตรงกับ alias ใน User_role.belongsTo(...)
            attributes: ["role_name"], // << ดึงชื่อ role ตรงนี้
            required: false,
          },
        ],
      }
    ],
    where: { username: idennumber }
  });

  // สร้าง token
  const payload = { username: idennumber, id: existUser.id };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  // เก็บ refreshToken ใน db
  await RefreshToken.create({
    token: refreshToken,
    user_id: existUser.id,
    expiresAt: moment().add(7, "days").toDate(),
  });

  // ส่ง refresh token ผ่าน cookie
  ctx.res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: false,
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return {
    user: {
      id: existUser?.id,
      username: existUser?.username,
      firstname: existUser?.firstname,
      lastname: existUser?.lastname,
      phone: existUser?.phone,
      email: existUser?.email,
      login_type: existUser?.login_type,
      locale: existUser?.locale,
      alert: existUser?.alert,
      is_online: true,
      position: existUser?.position,
      group_name: existUser?.group_name,
      ai_access: existUser?.ai_access,
      color_mode: existUser?.color_mode,
      role_name: existUser?.user_role[0]?.role?.role_name
    },
    token: accessToken,
  };
};

// ---------- 4) ใช้ refreshToken (จาก cookie) ขอ access token ใหม่ ----------
exports.refreshToken = async (ctx) => {
  // เรียกใช้ refreshToken จาก cookies
  console.log("ctx", ctx);
  const token = ctx.req.cookies?.refreshToken;
  if (!token) throw new Error("ไม่พบ refreshtoken ถูกส่งมา");

  const decoded = verifyRefreshToken(token);

  // ตรวจสอบว่ามี refreshToken อยู่ใน DB และยังไม่หมดอายุ
  const existing = await RefreshToken.findOne({
    where: {
      token,
      user_id: decoded.id,
      expiresAt: { [Op.gt]: moment() }, // ยังไม่หมดอายุ
    },
  });
  if (!existing) throw new Error("refreshtoken ไม่ถูกต้องหรือหมดอายุ");

  // เรียกข้อมูลผู้ใช้สำหรับส่ง api
  const existUser = await User.findOne({
    include: [
      {
        model: User_role,
        as: "user_role",
        include: [
          {
            model: Role,
            as: "role", // ต้องตรงกับ alias ใน User_role.belongsTo(...)
            attributes: ["role_name"], // << ดึงชื่อ role ตรงนี้
            required: false,
          },
        ],
      }
    ],
    where: { username: decoded.username },
  });
  // สร้าง token ใหม่
  const payload = { username: decoded.username, id: decoded.id };
  const newAccessToken = generateAccessToken(payload);
  const newRefreshToken = generateRefreshToken(payload);

  // เก็บ refreshToken ที่สร้างใหม่ใน db
  await RefreshToken.update(
    { token: newRefreshToken, expiresAt: moment().add(7, "days").toDate() },
    { where: { id: existing.id } }
  );

  // ส่ง refreshtoken ที่สร้างใหม่ผ่าน cookie
  ctx.res.cookie("refreshToken", newRefreshToken, {
    httpOnly: true,
    secure: false,
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return {
    user: {
      id: existUser?.id,
      username: existUser?.username,
      firstname: existUser?.firstname,
      lastname: existUser?.lastname,
      phone: existUser?.phone,
      email: existUser?.email,
      login_type: existUser?.login_type,
      locale: existUser?.locale,
      alert: existUser?.alert,
      is_online: true,
      position: existUser?.position,
      group_name: existUser?.group_name,
      ai_access: existUser?.ai_access,
      color_mode: existUser?.color_mode,
      role_name: existUser?.user_role[0]?.role?.role_name
    },
    token: newAccessToken,
  };
};

// ---------- 5) logout (ลบ refreshToken + clear cookie) ----------
exports.logout = async (ctx) => {
  const token = ctx.req.cookies?.refreshToken;
  if (!token) throw new Error("ไม่พบ refreshtoken ถูกส่งมา");

  const deleted = await RefreshToken.destroy({ where: { token } });
  ctx.res.clearCookie("refreshToken", { path: "/" });

  return {
    message: deleted === 0 ? "ไม่พบ refreshtoken ใน database" : "logout สำเร็จ",
  };
};
