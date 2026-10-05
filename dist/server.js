"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = require("node:http");
const app_1 = __importDefault(require("./app"));
const config_1 = require("./config");
const db_1 = require("./db");
const realtime_1 = require("./realtime");
const paymentCleanup_1 = require("./services/paymentCleanup");
async function main() {
    (0, config_1.assertProductionConfiguration)();
    await (0, db_1.connectDatabase)();
    (0, paymentCleanup_1.startPaymentCleanup)();
    const server = (0, node_http_1.createServer)(app_1.default);
    (0, realtime_1.attachRealtime)(server);
    server.listen(config_1.env.PORT, '0.0.0.0', () => {
        console.info(`AgriMove API listening on port ${config_1.env.PORT}.`);
    });
    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        console.info(`${signal} received; closing API server.`);
        (0, paymentCleanup_1.stopPaymentCleanup)();
        void (0, realtime_1.closeRealtime)()
            .then(() => Promise.resolve().then(() => __importStar(require('mongoose'))))
            .then(({ default: mongoose }) => mongoose.disconnect())
            .then(() => process.exit(0))
            .catch((error) => {
            console.error('API shutdown failed:', error);
            process.exit(1);
        });
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
}
main().catch((error) => {
    console.error('API startup failed:', error);
    process.exit(1);
});
