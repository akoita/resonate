export const ERC6492_MAGIC = "0x6492649264926492649264926492649264926492";

export function wrapErc6492(signature: string, deploymentData: string) {
  return `${ERC6492_MAGIC}${deploymentData.replace(/^0x/, "")}${signature.replace(
    /^0x/,
    ""
  )}`;
}

export function isErc6492(signature: string) {
  return signature.startsWith(ERC6492_MAGIC);
}

export function unwrapErc6492(signature: string) {
  if (!isErc6492(signature)) {
    return { deploymentData: null, signature };
  }
  const payload = signature.slice(ERC6492_MAGIC.length);
  const deploymentData = `0x${payload.slice(0, 64)}`;
  const innerSig = `0x${payload.slice(64)}`;
  return { deploymentData, signature: innerSig };
}
