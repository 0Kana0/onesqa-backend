// openai-smart-rules-only.js
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path"); // ✅ เพิ่มบรรทัดนี้
require("dotenv").config();

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* -----------------------------
 *  คีย์เวิร์ดที่บ่งชี้ว่า "ต้องใช้ข้อมูลสด"
 *  - แยกเป็นหมวด + รวมทั้งหมดใน ALL_KEYWORDS
 *  - ตรวจทั้งไทย/อังกฤษ + เดือน/วัน/ปี + รูปแบบวันที่/เวลา
 * ----------------------------- */

exports.transcribeAudio = async (filePath) => {
  const r = await client.audio.transcriptions.create({
    // รองรับ mp3/mp4/m4a/wav/webm ฯลฯ
    file: fs.createReadStream(filePath),
    model: "gpt-4o-mini-transcribe"
  });

  console.log(r.text);
  console.log(r.usage); // << เอาไปทำ dashboard/หักโควต้าได้

  return r.text || "";
}

// ข่าว/อัปเดต/ทันเหตุการณ์
const KW_NEWS_TH = [
  "ข่าว","พาดหัว","ด่วน","ล่าสุด","อัปเดต","อัพเดต","อัพเดท","อัปเดท",
  "ประกาศล่าสุด","ถ่ายทอดสด","ไลฟ์","สด","ความเคลื่อนไหว","อีเวนต์ล่าสุด"
];
const KW_NEWS_EN = [
  "news","headline","breaking","latest","update","updates","live","livestream","trend","trending"
];

// ราคา/การเงิน/คริปโต/ตลาดทุน
const KW_PRICE_TH = [
  "ราคา","ราคาล่าสุด","ตอนนี้เท่าไหร่","เรต","เรท","อัตราแลกเปลี่ยน","ค่าเงินบาท","ค่าเงิน",
  "ราคาทอง","ทองคำ","ราคาน้ำมัน","ดัชนี","หุ้น","ตลาดหุ้น","set","set50","mai",
  "nasdaq","dow jones","คริปโต","บิตคอยน์","bitcoin","btc","eth","อัตราดอกเบี้ย","เงินเฟ้อ","cpi","ดัชนีผู้บริโภค"
];
const KW_PRICE_EN = [
  "price","prices","how much now","rate","exchange rate","forex","usdthb",
  "gold price","oil price","index","indices","stock","stocks","market","nasdaq","dow",
  "crypto","bitcoin","btc","eth","interest rate","inflation","cpi"
];

// กฎหมาย/ประกาศราชการ/การเมือง (ต้องใช้ปัจจุบัน)
const KW_LAW_TH = [
  "กฎหมาย","พระราชบัญญัติ","พ.ร.บ.","พ.ร.ก.","ประกาศราชกิจจาฯ","ราชกิจจานุเบกษา",
  "ข้อกำหนด","ระเบียบ","นโยบาย","คำสั่ง","ประกาศกระทรวง","แก้ไขเพิ่มเติม","บังคับใช้เมื่อไร"
];
const KW_LAW_EN = [
  "law","act","decree","regulation","policy","gazette","effective date","enact","amendment","amended"
];

// ตารางเวลา/กำหนดการ/เที่ยวบิน/ขนส่ง/รอบฉาย
const KW_SCHEDULE_TH = [
  "กำหนดการ","ตาราง","ตารางเวลา","ตารางแข่ง","โปรแกรม","รอบฉาย","เวลาฉาย",
  "ตารางบิน","เที่ยวบิน","เวลาออกเดินทาง","เที่ยวรถ","รถไฟ","รถตู้","bts","mrt",
  "ปิดทำการ","เปิดทำการ","เวลาทำการ","วันนี้เปิดไหม","เดดไลน์","กำหนดส่ง"
];
const KW_SCHEDULE_EN = [
  "schedule","timetable","calendar","fixture","fixtures","match schedule","kickoff","showtime","showtimes",
  "flight","flights","departure","arrival","train schedule","bus schedule","open hours","opening hours","closed today","deadline","due date"
];

// กีฬา/ผลการแข่งขัน/อันดับ
const KW_SPORTS_TH = [
  "สกอร์","ผลบอล","ผลแข่ง","ผลการแข่งขัน","ถ่ายทอดสด","คะแนน","อันดับ",
  "ตารางคะแนน","โปรแกรมแข่ง","ผลเทนนิส","ผลบาส","ผลวอลเลย์บอล","ผลอีสปอร์ต"
];
const KW_SPORTS_EN = [
  "score","scores","result","results","live score","standings","table","fixtures","kickoff","odds"
];

