module.exports = `
  enum OtpType {
    sms
    email
  }

  type AuthUser {
    username: String!
    firstname: String
    lastname: String
  }

  type AuthPayload {
    user: AuthUser!
    token: String!        # access token
  }

  type Message {
    message: String!
  }

  input SigninInput {
    username: String!
    password: String!
  }

  input SigninWithIdInput {
    idennumber: String!
    otp_type: OtpType!     # "sms" | "email"
  }

  input VerifySigninWithIdInput {
    idennumber: String!
    otp: String!
  }

  extend type Mutation {
    signin(input: SigninInput!): AuthPayload!                   # login ปกติ
    signinWithIdennumber(input: SigninWithIdInput!): Message!   # ขอ OTP
    verifySigninWithIdennumber(input: VerifySigninWithIdInput!): AuthPayload!
    refreshToken: AuthPayload!                                  # ใช้ cookie
    logout: Message!
  }
`;
