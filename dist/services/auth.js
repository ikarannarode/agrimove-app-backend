"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
exports.verifyEmail = verifyEmail;
exports.resendVerification = resendVerification;
exports.login = login;
exports.refresh = refresh;
exports.logout = logout;
exports.requestPasswordReset = requestPasswordReset;
exports.resetPassword = resetPassword;
const node_crypto_1 = require("node:crypto");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
const errors_1 = require("../errors");
const models_1 = require("../models");
const mail_1 = require("./mail");
const customerRoles = ['farmer', 'vehicle_owner'];
const digest = (value) => (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
const oneTimeCode = () => (0, node_crypto_1.randomInt)(0, 1_000_000).toString().padStart(6, '0');
async function storeCode(userId, code, purpose, minutes) {
    await models_1.AuthToken.deleteMany({ userId, purpose });
    await models_1.AuthToken.create({
        userId,
        tokenHash: digest(code),
        purpose,
        expiresAt: new Date(Date.now() + minutes * 60_000),
    });
}
async function issueSession(user) {
    const accessToken = jsonwebtoken_1.default.sign({
        role: user.role,
        email: user.email,
        fullName: user.fullName,
    }, config_1.env.JWT_ACCESS_SECRET, {
        subject: String(user._id),
        expiresIn: `${config_1.env.ACCESS_TOKEN_MINUTES}m`,
        issuer: 'agrimove-api',
        audience: 'agrimove-client',
    });
    const refreshToken = (0, node_crypto_1.randomUUID)();
    await models_1.AuthToken.create({
        userId: user._id,
        tokenHash: digest(refreshToken),
        purpose: 'refresh',
        expiresAt: new Date(Date.now() + config_1.env.REFRESH_TOKEN_DAYS * 86_400_000),
    });
    return {
        accessToken,
        refreshToken,
        expiresIn: config_1.env.ACCESS_TOKEN_MINUTES * 60,
        user: { id: String(user._id), email: user.email, fullName: user.fullName, role: user.role },
    };
}
async function register(input) {
    if (!customerRoles.includes(input.role))
        throw new errors_1.HttpError(400, 'Choose a valid mobile account role.');
    const email = input.email.trim().toLowerCase();
    if (await models_1.User.exists({ email }))
        throw new errors_1.HttpError(409, 'An account with this email already exists.');
    const passwordHash = await bcryptjs_1.default.hash(input.password, 12);
    const user = await models_1.User.create({
        fullName: input.fullName.trim(),
        email,
        phone: input.phone.trim(),
        passwordHash,
        role: input.role,
    });
    const code = oneTimeCode();
    try {
        await storeCode(String(user._id), code, 'verify_email', config_1.env.EMAIL_VERIFICATION_MINUTES);
        await (0, mail_1.sendOneTimeCode)(email, code, 'verify');
    }
    catch (error) {
        await models_1.AuthToken.deleteMany({ userId: user._id });
        await models_1.User.deleteOne({ _id: user._id });
        throw error;
    }
    return { message: 'Account created. Check your email for the verification code.' };
}
async function verifyEmail(email, code) {
    const user = await models_1.User.findOne({ email: email.trim().toLowerCase() });
    if (!user)
        throw new errors_1.HttpError(400, 'The verification code is invalid or expired.');
    const token = await models_1.AuthToken.findOneAndDelete({
        userId: user._id,
        purpose: 'verify_email',
        tokenHash: digest(code),
        expiresAt: { $gt: new Date() },
    });
    if (!token)
        throw new errors_1.HttpError(400, 'The verification code is invalid or expired.');
    user.emailVerifiedAt = new Date();
    await user.save();
    return { message: 'Email verified. You can now sign in.' };
}
async function resendVerification(email) {
    const user = await models_1.User.findOne({ email: email.trim().toLowerCase() });
    if (!user || user.emailVerifiedAt)
        return { message: 'If verification is needed, a code will be sent.' };
    const code = oneTimeCode();
    await storeCode(String(user._id), code, 'verify_email', config_1.env.EMAIL_VERIFICATION_MINUTES);
    await (0, mail_1.sendOneTimeCode)(user.email, code, 'verify');
    return { message: 'If verification is needed, a code will be sent.' };
}
async function login(email, password) {
    const user = await models_1.User.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash');
    if (!user?.isActive || !user.passwordHash || !(await bcryptjs_1.default.compare(password, user.passwordHash))) {
        throw new errors_1.HttpError(401, 'Email or password is incorrect.');
    }
    if (!user.emailVerifiedAt)
        throw new errors_1.HttpError(403, 'Verify your email before signing in.');
    if (user.passwordResetRequired)
        throw new errors_1.HttpError(403, 'Reset your password before signing in.');
    return issueSession(user);
}
async function refresh(refreshToken) {
    const token = await models_1.AuthToken.findOneAndDelete({
        tokenHash: digest(refreshToken),
        purpose: 'refresh',
        expiresAt: { $gt: new Date() },
    });
    if (!token)
        throw new errors_1.HttpError(401, 'Your session has expired. Please sign in again.');
    const user = await models_1.User.findById(token.userId);
    if (!user?.isActive || !user.emailVerifiedAt)
        throw new errors_1.HttpError(401, 'This account is unavailable.');
    return issueSession(user);
}
async function logout(refreshToken) {
    if (refreshToken) {
        await models_1.AuthToken.deleteOne({ tokenHash: digest(refreshToken), purpose: 'refresh' });
    }
}
async function requestPasswordReset(email) {
    const user = await models_1.User.findOne({ email: email.trim().toLowerCase(), isActive: true });
    if (!user)
        return { message: 'If an active account exists, a reset code will be sent.' };
    const code = oneTimeCode();
    await storeCode(String(user._id), code, 'reset_password', config_1.env.PASSWORD_RESET_MINUTES);
    await (0, mail_1.sendOneTimeCode)(user.email, code, 'reset');
    return { message: 'If an active account exists, a reset code will be sent.' };
}
async function resetPassword(email, code, password) {
    const user = await models_1.User.findOne({ email: email.trim().toLowerCase() });
    if (!user)
        throw new errors_1.HttpError(400, 'The reset code is invalid or expired.');
    const token = await models_1.AuthToken.findOneAndDelete({
        userId: user._id,
        purpose: 'reset_password',
        tokenHash: digest(code),
        expiresAt: { $gt: new Date() },
    });
    if (!token)
        throw new errors_1.HttpError(400, 'The reset code is invalid or expired.');
    user.passwordHash = await bcryptjs_1.default.hash(password, 12);
    user.passwordResetRequired = false;
    await user.save();
    await models_1.AuthToken.deleteMany({ userId: user._id, purpose: 'refresh' });
    return { message: 'Password updated. You can now sign in.' };
}
