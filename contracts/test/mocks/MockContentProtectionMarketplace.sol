// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockContentProtectionMarketplace {
    uint256 public constant DEFAULT_MAX_PRICE = type(uint256).max;

    mapping(uint256 => uint256) public stemToReleaseRoot;
    mapping(uint256 => uint256) public releaseMaxListingPrice;

    function registerStemProtectionRoot(
        uint256 releaseId,
        uint256 stemTokenId
    ) external {
        stemToReleaseRoot[stemTokenId] = releaseId;
    }

    function getMaxListingPrice(
        uint256 tokenId
    ) external view returns (uint256) {
        uint256 releaseId = stemToReleaseRoot[tokenId];
        if (releaseId == 0) return DEFAULT_MAX_PRICE;

        uint256 maxPrice = releaseMaxListingPrice[releaseId];
        return maxPrice == 0 ? DEFAULT_MAX_PRICE : maxPrice;
    }

    function setMaxListingPrice(uint256 releaseId, uint256 maxPrice) external {
        releaseMaxListingPrice[releaseId] = maxPrice;
    }
}
