const axios = require("axios");
require("dotenv").config();
const { Op } = require("sequelize");
const moment = require("moment");
const UAParser = require("ua-parser-js");

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
const { validateGroupInitTokenNotExceedAiTokenCount } = require("../utils/validateGroupInitToken.js");
const { upsertDailyUserCountPlus } = require("../utils/upsertDailyUserCountPlus.js");
const { getLocale } = require("../utils/currentUser.js");
const { setUserLoginHistory, setUserDailyActive } = require("../utils/userActive.js");
const { User, RefreshToken, User_role, User_ai, Role, Ai, Group, Group_ai } = db;
const https = require("https");

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

exports.me = async (ctx) => {
  // console.log("ctx", ctx?.req?.user?.id);
  
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
            attributes: ["role_name_th", "role_name_en"], // << ดึงชื่อ role ตรงนี้
            required: false,
          },
        ],
      },
    ],
  });
  
  return(
    {
      id: user?.id,
      // username: user?.username,
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
      role_name_th: user?.user_role[0]?.role?.role_name_th,
      role_name_en: user?.user_role[0]?.role?.role_name_en
    }
  )
}

// ---------- 1) login ผู้ใช้ปกติ ----------
exports.signin = async ({ username, password, locale }, ctx) => {
  if (!username) {
    throw new Error(locale === "th" ? "ชื่อผู้ใช้งานห้ามเป็นค่าว่าง" : "Username must not be empty");
  }
  if (!password) {
    throw new Error(locale === "th" ? "รหัสผ่านห้ามเป็นค่าว่าง" : "Password must not be empty");
  }

  const SPECIAL_ID = "Admin01";

  const officerRoleNameTH = "เจ้าหน้าที่";
  const officerRoleNameEN = "officer";

  const adminRoleNameTH = "ผู้ดูแลระบบ";
  const adminRoleNameEN = "administrator";

  // 🔒 0) เช็กก่อนเลยว่าบัญชีนี้ถูกล็อกอยู่หรือไม่
  const ttl = await checkUserLocked(username);
    if (ttl !== null) {
    const minutes = Math.floor(ttl / 60);
    const seconds = ttl % 60;

    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");

    throw new Error(
      locale === "th"
        ? `บัญชีนี้ถูกล็อกชั่วคราว กรุณารอสักครู่เพื่อเข้าสู่ระบบอีกครั้ง ${mm}:${ss} นาที`
        : `This account is temporarily locked. Please wait and try logging in again in ${mm}:${ss} minutes.`
    );
  }

  // เตรียมข้อมูลก่อนส่ง
  const postData = { username, password };

  // ส่ง username กับ password ไปตรวจสอบที่ onesqa

  // ✅ 1) เรียก ONESQA (คง logic เดิมไว้) แต่เพิ่ม fallback ถ้าเรียกไม่ได้
  let response;
  try {
    response = await axios.post(
      `${process.env.ONESQA_URL}/users/user_login`,
      postData,
      {
        httpsAgent,
        headers: {
          Accept: "application/json",
          "X-Auth-ID": process.env.X_AUTH_ID,
          "X-Auth-Token": process.env.X_AUTH_TOKEN,
        },
        //timeout: 8000, // กันค้างนานเกินไป (ปรับได้)
      }
    );
  } catch (err) {
    // ถ้า ONESQA ตอบกลับมาเป็น HTTP error (4xx/5xx) จะมี err.response
    const status = err?.response?.status;

    // ✅ ถ้า 4xx แปลว่ายังติดต่อ ONESQA ได้ → ใช้ response เดิมเพื่อให้ logic เดิมทำงานต่อ
    if (status && status < 500) {
      response = err.response;
    } else {
      // ✅ เคสที่ "เรียกไม่ได้จริง" (timeout / network / 5xx) → ไป fallback
      return await signinBackup({ username, password, locale }, ctx, err);
    }
  }

  // ====== จากตรงนี้ “คง logic เดิมของคุณไว้” ======
  // console.log(response);

  // ถ้าชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง
  if (
    response.data.result === "fail" && 
    username !== SPECIAL_ID
  ) {
    // ✅ map บางข้อความให้เป็น 2 ภาษา
    const mapDesc = (desc) => {
      if (desc === "ไม่พบ user นี้") {
        return locale === "th" ? "ไม่พบ user นี้" : "User not found";
      }
      if (desc === "รหัสผ่านไม่ถูกต้อง" || desc === "รหัสผ่านผิด") {
        return locale === "th" ? "รหัสผ่านไม่ถูกต้อง" : "Incorrect password";
      }
      if (desc === "ไม่พบ user นี้ หรือรหัสผ่านไม่ถูกต้อง") {
        return locale === "th" ? "ไม่พบ user นี้ หรือรหัสผ่านไม่ถูกต้อง" : "User not found or incorrect password";
      }
      return desc; // ข้อความอื่นๆ ส่งต่อเหมือนเดิม
    };

    await handleFailedLogin(username, mapDesc(response.data.desc), locale);
  }

  // ✅ มาถึงตรงนี้แปลว่า login ผ่าน ONESQA แล้ว
  //    → ล้างตัวนับผิด / lock ใน Redis
  if (username !== SPECIAL_ID) await resetLoginState(username);

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
            attributes: ["role_name_th", "role_name_en"], // << ดึงชื่อ role ตรงนี้
            required: false,
          },
        ],
      }
    ],
    where: { username } 
  });

  // (แนะนำ) ช่วย normalize group_name กันเคสพิมพ์เล็ก/ใหญ่
  const apiGroupName = String(response?.data?.data?.group_name ?? "").trim();
  const isAdminGroup = apiGroupName.toLowerCase() === "admin";
  const roleNameToAssignTH = isAdminGroup ? adminRoleNameTH : officerRoleNameTH;
  const roleNameToAssignEN = isAdminGroup ? adminRoleNameEN : officerRoleNameEN;

  // ถ้า user นี้ยังไม่มีข้อมูลอยู่ใน db ให้นำข้อมูลจาก api มาสร้างข้อมูล user นี้เก็บไว้
  let userId;
  if (!exists) {
    // ข้อมูลของ model ของผู้ใช้งาน
    const ai_exists = await Ai.findAll();
    // ข้อมูล group ของ user
    const group = await Group.findOne({
      where: { name: response.data.data.group_name },
    });
    const groupAis = await Group_ai.findAll({
      where: { group_id: group.id },
    });

    await validateGroupInitTokenNotExceedAiTokenCount({
      groupName: response.data.data.group_name,
      aiExists: ai_exists,
      locale
    });

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
      ai_access: group.status,
      color_mode: "LIGHT",
      loginAt: moment(),
    });
    userId = user.id;

    // บันทึกข้อมูล role ของผู้ใช้งาน
    const role_exists = await Role.findOne({
      where: { role_name_th: roleNameToAssignTH },
    });
    const user_role = await User_role.create({
      user_id: userId,
      role_id: role_exists.id,
    });

    // ทำเป็น map: ai_id -> init_token
    const initTokenByAiId = new Map(
      groupAis.map((ga) => [ga.ai_id, ga.init_token ?? 0])
    );
    for (const item of ai_exists) {
      const initToken = initTokenByAiId.get(item.id) ?? 0;

      // กันสร้างซ้ำ (ถ้าต้องการให้สร้างใหม่เสมอ ให้เปลี่ยนเป็น create)
      await User_ai.findOrCreate({
        where: { user_id: userId, ai_id: item.id },
        defaults: {
          token_count: initToken,
          token_all: initToken,
        },
      });
    }

    await upsertDailyUserCountPlus()

  // ถ้ามีข้อมูลอยู่แล้วให้นำข้อมูลจาก api มา update ข้อมูล user
  } else {

    // เช็ค password สำหรับ ID พิเศษ
    if (username === SPECIAL_ID) {
      const compare = await comparePassword(password, exists.password)
      if (compare === false) {
        // ❌ เคส login fail → เพิ่มตัวนับ + อาจล็อก 5 นาที
        await handleFailedLogin(
          username,
          locale === "th" ? "รหัสผ่านไม่ถูกต้อง" : "Incorrect password",
          locale
        );
      }

      // ✅ มาถึงตรงนี้แปลว่า login ผ่าน ONESQA แล้ว
      //    → ล้างตัวนับผิด / lock ใน Redis
      await resetLoginState(username);
    }

    userId = exists.id;
    if (username !== SPECIAL_ID) {
      const hashed = await hashPassword(password);
      //บันทึกข้อมูลล่าสุดของ user จาก api
      const editUser = await User.update({
        firstname: response.data.data.fname,
        lastname: response.data.data.lname,
        password: hashed,
        email: response.data.data.email,
        is_online: true,
        position: response.data.data.position,
        group_name: response.data.data.group_name,
        loginAt: moment(),
      }, { where: { username } })
    } else {
      const editUser = await User.update({
        loginAt: moment(),
      }, { where: { username } })
    }
  }

  const ua = ctx?.req?.headers["user-agent"] || "";
  const parsed = new UAParser(ua).getResult();
  
  const browserName = parsed.browser.name;
  const browserVersion = parsed.browser.version;

  // สร้าง token
  const payload = { username: username, id: userId };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  // เก็บ refreshToken ใน db
  await RefreshToken.create({
    token: refreshToken,
    user_id: userId,
    expiresAt: moment().add(7, "days").toDate(),
    user_agent: browserName + " " + browserVersion
  });

  // set cookie ผ่าน ctx.res (GraphQL มี res จาก context)
  ctx.res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: false,
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  await setUserLoginHistory(userId, "LOGIN_SUCCESS", ctx)
  await setUserDailyActive(userId, "LOGIN")

  return {
    user: {
      id: userId,
      //username: exists?.username ?? response.data.data.username,
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
      role_name_th: exists?.user_role[0]?.role?.role_name_th ?? roleNameToAssignTH,
      role_name_en: exists?.user_role[0]?.role?.role_name_en ?? roleNameToAssignEN
    },
    token: accessToken,
  };

  // ถ้าระบบ ONESQA ล่ม ให้ throw กลับไปเหมือน REST (ไม่เปลี่ยน flow)
  // throw new Error(
  //   err?.response?.data?.desc || err.message || "เข้าสู่ระบบล้มเหลว"
  // );

  // ทำ login ตามปกติ
};
// ✅ 2) Fallback แยกส่วน: ใช้ “บัญชีที่ backup ไว้ใน DB” (กรณี ONESQA ล่ม/เรียกไม่ได้)
async function signinBackup({ username, password, locale }, ctx, rawErr) {
  // (จะ log ก็ได้ แต่อย่า log password)
  // console.error("ONESQA unavailable -> fallback login:", rawErr?.message);

  const exists = await User.findOne({
    include: [
      {
        model: User_role,
        as: "user_role",
        include: [
          {
            model: Role,
            as: "role",
            attributes: ["role_name_th", "role_name_en"],
            required: false,
          },
        ],
      },
    ],
    where: { username },
  });

  // ถ้าไม่เคย backup ไว้ จะ login ไม่ได้ เพราะไม่มีข้อมูลจาก ONESQA
  if (!exists) {
    const msg =
      locale === "th"
        ? "ระบบ ONESQA ไม่พร้อมใช้งาน และไม่พบบัญชีผู้ใช้สำรอง"
        : "ONESQA system is unavailable and no backup user account was found";

    await handleFailedLogin(username, msg, locale);
    throw new Error(msg);
  }

  // ถ้ามีการ backup ไว้เเล้ว เเต่ไม่มีข้อมูลรหัสผ่าน
  if (exists.password === null) {
    const msg =
      locale === "th"
        ? "ระบบ ONESQA ไม่พร้อมใช้งาน และรหัสผ่านยังไม่ถูกบันทึกสำรองไว้"
        : "ONESQA system is unavailable and password has not been backed up yet";

    await handleFailedLogin(username, msg, locale);
    throw new Error(msg);
  }

  // ตรวจรหัสผ่านจาก DB
  const ok = await comparePassword(password, exists.password);
  if (!ok) {
    const msg =
      locale === "th"
        ? "รหัสผ่านไม่ถูกต้อง"
        : "Incorrect password";

    await handleFailedLogin(username, msg, locale);
    throw new Error(msg);
  }

  // ผ่านแล้วล้างสถานะล็อก/นับผิด
  await resetLoginState(username);

  // อัปเดตสถานะผู้ใช้
  await User.update(
    { is_online: true, loginAt: moment() },
    { where: { username } }
  );

  const ua = ctx?.req?.headers["user-agent"] || "";
  const parsed = new UAParser(ua).getResult();
  
  const browserName = parsed.browser.name;
  const browserVersion = parsed.browser.version;

  // ออก token เหมือนเดิม
  const userId = exists.id;
  const payload = { username: username, id: userId };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  await RefreshToken.create({
    token: refreshToken,
    user_id: userId,
    expiresAt: moment().add(7, "days").toDate(),
    user_agent: browserName + " " + browserVersion
  });

  ctx.res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: false,
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  await setUserLoginHistory(userId, "LOGIN_SUCCESS", ctx)
  await setUserDailyActive(userId, "LOGIN")

  return {
    user: {
      id: userId,
      firstname: exists.firstname,
      lastname: exists.lastname,
      phone: exists.phone ?? "",
      email: exists.email ?? "",
      login_type: exists.login_type ?? "NORMAL",
      locale: exists.locale ?? "th",
      alert: exists.alert ?? false,
      is_online: true,
      position: exists.position,
      group_name: exists.group_name,
      ai_access: exists.ai_access ?? false,
      color_mode: exists.color_mode ?? "LIGHT",
      role_name_th: exists?.user_role?.[0]?.role?.role_name_th ?? "เจ้าหน้าที่",
      role_name_en: exists?.user_role?.[0]?.role?.role_name_en ?? "เจ้าหน้าที่",
    },
    token: accessToken,
  };
}

