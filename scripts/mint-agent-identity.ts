import { main } from "../backend/scripts/mint-agent-identity";

void main(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
