"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthNonceService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
let AuthNonceService = class AuthNonceService {
    constructor() {
        this.nonces = new Map();
    }
    issue(address) {
        const nonce = (0, crypto_1.randomUUID)();
        this.nonces.set(address.toLowerCase(), nonce);
        return nonce;
    }
    consume(address, nonce) {
        const key = address.toLowerCase();
        const existing = this.nonces.get(key);
        if (!existing || existing !== nonce) {
            return false;
        }
        this.nonces.delete(key);
        return true;
    }
};
exports.AuthNonceService = AuthNonceService;
exports.AuthNonceService = AuthNonceService = __decorate([
    (0, common_1.Injectable)()
], AuthNonceService);