// อากาศ/สิ่งแวดล้อม/ภัยพิบัติ
const KW_WEATHER_TH = [
  "พยากรณ์","พยากรณ์อากาศ","สภาพอากาศ","ฝนตก","อุณหภูมิ","พายุ","พายุเข้า",
  "พายุโซนร้อน","พายุไต้ฝุ่น","pm2.5","ฝุ่น","aqi","คุณภาพอากาศ","น้ำท่วม","เตือนภัย"
];
const KW_WEATHER_EN = [
  "weather","forecast","temperature","storm","typhoon","hurricane","pm2.5","aqi","air quality","flood","warning","alert"
];

// บุคคล/ตำแหน่งปัจจุบัน (ซีอีโอ/ผู้นำ/ผู้ว่าฯ)
const KW_PEOPLE_NOW_TH = [
  "ใครเป็น","ใครคือ","ปัจจุบัน","ตอนนี้","ซีอีโอคนปัจจุบัน","นายกคนปัจจุบัน",
  "ประธานาธิบดีคนปัจจุบัน","ผู้ว่าฯ คนปัจจุบัน","หัวหน้าพรรค","โฆษกรัฐบาล","รัฐมนตรีปัจจุบัน"
];
const KW_PEOPLE_NOW_EN = [
  "who is the current","current ceo","current president","current prime minister","incumbent","currently","as of today"
];

// ซอฟต์แวร์/รุ่นล่าสุด/รีลีสโน้ต
const KW_RELEASE_TH = [
  "เวอร์ชันล่าสุด","รุ่นล่าสุด","ปล่อยอัปเดต","แพตช์โน้ต","ออกรุ่น","อัปแพตช์","อัปเดตเวอร์ชัน","changelog","release notes"
];
const KW_RELEASE_EN = [
  "latest version","new release","release notes","changelog","patch","patch notes","version now"
];

// คำกาลเวลา/อ้างอิงวันที่แบบกว้าง
const KW_TIME_TH = [
  "วันนี้","เมื่อวาน","พรุ่งนี้","เช้านี้","บ่ายนี้","เย็นนี้","คืนนี้",
  "ขณะนี้","ตอนนี้","ปัจจุบัน","ช่วงนี้","สัปดาห์นี้","เดือนนี้","ไตรมาสนี้","ปีนี้","รายวัน","รายสัปดาห์","รายเดือน"
];
const KW_TIME_EN = [
  "today","yesterday","tomorrow","this morning","this afternoon","tonight",
  "now","currently","at the moment","this week","this month","this quarter","this year","daily","weekly","monthly"
];

// รวมทั้งหมดเป็นชุดเดียว (ทำให้เป็นตัวพิมพ์เล็กไว้เทียบง่าย)
const ALL_KEYWORDS = [
  ...KW_NEWS_TH, ...KW_NEWS_EN,
  ...KW_PRICE_TH, ...KW_PRICE_EN,
  ...KW_LAW_TH, ...KW_LAW_EN,
  ...KW_SCHEDULE_TH, ...KW_SCHEDULE_EN,
  ...KW_SPORTS_TH, ...KW_SPORTS_EN,
  ...KW_WEATHER_TH, ...KW_WEATHER_EN,
  ...KW_PEOPLE_NOW_TH, ...KW_PEOPLE_NOW_EN,
  ...KW_RELEASE_TH, ...KW_RELEASE_EN,
  ...KW_TIME_TH, ...KW_TIME_EN
].map(s => s.toLowerCase());

// เดือน/วัน (ไทย/อังกฤษ) เพื่อเดางานที่อ้างถึง “วันที่จริง”
const TH_MONTHS = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
  "ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."
];
const EN_MONTHS = [
  "january","february","march","april","may","june","july","august","september","october","november","december",
  "jan","feb","mar","apr","may","jun","jul","aug","sep","sept","oct","nov","dec"
];
const TH_WEEKDAYS = ["จันทร์","อังคาร","พุธ","พฤหัส","ศุกร์","เสาร์","อาทิตย์","วันนี้","เมื่อวาน","พรุ่งนี้"];
const EN_WEEKDAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","today","yesterday","tomorrow"];