// ---------- 2) ขอ OTP สำหรับผู้ประเมิน ----------
exports.signinWithIdennumber = async ({ idennumber, otp_type, locale }, ctx) => {
  if (!idennumber) {
    throw new Error(
      locale === "th"
        ? "เลขบัตรประชาชนห้ามเป็นค่าว่าง"
        : "National ID number must not be empty"
    );
  }

  if (!otp_type) {
    throw new Error(
      locale === "th" ? "otp_type ห้ามเป็นค่าว่าง" : "otp_type must not be empty"
    );
  }

  if (idennumber.length !== 13) {
    throw new Error(
      locale === "th"
        ? "เลขบัตรประชาชนต้องมี 13 หลัก"
        : "National ID number must be 13 digits"
    );
  }

  const GROUP_NAME = "กลุ่มผู้ประเมินภายนอก";
  const SPECIAL_ID = "6375867232201";

  // 🔒 0) เช็กก่อนเลยว่าบัญชีนี้ถูกล็อกอยู่หรือไม่
  const ttl = await checkUserLocked(idennumber);
    if (ttl !== null) {
    const minutes = Math.floor(ttl / 60);
    const seconds = ttl % 60;

    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");

    throw new Error(
      locale === "th"
        ? `บัญชีนี้ถูกล็อกชั่วคราว กรุณารอสักครู่เพื่อเข้าสู่ระบบอีกครั้ง ${mm}:${ss} นาที`
        : `This account is temporarily locked. Please wait and try logging in again in ${mm}:${ss} minutes.`
    );
  }

  // เตรียมข้อมูลก่อนส่ง
  const postData = {
    id_card: idennumber,
    start: 0,
    length: 1000,
  };

  // ส่ง idennumber ไปตรวจสอบที่ onesqa

  // ถ้าระบบของ onesqa สามารถใช้งานได้
  // ✅ 1) เรียก ONESQA แต่เพิ่ม fallback ถ้าเรียกไม่ได้จริง
  let response;
  try {
    response = await axios.post(
      `${process.env.ONESQA_URL}/assessments/get_assessor`,
      postData,
      {
        httpsAgent,
        headers: {
          Accept: "application/json",
          "X-Auth-ID": process.env.X_AUTH_ID,
          "X-Auth-Token": process.env.X_AUTH_TOKEN,
        },
        //timeout: 8000, // กันค้างนานเกินไป (ปรับได้)
      }
    );
  } catch (err) {
    const status = err?.response?.status;

    // ✅ ถ้าเป็น 4xx แปลว่ายังติดต่อได้ → ใช้ response เดิม (ไม่เปลี่ยน flow)
    if (status && status < 500) {
      response = err.response;
    } else {
      // ✅ timeout / network / 5xx → ไป fallback
      return await signinWithIdennumberBackup({ idennumber, otp_type, locale }, ctx, err);
    }
  }

  // ถ้าไม่พบเลขบัตรประชาชนนี้ในระบบของ onesqa
  if (
    response.data.total === 0 && 
    idennumber !== SPECIAL_ID
  ) {
    const msg = locale === "th" ? "ไม่พบ user นี้" : "User not found";
    await handleFailedLogin(idennumber, msg, locale);
    throw new Error(msg);
  }

  // ตรวจสอบว่าชื่อผู้ใช้คนนี้ได้ทำการ backup ไว้หรือยัง
  const exists = await User.findOne({ where: { username: idennumber } });

  // ถ้ายังให้ทำการ backup ข้อมูลเก็บไว้
  let userId;
  let userPhone;
  let userEmail;
  if (!exists) {
    // ข้อมูลของ model ของผู้ใช้งาน
    const ai_exists = await Ai.findAll();
    // ข้อมูล group ของ user
    const group = await Group.findOne({
      where: { name: GROUP_NAME },
    });
    const groupAis = await Group_ai.findAll({
      where: { group_id: group.id },
    });

    await validateGroupInitTokenNotExceedAiTokenCount({
      groupName: GROUP_NAME,
      aiExists: ai_exists,
      locale
    });

    const userPayload =
      idennumber === SPECIAL_ID
        ? {
            firstname: "testfn",
            lastname: "testln",
            email: "naterzaza1@gmail.com",
            phone: "0800539193",
          }
        : {
            firstname: response.data.data[0].name,
            lastname: response.data.data[0].lastname,
            email: String(response.data.data[0].email),
            phone: String(response.data.data[0].tel),
          };

    // บันทักข้อมูลผู้ใช่้งานลง db เพื่อ backup
    const user = await User.create({
      ...userPayload,              // ✅ เอาค่าที่เลือกตาม id มาใส่ตรงนี้
      username: idennumber,
      login_type: "INSPEC",
      locale: "th",
      alert: false,
      is_online: false,
      position: "",
      group_name: GROUP_NAME,
      ai_access: group.status,
      color_mode: "LIGHT",
      //loginAt: moment(),
    });
    userId = user.id;
    if (idennumber === SPECIAL_ID) {
      userPhone = "0800539193"
      userEmail = "naterzaza1@gmail.com"
    } else {
      userPhone = String(response.data.data[0].tel)
      userEmail = String(response.data.data[0].email)
    }

    // บันทึกข้อมูล role ของผู้ใช้งาน
    const role_exists = await Role.findOne({
      where: { role_name_th: "ผู้ประเมินภายนอก" },
    });
    const user_role = await User_role.create({
      user_id: userId,
      role_id: role_exists.id,
    });

    // ทำเป็น map: ai_id -> init_token
    const initTokenByAiId = new Map(
      groupAis.map((ga) => [ga.ai_id, ga.init_token ?? 0])
    );
    for (const item of ai_exists) {
      const initToken = initTokenByAiId.get(item.id) ?? 0;

      // กันสร้างซ้ำ (ถ้าต้องการให้สร้างใหม่เสมอ ให้เปลี่ยนเป็น create)
      await User_ai.findOrCreate({
        where: { user_id: userId, ai_id: item.id },
        defaults: {
          token_count: initToken,
          token_all: initToken,
        },
      });
    }

    await upsertDailyUserCountPlus()
    
  } else {
    userId = exists.id;
    if (idennumber === SPECIAL_ID) {
      userPhone = "0800539193"
      userEmail = "naterzaza1@gmail.com"
    } else {
      userPhone = String(response.data.data[0].tel)
      userEmail = String(response.data.data[0].email)
    }
    
    if (idennumber !== SPECIAL_ID) {
      //บันทึกข้อมูลล่าสุดของ user จาก api
      const editUser = await User.update({
        firstname: response.data.data[0].name,
        lastname: response.data.data[0].lastname,
        email: String(response.data.data[0].email),
        phone: String(response.data.data[0].tel),
        //loginAt: moment(),
      }, { where: { username: idennumber } })
    } else {
      //บันทึกข้อมูลล่าสุดของ user จาก api
      // const editUser = await User.update({
      //   loginAt: moment(),
      // }, { where: { username: idennumber } })
    }
  }

  // สร้าง OTP แบบสุ่มเลข 6 หลัก
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  // เก็บบัตร บชช กับเลข otp ลง redis
  await setOtp(idennumber, otp);
  // เวลา 5 นาทีข้างหน้า
  const timeIn5Min = moment().add(5, "minutes").format("HH:mm:ss");

  // ถ้าเลือกให้ส่ง otp ทาง sms
  const isBlank = (v) => v == null || String(v).trim() === "";
  if (otp_type === "sms") {
    if (isBlank(userPhone)) {
      throw new Error(
        locale === "th"
          ? "ไม่พบเบอร์โทรศัพท์สำหรับส่ง OTP"
          : "Phone number for sending OTP was not found"
      );
    }

    const smsPost = {
      message:
        locale === "th"
          ? `รหัส OTP ของคุณคือ ${otp} รหัสสามารถใช้ได้ถึง ${timeIn5Min} น.`
          : `Your OTP code is ${otp}. The code is valid until ${timeIn5Min}.`,
      phone: userPhone,
      sender: "ONESQA",
    };

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

    // console.log(rsp);
    
    if (rsp.data.detail !== "OK.") {
      throw new Error(locale === "th" ? "ส่ง OTP ไม่สำเร็จ" : "Failed to send OTP");
    }

    return {
      message: locale === "th" ? "OTP ถูกส่งไปที่ SMS แล้ว" : "OTP has been sent via SMS",
      method: userPhone,
    };
  }
  if (otp_type === "email") {
    if (isBlank(userEmail)) {
      throw new Error(
        locale === "th"
          ? "ไม่พบอีเมลสำหรับส่ง OTP"
          : "Email address for sending OTP was not found"
      );
    }

    await transporter.sendMail({
      from: `"Send OTP" <${process.env.EMAIL_USER}>`,
      to: userEmail,
      subject: "ONESQA",
      text:
        locale === "th"
          ? `รหัส OTP ของคุณคือ ${otp} รหัสสามารถใช้ได้ถึง ${timeIn5Min} น.`
          : `Your OTP code is ${otp}. The code is valid until ${timeIn5Min}.`,
    });

    return {
      message: locale === "th" ? "OTP ถูกส่งไปที่ Email แล้ว" : "OTP has been sent via email",
      method: userEmail,
    };
  }

  throw new Error(locale === "th" ? "otp_type ไม่ถูกต้อง" : "Invalid otp_type");

  // ถ้าระบบของ onesqa มีปัญหา
  // throw new Error(
  //   err?.response?.data?.desc || err.message || "ขอ OTP ไม่สำเร็จ"
  // );

  // ทำ login ตามปกติ
};
async function signinWithIdennumberBackup({ idennumber, otp_type, locale }, ctx, rawErr) {
  // console.error("ONESQA unavailable -> fallback OTP:", rawErr?.message);

  const isBlank = (v) => v == null || String(v).trim() === "";

  const user = await User.findOne({ where: { username: idennumber } });

  // ✅ ตัดการสร้าง SPECIAL_ID ออก: ถ้าไม่พบใน DB ให้จบทันที
  if (!user) {
    const msg =
      locale === "th"
        ? "ระบบ ONESQA ไม่พร้อมใช้งาน และไม่พบบัญชีผู้ใช้สำรอง"
        : "ONESQA system is unavailable and no backup user account was found";

    await handleFailedLogin(idennumber, msg, locale);
    throw new Error(msg);
  }

  const userPhone = user.phone ?? "";
  const userEmail = user.email ?? "";

  // สร้าง OTP แบบสุ่มเลข 6 หลัก
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  await setOtp(idennumber, otp);

  const timeIn5Min = moment().add(5, "minutes").format("HH:mm:ss");

  if (otp_type === "sms") {
    if (isBlank(userPhone)) {
      throw new Error(
        locale === "th"
          ? "ไม่พบเบอร์โทรศัพท์สำหรับส่ง OTP"
          : "Phone number for sending OTP was not found"
      );
    }

    const smsPost = {
      message:
        locale === "th"
          ? `รหัส OTP ของคุณคือ ${otp} รหัสสามารถใช้ได้ถึง ${timeIn5Min} น.`
          : `Your OTP code is ${otp}. The code is valid until ${timeIn5Min}.`,
      phone: userPhone,
      sender: "ONESQA",
    };

    const rsp = await axios.post(`${process.env.SMSMKT_URL}/send-message`, smsPost, {
      headers: {
        Accept: "application/json",
        api_key: process.env.SMSMKT_API_KEY,
        secret_key: process.env.SMSMKT_SECRET_KEY,
      },
    });

    if (rsp.data.detail !== "OK.") {
      throw new Error(locale === "th" ? "ส่ง OTP ไม่สำเร็จ" : "Failed to send OTP");
    }

    return {
      message: locale === "th" ? "OTP ถูกส่งไปที่ SMS แล้ว" : "OTP has been sent via SMS",
      method: userPhone,
    };
  }

  if (otp_type === "email") {
    if (isBlank(userEmail)) {
      throw new Error(
        locale === "th"
          ? "ไม่พบอีเมลสำหรับส่ง OTP"
          : "Email address for sending OTP was not found"
      );
    }

    await transporter.sendMail({
      from: `"Send OTP" <${process.env.EMAIL_USER}>`,
      to: userEmail,
      subject: "ONESQA",
      text:
        locale === "th"
          ? `รหัส OTP ของคุณคือ ${otp} รหัสสามารถใช้ได้ถึง ${timeIn5Min} น.`
          : `Your OTP code is ${otp}. The code is valid until ${timeIn5Min}.`,
    });

    return {
      message: locale === "th" ? "OTP ถูกส่งไปที่ Email แล้ว" : "OTP has been sent via email",
      method: userEmail,
    };
  }

  throw new Error(locale === "th" ? "otp_type ไม่ถูกต้อง" : "Invalid otp_type");
}

