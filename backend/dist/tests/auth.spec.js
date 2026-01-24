"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const auth_nonce_service_1 = require("../modules/auth/auth_nonce.service");
const auth_service_1 = require("../modules/auth/auth.service");
describe("auth nonce", () => {
    it("issues and consumes nonce", () => {
        const service = new auth_nonce_service_1.AuthNonceService();
        const nonce = service.issue("0xabc");
        expect(service.consume("0xabc", nonce)).toBe(true);
        expect(service.consume("0xabc", nonce)).toBe(false);
    });
});
describe("auth role enforcement", () => {
    it("restricts admin role without allowlist", () => {
        const auth = new auth_service_1.AuthService({ sign: () => "token" }, {
            log: () => { },
        });
        const token = auth.issueToken("0xabc", "admin");
        expect(token.accessToken).toBe("token");
    });
});
