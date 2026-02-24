const { createPublicClient, http, parseAbiItem, getContract } = require('viem');
const { sepolia } = require('viem/chains');

const STEM_NFT = "0x024a8127989a13ee4f0b87e45afb529e4e5c28ea";
const SA_ADDRESS = "0xCc9877f551A39797fF0afd937BE43Cc77631f274";

async function check() {
  const publicClient = createPublicClient({ 
    chain: sepolia, 
    transport: http("https://ethereum-sepolia-rpc.publicnode.com") 
  });

  const currentBlock = await publicClient.getBlockNumber();
  const fromBlock = currentBlock - 200n;

  const mintEvent = parseAbiItem('event StemMinted(uint256 indexed tokenId, address indexed creator, uint256[] parentIds, string tokenURI)');
  
  const mintLogs = await publicClient.getLogs({
    address: STEM_NFT,
    event: mintEvent,
    fromBlock,
    toBlock: 'latest'
  });

  console.log(`Found ${mintLogs.length} StemMinted events:`);
  let latestTokenId = 0n;
  for (const log of mintLogs) {
    if (log.args.tokenId > latestTokenId) {
        latestTokenId = log.args.tokenId;
    }
  }

  const transferEvent = parseAbiItem('event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)');
  
  const transferLogs = await publicClient.getLogs({
    address: STEM_NFT,
    event: transferEvent,
    fromBlock,
    toBlock: 'latest'
  });

  for (const log of transferLogs) {
      if (log.args.id === latestTokenId) {
          console.log(`TokenID: ${log.args.id}, From: ${log.args.from}, To: ${log.args.to}, Value: ${log.args.value}, TxHash: ${log.transactionHash}`);
      }
  }

  if (latestTokenId > 0n) {
      const balanceItem = parseAbiItem('function balanceOf(address account, uint256 id) view returns (uint256)');
      const balance = await publicClient.readContract({
          address: STEM_NFT,
          abi: [balanceItem],
          functionName: 'balanceOf',
          args: [SA_ADDRESS, latestTokenId]
      });
      console.log(`\nSmart Account (${SA_ADDRESS}) balance of Token ${latestTokenId}: ${balance}`);
  }
}
check();