// ---------- 3) ยืนยัน OTP (ผู้ประเมินเข้าสู่ระบบ) ----------
exports.verifySigninWithIdennumber = async ({ idennumber, otp, locale }, ctx) => {
  if (!idennumber) {
    throw new Error(
      locale === "th"
        ? "เลขบัตรประชาชนห้ามเป็นค่าว่าง"
        : "National ID number must not be empty"
    );
  }

  if (idennumber.length !== 13) {
    throw new Error(
      locale === "th"
        ? "เลขบัตรประชาชนต้องมี 13 หลัก"
        : "National ID number must be 13 digits"
    );
  }

  if (!otp) {
    throw new Error(
      locale === "th"
        ? "เลข OTP ห้ามเป็นค่าว่าง"
        : "OTP must not be empty"
    );
  }

  // 🔒 0) เช็กก่อนเลยว่าบัญชีนี้ถูกล็อกอยู่หรือไม่
  const ttl = await checkUserLocked(idennumber);
    if (ttl !== null) {
    const minutes = Math.floor(ttl / 60);
    const seconds = ttl % 60;

    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");

    throw new Error(
      locale === "th"
        ? `บัญชีนี้ถูกล็อกชั่วคราว กรุณารอสักครู่เพื่อเข้าสู่ระบบอีกครั้ง ${mm}:${ss} นาที`
        : `This account is temporarily locked. Please wait and try logging in again in ${mm}:${ss} minutes.`
    );
  }

  const valid = await verifyOtp(idennumber, otp);
  if (!valid) {
    // ❌ เคส login fail → เพิ่มตัวนับ + อาจล็อก 5 นาที
    await handleFailedLogin(
      idennumber,
      locale === "th" ? "OTP ผิดหรือ OTP หมดอายุ" : "Invalid or expired OTP",
      locale
    );
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
            attributes: ["role_name_th", "role_name_en"], // << ดึงชื่อ role ตรงนี้
            required: false,
          },
        ],
      }
    ],
    where: { username: idennumber }
  });

  //บันทึกข้อมูลล่าสุดของ user จาก api
  const editUser = await User.update({
    loginAt: moment(),
  }, { where: { id: existUser?.id } })

  const ua = ctx?.req?.headers["user-agent"] || "";
  const parsed = new UAParser(ua).getResult();
  
  const browserName = parsed.browser.name;
  const browserVersion = parsed.browser.version;

  // สร้าง token
  const payload = { username: idennumber, id: existUser.id };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  // เก็บ refreshToken ใน db
  await RefreshToken.create({
    token: refreshToken,
    user_id: existUser.id,
    expiresAt: moment().add(7, "days").toDate(),
    user_agent: browserName + " " + browserVersion
  });

  // ส่ง refresh token ผ่าน cookie
  ctx.res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: false,
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  await setUserLoginHistory(existUser?.id, "LOGIN_SUCCESS", ctx)
  await setUserDailyActive(existUser?.id, "LOGIN")

  return {
    user: {
      id: existUser?.id,
      //username: existUser?.username,
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
      role_name_th: existUser?.user_role[0]?.role?.role_name_th,
      role_name_en: existUser?.user_role[0]?.role?.role_name_en
    },
    token: accessToken,
  };
};

