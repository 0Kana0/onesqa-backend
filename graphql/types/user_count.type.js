module.exports = `
  scalar DateTime     # 👈 เพิ่มตรงนี้ 

  type CardReport {
    value: Int,
    percentChange: Float
  }

  extend type Query {
    cardUserCountReports: CardReport!
  }
`;
