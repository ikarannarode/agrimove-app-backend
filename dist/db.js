"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDatabase = connectDatabase;
exports.supportsTransactions = supportsTransactions;
const mongoose_1 = __importDefault(require("mongoose"));
const config_1 = require("./config");
const node_dns_1 = __importDefault(require("node:dns"));
node_dns_1.default.setServers(["8.8.8.8", "1.1.1.1"]);
async function connectDatabase() {
    await mongoose_1.default.connect(config_1.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 10_000,
    });
    const hello = await mongoose_1.default.connection.db?.admin().command({ hello: 1 });
    if (!hello || !supportsTransactions(hello)) {
        throw new Error('MongoDB transactions are required. Configure MONGODB_URI to use a replica set or mongos; standalone MongoDB is not supported.');
    }
}
function supportsTransactions(hello) {
    return Boolean(hello.logicalSessionTimeoutMinutes != null
        && (hello.setName || hello.msg === 'isdbgrid'));
}