// ---------- 4) ใช้ refreshToken (จาก cookie) ขอ access token ใหม่ ----------
exports.refreshToken = async (ctx) => {
  // เรียกใช้ refreshToken จาก cookies
  // console.log("ctx", ctx);
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
            attributes: ["role_name_th", "role_name_en"], // << ดึงชื่อ role ตรงนี้
            required: false,
          },
        ],
      }
    ],
    where: { username: decoded.username },
  });

  const ua = ctx?.req?.headers["user-agent"] || "";
  const parsed = new UAParser(ua).getResult();
  
  const browserName = parsed.browser.name;
  const browserVersion = parsed.browser.version;

  // สร้าง token ใหม่
  const payload = { username: decoded.username, id: decoded.id };
  const newAccessToken = generateAccessToken(payload);
  const newRefreshToken = generateRefreshToken(payload);

  // เก็บ refreshToken ที่สร้างใหม่ใน db
  await RefreshToken.update({ 
    token: newRefreshToken, 
    expiresAt: moment().add(7, "days").toDate(),
    user_agent: browserName + " " + browserVersion
  }, { where: { id: existing.id } });

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
      //username: existUser?.username,
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
      role_name_th: existUser?.user_role[0]?.role?.role_name_th,
      role_name_en: existUser?.user_role[0]?.role?.role_name_en
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

