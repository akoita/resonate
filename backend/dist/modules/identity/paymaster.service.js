"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymasterService = void 0;
const common_1 = require("@nestjs/common");
let PaymasterService = class PaymasterService {
    sponsorMaxUsd = Number(process.env.AA_SPONSOR_MAX_USD ?? 5);
    // If AA_PAYMASTER is not set, we don't use a paymaster (self-funded)
    paymasterAddress = process.env.AA_PAYMASTER;
    sponsorSpentUsd = new Map();
    configure(input) {
        this.sponsorMaxUsd = input.sponsorMaxUsd;
        this.paymasterAddress = input.paymasterAddress;
    }
    getStatus(userId) {
        return {
            sponsorMaxUsd: this.sponsorMaxUsd,
            paymasterAddress: this.paymasterAddress,
            spentUsd: userId ? this.sponsorSpentUsd.get(userId) ?? 0 : undefined,
        };
    }
    resetUser(userId) {
        this.sponsorSpentUsd.delete(userId);
    }
    buildPaymasterData(userOp, spendUsd, userId) {
        // If no paymaster is configured, return empty (self-funded)
        if (!this.paymasterAddress) {
            return "0x";
        }
        if (spendUsd > this.sponsorMaxUsd) {
            return "0x";
        }
        if (userId) {
            const spent = this.sponsorSpentUsd.get(userId) ?? 0;
            if (spent + spendUsd > this.sponsorMaxUsd) {
                return "0x";
            }
            this.sponsorSpentUsd.set(userId, spent + spendUsd);
        }
        return this.paymasterAddress;
    }
};
exports.PaymasterService = PaymasterService;
exports.PaymasterService = PaymasterService = __decorate([
    (0, common_1.Injectable)()
], PaymasterService);