/* รูปแบบวันที่/เวลา (คร่าว ๆ) */
const RE_DATE_NUMERIC = /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/;           // 12/10/2025, 12-10-68
const RE_TIME = /\b\d{1,2}[:\.]\d{2}\s?(am|pm)?\b/i;                             // 14:30, 9.45 am
const RE_YEAR_AD = /\b(2024|2025|2026|2027)\b/;                                  // AD ใกล้ปัจจุบัน
const RE_YEAR_BE = /\b(2567|2568|2569|2570)\b/;                                  // พ.ศ. ใกล้ปัจจุบัน
const RE_THAI_ERA = /(พ\.ศ\.|ค\.ศ\.)\s?\d{4}/i;

/* ----------------------------- helpers ----------------------------- */
function _toText(v) {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(_toText).join(" ");
  if (v && typeof v === "object" && "text" in v) return String(v.text ?? "");
  return String(v ?? "");
}

function looksLikeFreshInfo(q) {
  const textRaw = _toText(q) || "";
  const text = textRaw.toLowerCase();

  // 1) เจอรูปแบบวันที่/เวลา/ปี
  if (RE_DATE_NUMERIC.test(text) || RE_TIME.test(text) || RE_YEAR_AD.test(text) || RE_YEAR_BE.test(text) || RE_THAI_ERA.test(text)) {
    return true;
  }

  // 2) เจอชื่อเดือน/วัน (ไทย/อังกฤษ)
  const hasMonth = [...TH_MONTHS, ...EN_MONTHS].some(m => text.includes(m.toLowerCase()));
  const hasWeekday = [...TH_WEEKDAYS, ...EN_WEEKDAYS].some(d => text.includes(d.toLowerCase()));
  if (hasMonth || hasWeekday) return true;

  // 3) เจอคีย์เวิร์ดในชุดรวม
  const hitKeyword = ALL_KEYWORDS.some(k => text.includes(k));
  return hitKeyword;
}

function decideEnableSearch(historyList) {
  const lastUser = [...historyList].reverse().find(m => m.role === "user");
  if (!lastUser) return false;
  return looksLikeFreshInfo(lastUser.content);
}

// ✅ ไฟล์ที่ “บล็อคการค้นเว็บ”
const SEARCH_BLOCK_EXTS = new Set([
  ".pdf",
  ".doc", ".docx",
  ".xls", ".xlsx",
  ".ppt", ".pptx",
  ".mp4",
]);

function hasSearchBlockingFiles(fileNames = []) {
  const arr = Array.isArray(fileNames) ? fileNames : [fileNames];
  return arr.some((name) => {
    const ext = path.extname(String(name || "")).toLowerCase();
    return SEARCH_BLOCK_EXTS.has(ext);
  });
}

/* ----------------------------- ฟังก์ชันหลัก (กฎอย่างเดียว) ----------------------------- */
/**
 * @param {Array<{role:"system"|"user"|"assistant", content:any}>} historyList
 * @param {string} model_name
 * @param {{ forceSearch?: boolean, disableSearch?: boolean, maxOutputTokens?: number }} [options]
 */
exports.openAiChat = async (historyList, model_name, options = {}) => {
  const { forceSearch = false, disableSearch = false, fileNames = [] } = options;
  // ✅ ถ้ามีไฟล์บล็อค => ปิด search ทันที
  const blockByFiles = hasSearchBlockingFiles(fileNames);

  // ตัดสินใจเปิด/ปิดจากกฎ
  // ลำดับความสำคัญ: forceSearch > (disableSearch หรือ blockByFiles) > กฎคีย์เวิร์ดเดิม
  const enableSearch = forceSearch
    ? true
    : (disableSearch || blockByFiles)
      ? false
      : decideEnableSearch(historyList);

  const req = {
    model: model_name,
    input: historyList,
    truncation: "auto", // ✅ ให้ตัดของเก่าทิ้งแทน 400
    max_output_tokens: 50000
  };

  if (enableSearch) {
    req.tools = [{ type: "web_search" }];
    req.tool_choice = "auto";
  }

  const resp = await client.responses.create(req);
  const text = resp.output_text;

  return {
    text,
    response: resp,
    enableSearch,
    blockByFiles,       // ✅ optional debug
    usage: resp.usage,
  };
};
