require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: "0.8.20",
  networks: {
    bscTestnet: {
      url: process.env.BSC_TESTNET_URL,  // Testnet URL
      chainId: 97,
      accounts: [`0x${process.env.PRIVATE_KEY}`],
    },
    bscMainnet: {
      url: process.env.BSC_MAINNET_URL,  // Mainnet URL
      chainId: 56,
      accounts: [`0x${process.env.PRIVATE_KEY}`],
    },
  },
};
