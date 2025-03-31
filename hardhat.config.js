require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: "0.8.20",
  networks: {
    bscTestnet: {
      url: process.env.BSC_URL,  // This now points to the BSC Testnet endpoint
      chainId: 97,
      accounts: [`0x${process.env.PRIVATE_KEY}`],
    },
  },
};
