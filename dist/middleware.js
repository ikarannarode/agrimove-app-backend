"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.requireRole = requireRole;
exports.authenticated = authenticated;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("./config");
const errors_1 = require("./errors");
const models_1 = require("./models");
async function authenticate(req, _res, next) {
    try {
        const header = req.header('authorization');
        if (!header?.startsWith('Bearer '))
            throw new errors_1.HttpError(401, 'Sign in to continue.');
        const token = header.slice(7);
        const claims = jsonwebtoken_1.default.verify(token, config_1.env.JWT_ACCESS_SECRET);
        const user = await models_1.User.findById(claims.sub).select('_id role email fullName isActive');
        if (!user?.isActive)
            throw new errors_1.HttpError(401, 'This account is unavailable.');
        req.auth = {
            id: String(user._id),
            role: user.role,
            email: user.email,
            fullName: user.fullName,
        };
        next();
    }
    catch (error) {
        next(error instanceof jsonwebtoken_1.default.JsonWebTokenError || error instanceof jsonwebtoken_1.default.TokenExpiredError
            ? new errors_1.HttpError(401, 'Your session has expired. Please sign in again.')
            : error);
    }
}
function requireRole(...roles) {
    return (req, _res, next) => {
        if (!roles.includes(req.auth?.role)) {
            next(new errors_1.HttpError(403, 'Your account is not permitted to perform this action.'));
            return;
        }
        next();
    };
}
function authenticated(req) {
    const user = req.auth;
    if (!user)
        throw new errors_1.HttpError(401, 'Sign in to continue.');
    return user;
}
