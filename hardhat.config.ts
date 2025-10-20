import { HardhatUserConfig } from "hardhat/config";
import "@matterlabs/hardhat-zksync";
import "@matterlabs/hardhat-zksync-deploy";
import "@matterlabs/hardhat-zksync-upgradable";
import "@matterlabs/hardhat-zksync-verify";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  zksolc: {
    version: "latest",
    settings: {
      optimizer: {
        enabled: true,
        mode: "3",
      },
    },
  },
  defaultNetwork: "zkSyncTestnet",
  networks: {
    hardhat: {
      zksync: true,
    },
    zkSyncTestnet: {
      url: process.env.ZKSYNC_ERA_TESTNET_RPC_URL || "https://testnet.era.zksync.dev",
      ethNetwork: "sepolia",
      zksync: true,
      verifyURL: "https://explorer.sepolia.era.zksync.dev/contract_verification",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    eraTestnet: {
      url: process.env.ZKSYNC_ERA_TESTNET_RPC_URL || "https://testnet.era.zksync.dev",
      ethNetwork: "sepolia",
      zksync: true,
      verifyURL: "https://explorer.sepolia.era.zksync.dev/contract_verification",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    zkSyncMainnet: {
      url: process.env.ZKSYNC_ERA_RPC_URL || "https://mainnet.era.zksync.io",
      ethNetwork: "mainnet",
      zksync: true,
      verifyURL: "https://zksync2-mainnet-explorer.zksync.io/contract_verification",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
