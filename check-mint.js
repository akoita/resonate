const { createPublicClient, http, parseAbiItem } = require('viem');
const { sepolia } = require('viem/chains');

const client = createPublicClient({
  chain: sepolia,
  transport: http()
});

const STEM_NFT_ADDRESS = '0x024a8127989a13ee4f0b87e45afb529e4e5c28ea';

async function check() {
  const logs = await client.getLogs({
    address: STEM_NFT_ADDRESS,
    event: parseAbiItem('event StemMinted(uint256 indexed tokenId, string tokenUri, uint256[] parentIds, address contractAddress, address creatorAddress)'),
    fromBlock: 10295600n,
    toBlock: 'latest'
  });
  console.log("Found", logs.length, "recent mints on SEP:", logs);
}
check().catch(console.error);
