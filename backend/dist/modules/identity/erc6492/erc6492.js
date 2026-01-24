"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERC6492_MAGIC = void 0;
exports.wrapErc6492 = wrapErc6492;
exports.isErc6492 = isErc6492;
exports.unwrapErc6492 = unwrapErc6492;
exports.ERC6492_MAGIC = "0x6492649264926492649264926492649264926492";
function wrapErc6492(signature, deploymentData) {
    return `${exports.ERC6492_MAGIC}${deploymentData.replace(/^0x/, "")}${signature.replace(/^0x/, "")}`;
}
function isErc6492(signature) {
    return signature.startsWith(exports.ERC6492_MAGIC);
}
function unwrapErc6492(signature) {
    if (!isErc6492(signature)) {
        return { deploymentData: null, signature };
    }
    const payload = signature.slice(exports.ERC6492_MAGIC.length);
    const deploymentData = `0x${payload.slice(0, 64)}`;
    const innerSig = `0x${payload.slice(64)}`;
    return { deploymentData, signature: innerSig };
}
