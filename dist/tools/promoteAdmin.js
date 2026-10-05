"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const mongoose_1 = __importDefault(require("mongoose"));
const config_1 = require("../config");
const models_1 = require("../models");
async function main() {
    const [emailArg, password] = process.argv.slice(2);
    if (!emailArg || !password || password.length < 12) {
        throw new Error('Usage: npm run admin:bootstrap -- <email> <password-at-least-12-characters>');
    }
    await mongoose_1.default.connect(config_1.env.MONGODB_URI);
    const email = emailArg.trim().toLowerCase();
    const passwordHash = await bcryptjs_1.default.hash(password, 12);
    const user = await models_1.User.findOneAndUpdate({ email }, {
        $set: {
            email,
            fullName: email,
            role: 'admin',
            passwordHash,
            emailVerifiedAt: new Date(),
            passwordResetRequired: false,
            isActive: true,
        },
        $setOnInsert: { phone: null },
    }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
    console.info(`Trusted administrator provisioned: ${user.email} (${user._id})`);
}
main()
    .catch((error) => {
    console.error('Administrator provisioning failed:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await mongoose_1.default.disconnect();
});