// ---------- 6) login จากระบบ AQA ----------
exports.signinFromAQA = async (username, aqa_code, ctx) => {
  if (!username) {
    throw new Error("Username must not be empty");
  }
  if (!aqa_code) {
    throw new Error("AQA_CODE must not be empty");
  }
  
  if (aqa_code !== process.env.AQA_CODE) {
    throw new Error("Incorrect AQA_CODE");
  }

  // ตรวจสอบว่าชื่อผู้ใช้คนนี้มีใน database มั้ย
  const exists = await User.findOne({ 
    include: [
      {
        model: User_role,
        as: "user_role",
        include: [
          {
            model: Role,
            as: "role", // ต้องตรงกับ alias ใน User_role.belongsTo(...)
            attributes: ["role_name_th", "role_name_en"], // << ดึงชื่อ role ตรงนี้
            required: false,
          },
        ],
      }
    ],
    where: { username } 
  });

  let userId;
  // ถ้า user นี้ไม่มีข้อมูลอยู่ใน db
  if (!exists) {
    throw new Error("User not found");
  }

  // ถ้า user นี้ไม่ใช่เจ้าหน้าที่สมศ
  if (exists?.login_type !== "NORMAL") {
    throw new Error("Incorrect login_type");
  }

  userId = exists?.id; // ✅ สำคัญ

  const ua = ctx?.req?.headers["user-agent"] || "";
  const parsed = new UAParser(ua).getResult();
  
  const browserName = parsed.browser.name;
  const browserVersion = parsed.browser.version;

  // สร้าง token
  const payload = { username: username, id: userId };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  // เก็บ refreshToken ใน db
  await RefreshToken.create({
    token: refreshToken,
    user_id: userId,
    expiresAt: moment().add(7, "days").toDate(),
    user_agent: browserName + " " + browserVersion
  });

  // set cookie ผ่าน ctx.res (GraphQL มี res จาก context)
  ctx.res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: false,
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  await setUserLoginHistory(userId, "LOGIN_SUCCESS", ctx)
  await setUserDailyActive(userId, "LOGIN")

  return {
    user: {
      id: userId,
      //username: exists?.username ?? response.data.data.username,
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
      role_name_th: exists?.user_role[0]?.role?.role_name_th ?? roleNameToAssignTH,
      role_name_en: exists?.user_role[0]?.role?.role_name_en ?? roleNameToAssignEN
    },
    token: accessToken,
  };
}