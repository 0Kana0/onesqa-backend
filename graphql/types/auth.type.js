module.exports = `
  enum OtpType {
    sms
    email
  }
  enum LoginType {
    NORMAL
    INSPEC
  }
  enum ColorMode {
    LIGHT
    DARK
  }

  type AuthUser {
    id: ID!
    firstname: String!
    lastname: String!
    username: String!
    phone: String!
    email: String!
    login_type: LoginType!
    position: String!
    group_name: String!
    ai_access: Boolean!
    color_mode: ColorMode!
    role_name: String!
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
